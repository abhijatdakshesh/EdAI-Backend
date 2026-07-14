import { Injectable, Optional } from '@nestjs/common';
import { ObeService } from './obe.service';
import { IaService } from '../ia/ia.service';
import { CoursesService } from '../courses/courses.service';
import { AssessmentComponent } from '../entities/obe.entity';

// Default component max marks when not given at question level.
const COMPONENT_MAX: Record<AssessmentComponent, number> = {
  IA1: 50, IA2: 50, IA3: 50, ASSIGNMENT: 20, SEE: 100,
};

export interface CoAttainment {
  coId: string;
  code: string;
  studentsConsidered: number;
  attainmentPct: number;     // % students ≥ threshold on CO items
  directLevel: number;       // 0..3
  indirectLevel: number;     // 0..3
  finalLevel: number;        // blended
  target: number;
  gap: number;               // finalLevel - target
}

export interface PoAttainment {
  outcomeId: string;
  code: string;
  kind: string;
  attainment: number;        // correlation-weighted mean of contributing CO finalLevels
  target: number;
  gap: number;
}

@Injectable()
export class ObeAttainmentService {
  constructor(
    private readonly obe: ObeService,
    private readonly ia: IaService,
    @Optional() private readonly courses?: CoursesService,
  ) {}

  /** Per-student component score for a course (IA from IaService, SEE from CoursesService). */
  private componentScore(courseId: string, sem: number, component: AssessmentComponent): Map<string, number> {
    const scores = new Map<string, number>();
    if (component === 'IA1' || component === 'IA2' || component === 'IA3') {
      for (const e of this.ia.getMarks(courseId, sem)) {
        const v = component === 'IA1' ? e.ia1 : component === 'IA2' ? e.ia2 : e.ia3;
        scores.set(e.usn, v ?? 0);
      }
    } else if (component === 'SEE' && this.courses) {
      for (const e of this.ia.getMarks(courseId, sem)) {
        const res = this.courses.getResults(e.usn);
        const subj = res?.semesters?.flatMap((r) => r.subjects).find((s) => s.code === courseId);
        scores.set(e.usn, subj?.exam ?? 0);
      }
    }
    return scores;
  }

  /** The student roster for a course/sem (drawn from IA entries). */
  private roster(courseId: string, sem: number): string[] {
    return this.ia.getMarks(courseId, sem).map((e) => e.usn);
  }

  private levelFromPct(pct: number, cfg: { level1Pct: number; level2Pct: number; level3Pct: number }): number {
    if (pct >= cfg.level3Pct) return 3;
    if (pct >= cfg.level2Pct) return 2;
    if (pct >= cfg.level1Pct) return 1;
    return 0;
  }

  /** Direct + indirect + blended attainment for every CO of a course. */
  computeCoAttainment(collegeId: string, courseId: string, sem: number): CoAttainment[] {
    const cos = this.obe.listCos(collegeId, courseId);
    const maps = this.obe.listAssessmentMap(collegeId, courseId);
    const cfg = this.obe.getConfig(collegeId, courseId);
    const surveys = this.obe.getSurveys(collegeId, courseId);
    const roster = this.roster(courseId, sem);

    // Pre-fetch component scores once per component referenced.
    const componentCache = new Map<AssessmentComponent, Map<string, number>>();
    const compScore = (c: AssessmentComponent): Map<string, number> => {
      if (!componentCache.has(c)) componentCache.set(c, this.componentScore(courseId, sem, c));
      return componentCache.get(c)!;
    };

    return cos.map((co) => {
      const coMaps = maps.filter((m) => m.coId === co.id);
      let studentsConsidered = 0;
      let attained = 0;

      for (const usn of roster) {
        let obtained = 0;
        let max = 0;
        for (const m of coMaps) {
          if (m.questionNo == null) {
            // whole-component map
            obtained += compScore(m.component).get(usn) ?? 0;
            max += COMPONENT_MAX[m.component];
          } else {
            // question-level map
            const q = this.obe
              .getQuestionMarks(collegeId, courseId, m.component)
              .find((x) => x.usn === usn && x.questionNo === m.questionNo);
            obtained += q?.marks ?? 0;
            max += q?.maxMarks ?? m.maxMarks ?? 0;
          }
        }
        if (max <= 0) continue;
        studentsConsidered++;
        const coPercent = (obtained / max) * 100;
        if (coPercent >= co.targetThreshold) attained++;
      }

      const attainmentPct = studentsConsidered > 0 ? (attained / studentsConsidered) * 100 : 0;
      const directLevel = this.levelFromPct(attainmentPct, cfg);
      const survey = surveys.find((s) => s.coId === co.id);
      const indirectLevel = survey ? Math.max(0, Math.min(3, survey.avgRating)) : directLevel;
      const finalLevel = Number(
        ((cfg.directWeight * directLevel + cfg.indirectWeight * indirectLevel) / 100).toFixed(2),
      );
      return {
        coId: co.id, code: co.code, studentsConsidered, attainmentPct: Number(attainmentPct.toFixed(1)),
        directLevel, indirectLevel, finalLevel, target: co.targetAttainmentLevel,
        gap: Number((finalLevel - co.targetAttainmentLevel).toFixed(2)),
      };
    });
  }

  /** PO/PSO attainment = correlation-weighted mean of contributing CO finalLevels. */
  computePoAttainment(collegeId: string, programId: string, courseIds: string[], sem: number): PoAttainment[] {
    const outcomes = this.obe.listOutcomes(collegeId, programId);
    // Build coId → finalLevel across all given courses.
    const coFinal = new Map<string, number>();
    for (const courseId of courseIds) {
      for (const co of this.computeCoAttainment(collegeId, courseId, sem)) {
        coFinal.set(co.coId, co.finalLevel);
      }
    }
    return outcomes.map((o) => {
      // gather CO-PO cells touching this outcome
      const cells = this.obe.coPo.filter((m) => m.collegeId === collegeId && m.outcomeId === o.id);
      let num = 0;
      let den = 0;
      for (const cell of cells) {
        const fl = coFinal.get(cell.coId);
        if (fl == null) continue;
        num += cell.correlation * fl;
        den += cell.correlation;
      }
      const attainment = den > 0 ? Number((num / den).toFixed(2)) : 0;
      return {
        outcomeId: o.id, code: o.code, kind: o.kind, attainment,
        target: o.target, gap: Number((attainment - o.target).toFixed(2)),
      };
    });
  }

  getCourseDashboard(collegeId: string, courseId: string, sem: number) {
    const cos = this.computeCoAttainment(collegeId, courseId, sem);
    const belowTarget = cos.filter((c) => c.gap < 0);
    return { courseId, sem, cos, belowTarget };
  }

  getProgramDashboard(collegeId: string, programId: string, courseIds: string[], sem: number) {
    const pos = this.computePoAttainment(collegeId, programId, courseIds, sem);
    const gaps = pos.filter((p) => p.gap < 0);
    return { programId, pos, gaps };
  }
}
