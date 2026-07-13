import { StudentFeatures } from '../../feature-store/feature-store.service';
import { Band, Driver, PredictionResult, PredictiveModel } from './model.types';

/**
 * Placement Readiness (Feature 2 seed model).
 *
 * Higher score = MORE ready to be placed. Rules-based and fully explainable:
 * academics (40) + attendance (25) + trend (10) + backlog penalty (25 headroom).
 * Weights are intentionally transparent so a TPO can defend every number, and
 * so this can be A/B-swapped for an ML model later behind the same interface.
 */
export class PlacementReadinessModel implements PredictiveModel {
  readonly id = 'placement-readiness';

  predict(f: StudentFeatures, computedAt: string): PredictionResult {
    const drivers: Driver[] = [];

    // Academics — the dominant placement gate (CGPA/marks cutoffs).
    const academicPts = this.band(f.avgMarksPct, [
      [75, 45], [65, 36], [55, 25], [40, 14],
    ], 5);
    drivers.push({
      factor: 'academics',
      impact: academicPts,
      detail: `Avg IA marks ${f.avgMarksPct}% → ${academicPts}/45`,
    });

    // Attendance — eligibility + engagement proxy.
    const attendancePts = this.band(f.attendancePct30d, [
      [85, 30], [75, 24], [65, 15], [50, 6],
    ], 0);
    drivers.push({
      factor: 'attendance',
      impact: attendancePts,
      detail: `30-day attendance ${f.attendancePct30d}% → ${attendancePts}/30`,
    });

    // Backlogs — hard blocker for most drives.
    const backlogPenalty = Math.min(f.failingSubjectCount * 9, 25);
    if (backlogPenalty > 0) {
      drivers.push({
        factor: 'backlogs',
        impact: -backlogPenalty,
        detail: `${f.failingSubjectCount} failing subject(s) → -${backlogPenalty}`,
      });
    }

    // Momentum — recent trajectory nudges readiness up or down.
    const trendPts =
      f.attendanceTrendDelta > 5 ? 10 : f.attendanceTrendDelta < -10 ? -8 : f.attendanceTrendDelta < -5 ? -4 : 0;
    if (trendPts !== 0) {
      drivers.push({
        factor: 'momentum',
        impact: trendPts,
        detail: `Attendance trend ${f.attendanceTrendDelta > 0 ? '+' : ''}${f.attendanceTrendDelta}% wk/wk → ${trendPts}`,
      });
    }

    const breakdown = {
      academics: academicPts,
      attendance: attendancePts,
      backlogs: -backlogPenalty,
      momentum: trendPts,
    };

    const score = this.clamp(academicPts + attendancePts - backlogPenalty + trendPts);
    drivers.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

    return {
      model: this.id,
      studentUsn: f.studentUsn,
      score,
      band: this.bandFor(score),
      confidence: this.confidence(f),
      drivers,
      breakdown,
      computedAt,
    };
  }

  /** Higher score = higher readiness, so CRITICAL = least ready (needs intervention). */
  private bandFor(score: number): Band {
    if (score >= 75) return 'LOW';       // low risk of not being placed
    if (score >= 55) return 'MEDIUM';
    if (score >= 35) return 'HIGH';
    return 'CRITICAL';
  }

  /** Confidence reflects how much real signal backed the score. */
  private confidence(f: StudentFeatures): number {
    let present = 0;
    if (f.avgMarksPct > 0) present += 0.5;
    if (f.attendancePct30d > 0) present += 0.4;
    if (f.attendanceTrendDelta !== 0) present += 0.1;
    return Math.round(present * 100) / 100;
  }

  private band(value: number, tiers: [number, number][], floor: number): number {
    for (const [threshold, pts] of tiers) {
      if (value >= threshold) return pts;
    }
    return floor;
  }

  private clamp(n: number): number {
    return Math.max(0, Math.min(100, Math.round(n)));
  }
}
