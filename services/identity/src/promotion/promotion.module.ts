import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromotionController } from './promotion.controller';
import { PromotionService } from './promotion.service';
import { PromotionBatchEntity, PromotionAuditEntity } from '../entities/promotion-batch.entity';
import { assertRegistered } from '../entities/registry';

@Module({
  imports: process.env['DATABASE_URL']
    ? [TypeOrmModule.forFeature(assertRegistered([PromotionBatchEntity, PromotionAuditEntity]))]
    : [],
  controllers: [PromotionController],
  providers: [PromotionService],
  exports: [PromotionService],
})
export class PromotionModule {}
