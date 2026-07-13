import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { geminiGenerate, GEMINI_FAST } from '../shared/gemini-ai';
import {
  ObeProgramEntity, ObeOutcomeEntity, CourseOutcomeEntity, CoPoMapEntity,
  AssessmentCoMapEntity, QuestionMarkEntity, ExitSurveyEntity, AttainmentConfigEntity,
  STANDARD_NBA_POS, OutcomeKind, AssessmentComponent,
} from '../entities/obe.entity';

export interface AttainmentConfig {
  directWeight: number; indirectWeight: number;
  level1Pct: number; level2Pct: number; level3Pct: number;
}
const DEFAULT_CONFIG: AttainmentConfig = {
  directWeight: 80, indirectWeight: 20, level1Pct: 40, level2Pct: 55, level3Pct: 70,
};

/**
 * OBE CRUD + AI CO suggestions. In-memory source of truth (works without a DB,
 * like the LMS demo path); when DATABASE_URL is set the injected repos are used
 * as a best-effort persistence mirror, hydrated on first access.
 */
@Injectable()
export class ObeService {
  private readonly logger = new Logger(ObeService.name);

  programs: ObeProgramEntity[] = [];
  outcomes: ObeOutcomeEntity[] = [];
  cos: CourseOutcomeEntity[] = [];
  coPo: CoPoMapEntity[] = [];
  assessmentMap: AssessmentCoMapEntity[] = [];
  questionMarks: QuestionMarkEntity[] = [];
  surveys: ExitSurveyEntity[] = [];
  configs: AttainmentConfigEntity[] = [];

  constructor(
    @Optional() @InjectRepository(ObeProgramEntity) private readonly programRepo?: Repository<ObeProgramEntity>,
    @Optional() @InjectRepository(ObeOutcomeEntity) private readonly outcomeRepo?: Repository<ObeOutcomeEntity>,
    @Optional() @InjectRepository(CourseOutcomeEntity) private readonly coRepo?: Repository<CourseOutcomeEntity>,
    @Optional() @InjectRepository(CoPoMapEntity) private readonly coPoRepo?: Repository<CoPoMapEntity>,
    @Optional() @InjectRepository(AssessmentCoMapEntity) private readonly amRepo?: Repository<AssessmentCoMapEntity>,
    @Optional() @InjectRepository(QuestionMarkEntity) private readonly qmRepo?: Repository<QuestionMarkEntity>,
    @Optional() @InjectRepository(ExitSurveyEntity) private readonly surveyRepo?: Repository<ExitSurveyEntity>,
    @Optional() @InjectRepository(AttainmentConfigEntity) private readonly cfgRepo?: Repository<AttainmentConfigEntity>,
  ) {}

  // ── Programs / outcomes (PO/PSO) ──────────────────────────────────────────
  listPrograms(collegeId: string): ObeProgramEntity[] {
    return this.programs.filter((p) => p.collegeId === collegeId);
  }

  upsertProgram(collegeId: string, body: Partial<ObeProgramEntity>): ObeProgramEntity {
    const existing = body.id ? this.programs.find((p) => p.id === body.id) : undefined;
    if (existing) { Object.assign(existing, body); this.save(this.programRepo, existing); return existing; }
    const row: ObeProgramEntity = {
      id: randomUUID(), collegeId, code: body.code ?? 'PROG', name: body.name ?? 'Program',
      department: body.department, version: body.version, createdAt: new Date(), updatedAt: new Date(),
    };
    this.programs.push(row); this.save(this.programRepo, row); return row;
  }

  listOutcomes(collegeId: string, programId: string): ObeOutcomeEntity[] {
    return this.outcomes
      .filter((o) => o.collegeId === collegeId && o.programId === programId)
      .sort((a, b) => (a.kind === b.kind ? a.seq - b.seq : a.kind === 'PO' ? -1 : 1));
  }

  upsertOutcome(collegeId: string, body: Partial<ObeOutcomeEntity>): ObeOutcomeEntity {
    const existing = body.id ? this.outcomes.find((o) => o.id === body.id) : undefined;
    if (existing) { Object.assign(existing, body); this.save(this.outcomeRepo, existing); return existing; }
    const row: ObeOutcomeEntity = {
      id: randomUUID(), collegeId, programId: body.programId ?? '', kind: (body.kind ?? 'PO') as OutcomeKind,
      seq: body.seq ?? 0, code: body.code ?? 'PO?', statement: body.statement ?? '',
      target: body.target ?? 2.0, createdAt: new Date(), updatedAt: new Date(),
    };
    this.outcomes.push(row); this.save(this.outcomeRepo, row); return row;
  }

  /** Seed the 12 standard NBA POs for a program (idempotent by code). */
  seedStandardPos(collegeId: string, programId: string): ObeOutcomeEntity[] {
    for (const po of STANDARD_NBA_POS) {
      const exists = this.outcomes.find(
        (o) => o.collegeId === collegeId && o.programId === programId && o.code === po.code,
      );
      if (!exists) {
        this.upsertOutcome(collegeId, { programId, kind: 'PO', seq: po.seq, code: po.code, statement: po.statement });
      }
    }
    return this.listOutcomes(collegeId, programId);
  }

  // ── Course outcomes (CO) ──────────────────────────────────────────────────
  listCos(collegeId: string, courseId: string): CourseOutcomeEntity[] {
    return this.cos
      .filter((c) => c.collegeId === collegeId && c.courseId === courseId)
      .sort((a, b) => a.seq - b.seq);
  }

  upsertCo(collegeId: string, courseId: string, body: Partial<CourseOutcomeEntity>): CourseOutcomeEntity {
    const existing = body.id ? this.cos.find((c) => c.id === body.id) : undefined;
    if (existing) { Object.assign(existing, body); this.save(this.coRepo, existing); return existing; }
    const row: CourseOutcomeEntity = {
      id: randomUUID(), collegeId, courseId, seq: body.seq ?? this.listCos(collegeId, courseId).length + 1,
      code: body.code ?? `CO${this.listCos(collegeId, courseId).length + 1}`, statement: body.statement ?? '',
      bloomLevel: body.bloomLevel, targetThreshold: body.targetThreshold ?? 60,
      targetAttainmentLevel: body.targetAttainmentLevel ?? 2.0, createdAt: new Date(), updatedAt: new Date(),
    };
    this.cos.push(row); this.save(this.coRepo, row); return row;
  }

  deleteCo(collegeId: string, id: string): void {
    this.cos = this.cos.filter((c) => !(c.collegeId === collegeId && c.id === id));
    this.coPo = this.coPo.filter((m) => m.coId !== id);
    void this.coRepo?.delete({ id }).catch(() => undefined);
  }

  /** AI: draft COs from a syllabus blurb (strict JSON, skeleton fallback). */
  async suggestCosFromSyllabus(collegeId: string, courseId: string, syllabus: string): Promise<Array<{ code: string; statement: string; bloomLevel: string }>> {
    const prompt =
      `You are an OBE expert. From the course syllabus below, write exactly 5 Course Outcomes (COs).\n` +
      `Return STRICT JSON: an array of {"code":"CO1","statement":"...","bloomLevel":"Apply"}.\n` +
      `Statements must start with an action verb and be measurable. No prose outside the JSON.\n\n` +
      `SYLLABUS:\n${syllabus.slice(0, 4000)}`;
    try {
      const raw = await geminiGenerate(prompt, GEMINI_FAST, 700);
      const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
      const parsed = JSON.parse(json) as Array<{ code?: string; statement?: string; bloomLevel?: string }>;
      return parsed.slice(0, 6).map((c, i) => ({
        code: c.code ?? `CO${i + 1}`, statement: c.statement ?? '', bloomLevel: c.bloomLevel ?? 'Understand',
      }));
    } catch (e) {
      this.logger.warn(`[OBE] CO suggestion fell back to skeleton: ${(e as Error).message}`);
      return Array.from({ length: 5 }, (_, i) => ({
        code: `CO${i + 1}`, statement: `Describe outcome ${i + 1} for ${courseId} (edit me).`, bloomLevel: 'Understand',
      }));
    }
  }

  // ── CO-PO matrix ──────────────────────────────────────────────────────────
  getMatrix(collegeId: string, courseId: string, programId: string) {
    const cos = this.listCos(collegeId, courseId);
    const outcomes = this.listOutcomes(collegeId, programId);
    const coIds = new Set(cos.map((c) => c.id));
    const cells = this.coPo.filter((m) => m.collegeId === collegeId && coIds.has(m.coId));
    return { cos, outcomes, cells };
  }

  setMatrixCell(collegeId: string, coId: string, outcomeId: string, correlation: number): void {
    this.coPo = this.coPo.filter((m) => !(m.collegeId === collegeId && m.coId === coId && m.outcomeId === outcomeId));
    void this.coPoRepo?.delete({ coId, outcomeId }).catch(() => undefined);
    if (correlation >= 1 && correlation <= 3) {
      const row: CoPoMapEntity = { id: randomUUID(), collegeId, coId, outcomeId, correlation, createdAt: new Date() };
      this.coPo.push(row); this.save(this.coPoRepo, row);
    }
  }

  // ── Assessment ↔ CO map ───────────────────────────────────────────────────
  listAssessmentMap(collegeId: string, courseId: string): AssessmentCoMapEntity[] {
    return this.assessmentMap.filter((a) => a.collegeId === collegeId && a.courseId === courseId);
  }

  setAssessmentMap(collegeId: string, courseId: string, component: AssessmentComponent, coId: string, questionNo?: number, maxMarks = 0): AssessmentCoMapEntity {
    const row: AssessmentCoMapEntity = {
      id: randomUUID(), collegeId, courseId, component, coId,
      questionNo: questionNo ?? undefined, maxMarks, createdAt: new Date(),
    };
    this.assessmentMap.push(row); this.save(this.amRepo, row); return row;
  }

  // ── Question marks ────────────────────────────────────────────────────────
  getQuestionMarks(collegeId: string, courseId: string, component?: AssessmentComponent): QuestionMarkEntity[] {
    return this.questionMarks.filter(
      (q) => q.collegeId === collegeId && q.courseId === courseId && (!component || q.component === component),
    );
  }

  saveQuestionMarks(collegeId: string, courseId: string, component: AssessmentComponent, rows: Array<{ usn: string; questionNo: number; marks: number; maxMarks: number }>): void {
    this.questionMarks = this.questionMarks.filter(
      (q) => !(q.collegeId === collegeId && q.courseId === courseId && q.component === component),
    );
    for (const r of rows) {
      const row: QuestionMarkEntity = {
        id: randomUUID(), collegeId, courseId, usn: r.usn, component,
        questionNo: r.questionNo, marks: r.marks, maxMarks: r.maxMarks, createdAt: new Date(),
      };
      this.questionMarks.push(row); this.save(this.qmRepo, row);
    }
  }

  // ── Exit survey (indirect) ────────────────────────────────────────────────
  upsertExitSurvey(collegeId: string, courseId: string, coId: string, avgRating: number, responseCount: number): ExitSurveyEntity {
    const existing = this.surveys.find((s) => s.collegeId === collegeId && s.courseId === courseId && s.coId === coId);
    if (existing) { existing.avgRating = avgRating; existing.responseCount = responseCount; existing.updatedAt = new Date(); this.save(this.surveyRepo, existing); return existing; }
    const row: ExitSurveyEntity = { id: randomUUID(), collegeId, courseId, coId, avgRating, responseCount, updatedAt: new Date() };
    this.surveys.push(row); this.save(this.surveyRepo, row); return row;
  }

  getSurveys(collegeId: string, courseId: string): ExitSurveyEntity[] {
    return this.surveys.filter((s) => s.collegeId === collegeId && s.courseId === courseId);
  }

  // ── Config ────────────────────────────────────────────────────────────────
  getConfig(collegeId: string, courseId?: string): AttainmentConfig {
    const c = this.configs.find((x) => x.collegeId === collegeId && x.courseId === courseId)
      ?? this.configs.find((x) => x.collegeId === collegeId && !x.courseId);
    if (!c) return { ...DEFAULT_CONFIG };
    return {
      directWeight: c.directWeight, indirectWeight: c.indirectWeight,
      level1Pct: c.level1Pct, level2Pct: c.level2Pct, level3Pct: c.level3Pct,
    };
  }

  setConfig(collegeId: string, courseId: string | undefined, cfg: Partial<AttainmentConfig>): AttainmentConfigEntity {
    const existing = this.configs.find((x) => x.collegeId === collegeId && x.courseId === courseId);
    const merged = { ...DEFAULT_CONFIG, ...this.getConfig(collegeId, courseId), ...cfg };
    if (existing) { Object.assign(existing, merged, { updatedAt: new Date() }); this.save(this.cfgRepo, existing); return existing; }
    const row: AttainmentConfigEntity = {
      id: randomUUID(), collegeId, courseId, ...merged, updatedAt: new Date(),
    } as AttainmentConfigEntity;
    this.configs.push(row); this.save(this.cfgRepo, row); return row;
  }

  // ── persistence helper (best-effort) ──────────────────────────────────────
  private save<T extends object>(repo: Repository<T> | undefined, row: T): void {
    if (!repo) return;
    void repo.save(row as never).catch((e) => this.logger.warn(`[OBE] persist failed: ${(e as Error).message}`));
  }
}
