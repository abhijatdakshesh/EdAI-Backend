import { Module } from '@nestjs/common';
import { FeatureStoreModule } from '../feature-store/feature-store.module';
import { PredictionController } from './prediction.controller';
import { PredictionService } from './prediction.service';

/**
 * Phase 0 prediction engine. Depends only on the shared feature store; every
 * predictive feature (placement, accreditation, scholarship, …) builds on top
 * of this module rather than re-querying source data.
 */
@Module({
  imports: [FeatureStoreModule],
  controllers: [PredictionController],
  providers: [PredictionService],
  exports: [PredictionService],
})
export class PredictionModule {}
