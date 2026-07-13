import { StudentFeatures } from '../../feature-store/feature-store.service';

/** A single explainable contributor to a prediction. */
export interface Driver {
  factor: string;
  impact: number; // signed points contributed to the score
  detail: string; // human-readable, portal/audit-facing
}

export type Band = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface PredictionResult {
  model: string;
  studentUsn: string;
  score: number; // 0–100
  band: Band;
  confidence: number; // 0–1, how much signal was actually present
  drivers: Driver[]; // ranked, largest absolute impact first
  breakdown: Record<string, number>;
  computedAt: string;
}

/**
 * A predictive model. Phase 0 ships rules-based implementations; each can later
 * be swapped for an ML model behind this same interface without touching the
 * service, controller, or any consuming feature.
 */
export interface PredictiveModel {
  readonly id: string;
  /** Band thresholds are model-owned so "high placement readiness" and
   *  "high risk" can mean opposite things. */
  predict(features: StudentFeatures, computedAt: string): PredictionResult;
}
