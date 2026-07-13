import { Module } from '@nestjs/common';
import { FeatureStoreController } from './feature-store.controller';
import { FeatureStoreService } from './feature-store.service';

/**
 * Phase 0 — shared feature store. Exported so predictive feature modules
 * (prediction engine, placement intelligence, accreditation, etc.) can inject
 * FeatureStoreService instead of re-querying source tables.
 */
@Module({
  controllers: [FeatureStoreController],
  providers: [FeatureStoreService],
  exports: [FeatureStoreService],
})
export class FeatureStoreModule {}
