import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FeatureStoreService, FeatureFilters } from '../feature-store/feature-store.service';
import { AVAILABLE_MODELS, MODEL_REGISTRY, PredictionResult } from './models';

/**
 * Phase 0 prediction engine. Resolves a named model, pulls the student's signal
 * vector from the feature store, and returns an explainable, banded score.
 * All five predictive features call through here — they never re-implement scoring.
 */
@Injectable()
export class PredictionService {
  private readonly logger = new Logger(PredictionService.name);

  constructor(private readonly featureStore: FeatureStoreService) {}

  listModels(): string[] {
    return AVAILABLE_MODELS;
  }

  private resolve(model: string) {
    const impl = MODEL_REGISTRY[model];
    if (!impl) {
      throw new BadRequestException(
        `Unknown model '${model}'. Available: ${AVAILABLE_MODELS.join(', ')}`,
      );
    }
    return impl;
  }

  /** Timestamp is passed in (not read from Date) so results are deterministic in tests. */
  async predictForStudent(model: string, usn: string): Promise<PredictionResult> {
    const impl = this.resolve(model);
    const features = await this.featureStore.getStudentFeatures(usn);
    if (!features) {
      throw new NotFoundException(`No feature snapshot for student '${usn}'`);
    }
    return impl.predict(features, new Date().toISOString());
  }

  /**
   * Score a whole cohort, sorted most-in-need first (lowest score). Powers
   * at-risk dashboards (placement, accreditation, scholarship) off one call.
   */
  async predictForCohort(model: string, filters: FeatureFilters): Promise<PredictionResult[]> {
    const impl = this.resolve(model);
    const cohort = await this.featureStore.getCohortFeatures(filters);
    const now = new Date().toISOString();
    return cohort
      .map((f) => impl.predict(f, now))
      .sort((a, b) => a.score - b.score);
  }
}
