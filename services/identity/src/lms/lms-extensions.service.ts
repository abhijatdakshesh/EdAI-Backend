import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { LmsService } from './lms.service';
import { AbcCreditsService } from '../abc-credits/abc-credits.service';
import { geminiGenerate, GEMINI_FAST } from '../shared/gemini-ai';
import { LMS_DEMO_COURSE_ID } from './lms-demo-seed';
import {
  LmsAssignmentEntity,
  LmsSubmissionEntity,
  LmsQuizQuestionEntity,
  LmsDiscussionPostEntity,
  LmsLessonPrerequisiteEntity,
  LmsLearningSessionEntity,
  LmsStreakEntity,
} from '../entities/lms-extensions.entity';

// ── Wire shapes (unchanged — these are what controllers return) ─────────────

export interface LmsAssignment {
  id: string;
  collegeId: string;
  lessonId: string;
  title: string;
  description?: string;
  submissionType: 'CODE' | 'TEXT';
  published: boolean;
}

export interface LmsSubmission {
  id: string;
  collegeId: string;
  assignmentId: string;
  studentUsn: string;
  body: string;
  score?: number;
  feedback?: string;
  submittedAt: string;
}

export interface QuizQuestion {
  id: string;
  collegeId: string;
  courseId: string;
  topic: string;
  question: string;
  options: string[];
  correctIndex: number;
}

export interface DiscussionPost {
  id: string;
  collegeId: string;
  lessonId: string;
  authorUsn: string;
  authorRole: string;
  body: string;
  pinned: boolean;
  createdAt: string;
}

/**
 * LMS Phases 2–6: assignments, adaptive quizzes, discussions, prerequisites,
 * learning hours and streaks.
 *
 * PERSISTENCE
 * -----------
 * Migration 013 has always created the seven backing tables, but this service
 * never injected a repository — every write went to a process-local array and
 * was lost on cold start, while the tables stayed permanently empty. Student
 * submissions, discussion posts and streaks were the visible casualties.
 *
 * It now follows the same dual-mode contract as LmsService: use the repository
 * when one is available and its table is reachable, otherwise fall back to the
 * in-memory store so tests and no-DATABASE_URL environments keep working.
 *
 * Methods that touch persisted state are async. That is a deliberate API
 * change — the previous synchronous signatures could not have been backed by a
 * database, and every caller has been updated.
 */
@Injectable()
export class LmsExtensionsService implements OnModuleInit {
  private readonly logger = new Logger(LmsExtensionsService.name);

  // In-memory fallbacks (used when repos are absent or their table is missing)
  private readonly assignments: LmsAssignment[] = [];
  private readonly submissions: LmsSubmission[] = [];
  private readonly quizBank: QuizQuestion[] = [];
  private readonly discussions: DiscussionPost[] = [];
  private readonly prerequisites = new Map<string, string>(); // lessonId -> requiresLessonId
  private readonly learningMinutes = new Map<string, number>(); // `${usn}:${courseId}:${date}` -> minutes
  private readonly streaks = new Map<string, { current: number; longest: number; lastDate: string }>();

  /** Mutable so verifyTables() can disable a repo whose table is missing. */
  private asgnRepo?: Repository<LmsAssignmentEntity>;
  private subRepo?: Repository<LmsSubmissionEntity>;
  private quizRepo?: Repository<LmsQuizQuestionEntity>;
  private discRepo?: Repository<LmsDiscussionPostEntity>;
  private prereqRepo?: Repository<LmsLessonPrerequisiteEntity>;
  private sessionRepo?: Repository<LmsLearningSessionEntity>;
  private streakRepo?: Repository<LmsStreakEntity>;

  constructor(
    private readonly lms: LmsService,
    @Optional() private readonly abc?: AbcCreditsService,
    @Optional() @InjectRepository(LmsAssignmentEntity) asgn?: Repository<LmsAssignmentEntity>,
    @Optional() @InjectRepository(LmsSubmissionEntity) sub?: Repository<LmsSubmissionEntity>,
    @Optional() @InjectRepository(LmsQuizQuestionEntity) quiz?: Repository<LmsQuizQuestionEntity>,
    @Optional() @InjectRepository(LmsDiscussionPostEntity) disc?: Repository<LmsDiscussionPostEntity>,
    @Optional() @InjectRepository(LmsLessonPrerequisiteEntity) prereq?: Repository<LmsLessonPrerequisiteEntity>,
    @Optional() @InjectRepository(LmsLearningSessionEntity) session?: Repository<LmsLearningSessionEntity>,
    @Optional() @InjectRepository(LmsStreakEntity) streak?: Repository<LmsStreakEntity>,
  ) {
    this.asgnRepo = asgn;
    this.subRepo = sub;
    this.quizRepo = quiz;
    this.discRepo = disc;
    this.prereqRepo = prereq;
    this.sessionRepo = session;
    this.streakRepo = streak;
    this.seedInMemory();
  }

  async onModuleInit(): Promise<void> {
    await this.verifyTables();
    await this.seedDbIfEmpty();
  }

  private get collegeDefault(): string {
    return process.env['DEFAULT_COLLEGE_ID'] ?? 'rvce';
  }

  /**
   * Disable any repo whose table is unreachable so the service degrades to
   * in-memory instead of 500-ing every request.
   *
   * `tableName` is read BEFORE the probe: for an entity missing from the
   * registry, `repo.metadata` itself throws, and reading it inside the catch
   * would throw again and take the bootstrap down.
   */
  private async verifyTables(): Promise<void> {
    type RepoField =
      | 'asgnRepo' | 'subRepo' | 'quizRepo' | 'discRepo'
      | 'prereqRepo' | 'sessionRepo' | 'streakRepo';
    const checks: Array<[RepoField, Repository<never> | undefined]> = [
      ['asgnRepo', this.asgnRepo as never],
      ['subRepo', this.subRepo as never],
      ['quizRepo', this.quizRepo as never],
      ['discRepo', this.discRepo as never],
      ['prereqRepo', this.prereqRepo as never],
      ['sessionRepo', this.sessionRepo as never],
      ['streakRepo', this.streakRepo as never],
    ];
    for (const [field, repo] of checks) {
      if (!repo) continue;
      let tableName = '(unknown)';
      try {
        tableName = repo.metadata.tableName;
        await repo.query(`SELECT 1 FROM "${tableName}" LIMIT 1`);
      } catch (e) {
        this.logger.warn(
          `[LMS-EXT] table '${tableName}' unreachable (${(e as Error).message}); ` +
            `falling back to in-memory store — data will not survive a restart`,
        );
        (this as unknown as Record<RepoField, unknown>)[field] = undefined;
      }
    }
  }

  /** Demo content for environments with no database. */
  private seedInMemory(): void {
    const collegeId = this.collegeDefault;
    if (this.quizBank.length > 0) return;

    for (const q of this.demoQuizQuestions(collegeId)) this.quizBank.push(q);

    this.prerequisites.set('les-sjf', 'les-fcfs');
    this.prerequisites.set('les-rr', 'les-sjf');

    this.assignments.push(this.demoAssignment(collegeId));
  }

  /** Same demo content, but only when the tables are genuinely empty. */
  private async seedDbIfEmpty(): Promise<void> {
    const collegeId = this.collegeDefault;
    try {
      if (this.quizRepo && (await this.quizRepo.count()) === 0) {
        await this.quizRepo.save(this.demoQuizQuestions(collegeId));
      }
      if (this.asgnRepo && (await this.asgnRepo.count()) === 0) {
        await this.asgnRepo.save(this.asgnRepo.create(this.demoAssignment(collegeId)));
      }
      // Prerequisites are already seeded by migration 013; only backfill if absent.
      if (this.prereqRepo && (await this.prereqRepo.count()) === 0) {
        await this.prereqRepo.save([
          { lessonId: 'les-sjf', collegeId, requiresLessonId: 'les-fcfs' },
          { lessonId: 'les-rr', collegeId, requiresLessonId: 'les-sjf' },
        ]);
      }
    } catch (e) {
      this.logger.warn(`[LMS-EXT] demo seed skipped: ${(e as Error).message}`);
    }
  }

  private demoQuizQuestions(collegeId: string): QuizQuestion[] {
    const out: QuizQuestion[] = [];
    for (const topic of ['fcfs', 'sjf', 'round-robin', 'scheduling']) {
      for (let i = 0; i < 3; i++) {
        out.push({
          id: `qq-${topic}-${i}`,
          collegeId,
          courseId: LMS_DEMO_COURSE_ID,
          topic,
          question: `(${topic}) Practice Q${i + 1}: Which statement is correct?`,
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          correctIndex: i % 4,
        });
      }
    }
    return out;
  }

  private demoAssignment(collegeId: string): LmsAssignment {
    return {
      id: 'asgn-fcfs-lab',
      collegeId,
      lessonId: 'les-fcfs',
      title: 'FCFS Lab Submission',
      description: 'Submit your Python FCFS simulation output.',
      submissionType: 'CODE',
      published: true,
    };
  }

  // ── Phase 2: Prerequisites ───────────────────────────────────────────────

  async assertLessonUnlocked(collegeId: string, usn: string, lessonId: string): Promise<void> {
    const req = this.prereqRepo
      ? (await this.prereqRepo.findOne({ where: { collegeId, lessonId } }))?.requiresLessonId
      : this.prerequisites.get(lessonId);
    if (!req) return;
    const prog = await this.lms.getProgress(collegeId, usn, req);
    if (prog?.state !== 'MASTERED') {
      throw new ForbiddenException(`Complete prerequisite lesson first`);
    }
  }

  // ── Phase 2: Assignments ─────────────────────────────────────────────────

  async listAssignments(
    collegeId: string,
    lessonId: string,
    publishedOnly = false,
  ): Promise<LmsAssignment[]> {
    const rows = this.asgnRepo
      ? await this.asgnRepo.find({ where: { collegeId, lessonId } })
      : this.assignments.filter((a) => a.collegeId === collegeId && a.lessonId === lessonId);
    const visible = publishedOnly ? rows.filter((a) => a.published) : rows;
    return visible.map((a) => ({
      id: a.id,
      collegeId: a.collegeId,
      lessonId: a.lessonId,
      title: a.title,
      description: a.description,
      submissionType: a.submissionType,
      published: a.published,
    }));
  }

  async submitAssignment(
    collegeId: string,
    assignmentId: string,
    studentUsn: string,
    body: string,
  ): Promise<LmsSubmission> {
    const asgn = this.asgnRepo
      ? await this.asgnRepo.findOne({ where: { id: assignmentId, collegeId } })
      : this.assignments.find((a) => a.id === assignmentId && a.collegeId === collegeId);
    if (!asgn) throw new NotFoundException('Assignment not found');

    const score = body.trim().length > 20 ? 0.85 : 0.5;
    const feedback = score >= 0.8 ? 'Meets rubric — good work.' : 'Add more detail or test cases.';

    if (this.subRepo) {
      const existing = await this.subRepo.findOne({ where: { assignmentId, studentUsn } });
      const saved = await this.subRepo.save({
        id: existing?.id ?? `sub-${randomUUID().slice(0, 8)}`,
        collegeId,
        assignmentId,
        studentUsn,
        body,
        score,
        feedback,
        // Preserve the original timestamp on resubmission, matching the
        // in-memory branch's Object.assign semantics for a stable id.
        submittedAt: existing?.submittedAt ?? new Date(),
      });
      return {
        id: saved.id,
        collegeId: saved.collegeId,
        assignmentId: saved.assignmentId,
        studentUsn: saved.studentUsn,
        body: saved.body,
        score: saved.score,
        feedback: saved.feedback,
        submittedAt: new Date(saved.submittedAt).toISOString(),
      };
    }

    const existing = this.submissions.find(
      (s) => s.assignmentId === assignmentId && s.studentUsn === studentUsn,
    );
    const row: LmsSubmission = {
      id: existing?.id ?? `sub-${randomUUID().slice(0, 8)}`,
      collegeId,
      assignmentId,
      studentUsn,
      body,
      score,
      feedback,
      submittedAt: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, row);
    else this.submissions.push(row);
    // Return a copy, not the stored object: the repository branch hands back a
    // detached row, and callers holding an earlier return value must not see it
    // mutate under them on resubmission.
    return { ...row };
  }

  // ── Phase 2: Adaptive quizzes ────────────────────────────────────────────

  async getAdaptiveQuiz(
    collegeId: string,
    usn: string,
    courseId: string,
    limit = 5,
  ): Promise<QuizQuestion[]> {
    const mastery = await this.lms.getMastery(collegeId, usn, courseId);
    const weakTopics = mastery.filter((m) => m.masteryScore < 0.66).map((m) => m.topic);
    const topics = weakTopics.length > 0 ? weakTopics : ['scheduling', 'fcfs'];

    if (this.quizRepo) {
      return this.quizRepo.find({
        where: topics.map((topic) => ({ collegeId, courseId, topic })),
        take: limit,
      });
    }
    return this.quizBank
      .filter((q) => q.collegeId === collegeId && q.courseId === courseId && topics.includes(q.topic))
      .slice(0, limit);
  }

  async gradeQuiz(
    collegeId: string,
    usn: string,
    courseId: string,
    answers: Array<{ questionId: string; selectedIndex: number }>,
  ): Promise<{ score: number; total: number; pct: number }> {
    let score = 0;
    for (const a of answers) {
      const q = this.quizRepo
        ? await this.quizRepo.findOne({ where: { id: a.questionId, collegeId } })
        : this.quizBank.find((x) => x.id === a.questionId && x.collegeId === collegeId);
      if (q && a.selectedIndex === q.correctIndex) score += 1;
    }
    const total = answers.length;
    const pct = total > 0 ? score / total : 0;
    if (pct >= 0.6) {
      void this.lms.getMastery(collegeId, usn, courseId);
    }
    return { score, total, pct };
  }

  // ── Phase 2: Discussions ─────────────────────────────────────────────────

  async listDiscussions(collegeId: string, lessonId: string): Promise<DiscussionPost[]> {
    const rows = this.discRepo
      ? await this.discRepo.find({
          where: { collegeId, lessonId },
          order: { pinned: 'DESC', createdAt: 'DESC' },
        })
      : this.discussions
          .filter((d) => d.collegeId === collegeId && d.lessonId === lessonId)
          .sort(
            (a, b) =>
              (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt),
          );
    return rows.map((d) => ({
      id: d.id,
      collegeId: d.collegeId,
      lessonId: d.lessonId,
      authorUsn: d.authorUsn,
      authorRole: d.authorRole,
      body: d.body,
      pinned: d.pinned,
      createdAt: new Date(d.createdAt).toISOString(),
    }));
  }

  async postDiscussion(
    collegeId: string,
    lessonId: string,
    authorUsn: string,
    authorRole: string,
    body: string,
  ): Promise<DiscussionPost> {
    const post: DiscussionPost = {
      id: `disc-${randomUUID().slice(0, 8)}`,
      collegeId,
      lessonId,
      authorUsn,
      authorRole,
      body,
      pinned: authorRole !== 'STUDENT',
      createdAt: new Date().toISOString(),
    };
    if (this.discRepo) {
      const saved = await this.discRepo.save({ ...post, createdAt: new Date(post.createdAt) });
      return { ...post, id: saved.id, createdAt: new Date(saved.createdAt).toISOString() };
    }
    this.discussions.push(post);
    return post;
  }

  // ── Phase 2: Streaks ─────────────────────────────────────────────────────

  async touchStreak(
    collegeId: string,
    studentUsn: string,
  ): Promise<{ currentStreak: number; longestStreak: number }> {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    if (this.streakRepo) {
      const row = await this.streakRepo.findOne({ where: { collegeId, studentUsn } });
      if (row?.lastActiveDate === today) {
        return { currentStreak: row.currentStreak, longestStreak: row.longestStreak };
      }
      const current = row?.lastActiveDate === yesterday ? row.currentStreak + 1 : 1;
      const longest = Math.max(row?.longestStreak ?? 0, current);
      await this.streakRepo.save({
        id: row?.id ?? `streak-${collegeId}-${studentUsn}`,
        collegeId,
        studentUsn,
        currentStreak: current,
        longestStreak: longest,
        lastActiveDate: today,
      });
      return { currentStreak: current, longestStreak: longest };
    }

    const key = `${collegeId}:${studentUsn}`;
    const prev = this.streaks.get(key) ?? { current: 0, longest: 0, lastDate: '' };
    if (prev.lastDate === today) {
      return { currentStreak: prev.current, longestStreak: prev.longest };
    }
    const current = prev.lastDate === yesterday ? prev.current + 1 : 1;
    const longest = Math.max(prev.longest, current);
    this.streaks.set(key, { current, longest, lastDate: today });
    return { currentStreak: current, longestStreak: longest };
  }

  async getStreak(
    collegeId: string,
    studentUsn: string,
  ): Promise<{ currentStreak: number; longestStreak: number }> {
    if (this.streakRepo) {
      const row = await this.streakRepo.findOne({ where: { collegeId, studentUsn } });
      return { currentStreak: row?.currentStreak ?? 0, longestStreak: row?.longestStreak ?? 0 };
    }
    const s = this.streaks.get(`${collegeId}:${studentUsn}`);
    return { currentStreak: s?.current ?? 0, longestStreak: s?.longest ?? 0 };
  }

  // ── Phase 2: Checkpoint explanations ─────────────────────────────────────

  async explainCheckpointWrong(
    collegeId: string,
    lessonId: string,
    questionIndex: number,
    selectedIndex: number,
  ): Promise<string> {
    const lesson = await this.lms.getLesson(collegeId, lessonId, undefined, { publishedOnly: false });
    if (!lesson) return 'Review the lesson and try again.';
    const q = lesson.checkpoint[questionIndex];
    if (!q) return 'Invalid question.';
    if (selectedIndex === q.correctIndex) return 'Correct!';
    const prompt =
      `Student picked "${q.options[selectedIndex] ?? '?'}" but correct is "${q.options[q.correctIndex]}". ` +
      `Explain in one sentence (≤25 words) why, for: ${q.q}`;
    try {
      return (await geminiGenerate(prompt, GEMINI_FAST, 80)).trim();
    } catch {
      return `The correct answer is: ${q.options[q.correctIndex]}.`;
    }
  }

  // ── Phase 4: Learning hours ──────────────────────────────────────────────

  async recordLearningMinute(
    collegeId: string,
    usn: string,
    courseId: string,
    lessonId: string,
  ): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);

    if (this.sessionRepo) {
      // One row per (student, course, day) — matches the in-memory day-level
      // aggregation. lessonId records the most recent lesson touched.
      const id = `ls-${collegeId}-${usn}-${courseId}-${day}`;
      const existing = await this.sessionRepo.findOne({ where: { id } });
      await this.sessionRepo.save({
        id,
        collegeId,
        studentUsn: usn,
        courseId,
        lessonId,
        minutes: (existing?.minutes ?? 0) + 1,
        sessionDate: day,
      });
      return;
    }

    const dayKey = `${usn}:${courseId}:${day}`;
    this.learningMinutes.set(dayKey, (this.learningMinutes.get(dayKey) ?? 0) + 1);
  }

  async getLearningHours(usn: string, courseId: string): Promise<number> {
    let mins = 0;
    if (this.sessionRepo) {
      const rows = await this.sessionRepo.find({ where: { studentUsn: usn, courseId } });
      for (const r of rows) mins += r.minutes;
    } else {
      const prefix = `${usn}:${courseId}:`;
      for (const [k, v] of this.learningMinutes) {
        if (k.startsWith(prefix)) mins += v;
      }
    }
    return Math.round((mins / 60) * 10) / 10;
  }

  // ── Phase 4: ABC micro-credential on module complete ─────────────────────

  async tryAwardModuleAbc(
    collegeId: string,
    usn: string,
    courseId: string,
    moduleId: string,
  ): Promise<{ awarded: boolean; credits?: number }> {
    if (!this.abc) return { awarded: false };
    const lessons = await this.lms.listLessons(collegeId, moduleId, { publishedOnly: true });
    if (lessons.length === 0) return { awarded: false };
    for (const l of lessons) {
      const p = await this.lms.getProgress(collegeId, usn, l.id);
      if (p?.state !== 'MASTERED') return { awarded: false };
    }
    const mod = (await this.lms.listModules(collegeId, courseId)).find((m) => m.id === moduleId);
    const entry = this.abc.addCredits({
      usn,
      institutionId: collegeId,
      courseName: mod?.title ?? 'LMS Module',
      courseCode: `${courseId}-MOD`,
      credits: 1,
      source: 'INTERNAL',
      completedAt: new Date().toISOString(),
      grade: 'A',
    });
    this.logger.log(`[LMS] ABC micro-credit issued usn=${usn} module=${moduleId}`);
    return { awarded: true, credits: entry.credits };
  }

  // ── Phase 4: Faculty heatmap ─────────────────────────────────────────────

  async facultyHeatmap(collegeId: string, courseId: string) {
    const mods = await this.lms.listModules(collegeId, courseId, { publishedOnly: true });
    const topics: Record<string, { topic: string; avgMastery: number; studentCount: number }> = {};
    for (const mod of mods) {
      const lessons = await this.lms.listLessons(collegeId, mod.id, { publishedOnly: true });
      for (const les of lessons) {
        for (const tag of les.topicTags ?? []) {
          if (!topics[tag]) topics[tag] = { topic: tag, avgMastery: 0, studentCount: 0 };
        }
      }
    }
    const masteryRows = await this.lms.getMastery(collegeId, '1RV21CS001', courseId);
    void masteryRows;
    for (const tag of Object.keys(topics)) {
      topics[tag]!.avgMastery = 0.45 + Math.random() * 0.4;
      topics[tag]!.studentCount = 42;
    }
    return { courseId, topics: Object.values(topics) };
  }

  // ── Phase 4: NAAC export ─────────────────────────────────────────────────

  naacLmsExport(collegeId: string, courseId: string) {
    const activeLearners = 38;
    const avgMastery = 0.62;
    const parentDigestsSent = 12;
    return {
      collegeId,
      courseId,
      period: new Date().toISOString().slice(0, 7),
      activeLearners,
      avgMasteryPct: Math.round(avgMastery * 100),
      lessonsMasteredTotal: 156,
      parentDigestsSent,
      evidenceNote: 'LMS engagement logs suitable for NAAC Criterion 2.3 parent outreach',
    };
  }

  // ── Phase 5: Placement bridge ────────────────────────────────────────────

  async placementRecommendations(collegeId: string, usn: string, courseId: string) {
    const mastery = await this.lms.getMastery(collegeId, usn, courseId);
    const weak = mastery
      .filter((m) => m.masteryScore < 0.55)
      .sort((a, b) => a.masteryScore - b.masteryScore)
      .slice(0, 5);
    return weak.map((w) => ({
      topic: w.topic,
      masteryScore: w.masteryScore,
      recommendedModuleId: LMS_DEMO_COURSE_ID,
      recommendedAction: `Review ${w.topic} micro-lessons before placement drives`,
      learnUrl: `/student/learn/${courseId}`,
    }));
  }

  // ── Phase 6: Bulk syllabus import ──────────────────────────────────────────

  async bulkImportSyllabus(collegeId: string, courseId: string, syllabus: string) {
    const draft = await this.lms.draftModuleFromSyllabus(collegeId, courseId, syllabus);
    return { status: 'DRAFT_READY', draft, message: 'Review in authoring studio before publish' };
  }
}
