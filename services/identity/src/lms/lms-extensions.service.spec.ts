import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { LmsExtensionsService } from './lms-extensions.service';
import { LmsService } from './lms.service';

/**
 * These cases exercise the in-memory fallback: no repositories are provided,
 * which is what happens when DATABASE_URL is unset. The repository-backed path
 * needs a live Postgres and is covered by the Phase 0 verification suite.
 */
describe('LmsExtensionsService (in-memory fallback)', () => {
  let ext: LmsExtensionsService;
  let lms: LmsService;
  const collegeId = 'rvce';
  const usn = '1RV21CS001';

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [LmsExtensionsService, LmsService],
    }).compile();
    ext = moduleRef.get(LmsExtensionsService);
    lms = moduleRef.get(LmsService);
  });

  it('lists seeded FCFS assignment for les-fcfs', async () => {
    const rows = await ext.listAssignments(collegeId, 'les-fcfs', true);
    expect(rows.some((a) => a.id === 'asgn-fcfs-lab')).toBe(true);
  });

  it('tracks learning streak on touch', async () => {
    const first = await ext.touchStreak(collegeId, usn);
    expect(first.currentStreak).toBeGreaterThanOrEqual(1);
    const again = await ext.getStreak(collegeId, usn);
    expect(again.currentStreak).toBe(first.currentStreak);
  });

  it('blocks les-sjf until les-fcfs is mastered', async () => {
    await expect(ext.assertLessonUnlocked(collegeId, usn, 'les-sjf')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns adaptive quiz questions for enrolled course', async () => {
    const qs = await ext.getAdaptiveQuiz(collegeId, usn, 'CS501');
    expect(qs.length).toBeGreaterThan(0);
    expect(qs[0]).toHaveProperty('question');
  });

  it('grades quiz answers', async () => {
    const qs = await ext.getAdaptiveQuiz(collegeId, usn, 'CS501', 2);
    const result = await ext.gradeQuiz(collegeId, usn, 'CS501', [
      { questionId: qs[0]!.id, selectedIndex: qs[0]!.correctIndex },
      { questionId: qs[1]!.id, selectedIndex: -1 },
    ]);
    expect(result.total).toBe(2);
    expect(result.score).toBe(1);
  });

  it('records a submission and upserts on resubmit', async () => {
    const first = await ext.submitAssignment(collegeId, 'asgn-fcfs-lab', usn, 'short');
    const second = await ext.submitAssignment(
      collegeId,
      'asgn-fcfs-lab',
      usn,
      'a much longer answer that clears the rubric length threshold',
    );
    expect(second.id).toBe(first.id);
    expect(second.score).toBeGreaterThan(first.score!);
  });

  it('accumulates learning hours from heartbeats', async () => {
    expect(await ext.getLearningHours(usn, 'CS501')).toBe(0);
    for (let i = 0; i < 30; i++) {
      await ext.recordLearningMinute(collegeId, usn, 'CS501', 'les-fcfs');
    }
    expect(await ext.getLearningHours(usn, 'CS501')).toBe(0.5);
  });

  it('pins faculty discussion posts above student posts', async () => {
    await ext.postDiscussion(collegeId, 'les-fcfs', usn, 'STUDENT', 'student question');
    await ext.postDiscussion(collegeId, 'les-fcfs', 'fac-1', 'FACULTY', 'faculty answer');
    const posts = await ext.listDiscussions(collegeId, 'les-fcfs');
    expect(posts[0]!.pinned).toBe(true);
    expect(posts[0]!.authorRole).toBe('FACULTY');
  });

  it('exports NAAC LMS evidence payload', () => {
    const doc = ext.naacLmsExport(collegeId, 'CS501');
    expect(doc).toMatchObject({ collegeId, courseId: 'CS501', activeLearners: expect.any(Number) });
  });

  it('bulk import returns draft from syllabus', async () => {
    const res = await ext.bulkImportSyllabus(collegeId, 'CS501', 'Unit 1: CPU scheduling\nUnit 2: Memory');
    expect(res.status).toBe('DRAFT_READY');
    expect(res.draft.title).toBeTruthy();
    expect(res.draft.lessons.length).toBeGreaterThan(0);
    expect(res.message).toContain('authoring');
    void lms;
  });
});

// ── Repository-backed path ──────────────────────────────────────────────────

/** Minimal in-memory stand-in for a TypeORM Repository. */
function fakeRepo(tableName: string, rows: any[] = [], opts: { tableMissing?: boolean } = {}) {
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    metadata: { tableName },
    query: jest.fn(async () => {
      if (opts.tableMissing) throw new Error(`relation "${tableName}" does not exist`);
      return [];
    }),
    count: jest.fn(async () => rows.length),
    create: (x: any) => x,
    find: jest.fn(async (o: any = {}) => {
      let out = rows;
      if (o.where) {
        const wheres = Array.isArray(o.where) ? o.where : [o.where];
        out = rows.filter((r) => wheres.some((w: any) => matches(r, w)));
      }
      if (o.order?.pinned === 'DESC') {
        out = [...out].sort(
          (a, b) =>
            (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      }
      return o.take ? out.slice(0, o.take) : out;
    }),
    findOne: jest.fn(async (o: any) => rows.find((r) => matches(r, o.where)) ?? null),
    save: jest.fn(async (x: any) => {
      const items = Array.isArray(x) ? x : [x];
      for (const item of items) {
        const i = rows.findIndex((r) => r.id === item.id && item.id !== undefined);
        if (i >= 0) rows[i] = { ...rows[i], ...item };
        else rows.push({ ...item });
      }
      return Array.isArray(x) ? items : items[0];
    }),
    rows,
  } as any;
}

describe('LmsExtensionsService (repository-backed)', () => {
  const collegeId = 'rvce';
  const usn = '1RV21CS001';

  const lmsStub = {
    getProgress: jest.fn(async () => ({ state: 'IN_PROGRESS' })),
    getMastery: jest.fn(async () => []),
  } as any;

  async function build(overrides: Record<string, any> = {}) {
    const repos = {
      asgn: fakeRepo('lms_assignments'),
      sub: fakeRepo('lms_submissions'),
      quiz: fakeRepo('lms_quiz_questions'),
      disc: fakeRepo('lms_discussion_posts'),
      prereq: fakeRepo('lms_lesson_prerequisites'),
      session: fakeRepo('lms_learning_sessions'),
      streak: fakeRepo('lms_streaks'),
      ...overrides,
    };
    const svc = new LmsExtensionsService(
      lmsStub, undefined,
      repos.asgn, repos.sub, repos.quiz, repos.disc, repos.prereq, repos.session, repos.streak,
    );
    await svc.onModuleInit();
    return { svc, repos };
  }

  it('seeds demo content into empty tables, not into memory', async () => {
    const { repos } = await build();
    expect(repos.quiz.rows.length).toBe(12);
    expect(repos.asgn.rows.length).toBe(1);
    expect(repos.prereq.rows.length).toBe(2);
  });

  it('persists a submission and upserts on resubmit', async () => {
    const { svc, repos } = await build();
    const first = await svc.submitAssignment(collegeId, 'asgn-fcfs-lab', usn, 'short');
    expect(first.score).toBe(0.5);
    const second = await svc.submitAssignment(
      collegeId, 'asgn-fcfs-lab', usn,
      'a much longer answer that clears the rubric length threshold',
    );
    expect(second.id).toBe(first.id);
    expect(second.score).toBe(0.85);
    expect(repos.sub.rows.length).toBe(1); // upserted, not duplicated
  });

  it('rejects a submission for an unknown assignment', async () => {
    const { svc } = await build();
    await expect(svc.submitAssignment(collegeId, 'nope', usn, 'x')).rejects.toThrow(
      'Assignment not found',
    );
  });

  it('persists streaks across calls', async () => {
    const { svc, repos } = await build();
    const first = await svc.touchStreak(collegeId, usn);
    expect(first.currentStreak).toBe(1);
    // Same day → idempotent, no double-count.
    expect((await svc.touchStreak(collegeId, usn)).currentStreak).toBe(1);
    expect((await svc.getStreak(collegeId, usn)).currentStreak).toBe(1);
    expect(repos.streak.rows.length).toBe(1);
  });

  it('continues a streak when the last active day was yesterday', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const { svc } = await build({
      streak: fakeRepo('lms_streaks', [
        { id: 's1', collegeId, studentUsn: usn, currentStreak: 4, longestStreak: 6, lastActiveDate: yesterday },
      ]),
    });
    const res = await svc.touchStreak(collegeId, usn);
    expect(res.currentStreak).toBe(5);
    expect(res.longestStreak).toBe(6);
  });

  it('accumulates learning minutes into one row per day', async () => {
    const { svc, repos } = await build();
    for (let i = 0; i < 30; i++) {
      await svc.recordLearningMinute(collegeId, usn, 'CS501', 'les-fcfs');
    }
    expect(repos.session.rows.length).toBe(1);
    expect(repos.session.rows[0].minutes).toBe(30);
    expect(await svc.getLearningHours(usn, 'CS501')).toBe(0.5);
  });

  it('persists discussions with faculty posts pinned first', async () => {
    const { svc, repos } = await build();
    await svc.postDiscussion(collegeId, 'les-fcfs', usn, 'STUDENT', 'question');
    await svc.postDiscussion(collegeId, 'les-fcfs', 'fac-1', 'FACULTY', 'answer');
    expect(repos.disc.rows.length).toBe(2);
    const posts = await svc.listDiscussions(collegeId, 'les-fcfs');
    expect(posts[0]!.authorRole).toBe('FACULTY');
    expect(posts[0]!.pinned).toBe(true);
  });

  it('reads prerequisites from the table', async () => {
    const { svc, repos } = await build();
    await expect(svc.assertLessonUnlocked(collegeId, usn, 'les-sjf')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repos.prereq.findOne).toHaveBeenCalled();
    // A lesson with no prerequisite row is always unlocked.
    await expect(svc.assertLessonUnlocked(collegeId, usn, 'les-fcfs')).resolves.toBeUndefined();
  });

  it('grades against persisted quiz questions', async () => {
    const { svc, repos } = await build();
    const q = repos.quiz.rows[0];
    const res = await svc.gradeQuiz(collegeId, usn, q.courseId, [
      { questionId: q.id, selectedIndex: q.correctIndex },
      { questionId: q.id, selectedIndex: q.correctIndex + 1 },
    ]);
    expect(res).toEqual({ score: 1, total: 2, pct: 0.5 });
  });

  it('falls back to memory when a table is unreachable', async () => {
    const { svc, repos } = await build({
      streak: fakeRepo('lms_streaks', [], { tableMissing: true }),
    });
    // verifyTables() should have disabled the repo rather than letting every
    // call 500 — the streak still increments, just in process memory.
    const res = await svc.touchStreak(collegeId, usn);
    expect(res.currentStreak).toBe(1);
    expect(repos.streak.save).not.toHaveBeenCalled();
  });
});
