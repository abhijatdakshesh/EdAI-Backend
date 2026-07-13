import { PredictiveModel } from './model.types';
import { PlacementReadinessModel } from './placement-readiness.model';

/**
 * Model registry. Register new predictive models here (accreditation, fee-default,
 * scholarship-match, …) as later phases land — the prediction service, controller,
 * and API contract stay unchanged.
 */
export const MODEL_REGISTRY: Record<string, PredictiveModel> = {
  [new PlacementReadinessModel().id]: new PlacementReadinessModel(),
};

export const AVAILABLE_MODELS = Object.keys(MODEL_REGISTRY);

export * from './model.types';
