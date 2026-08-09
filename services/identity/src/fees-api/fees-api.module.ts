import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeesApiController } from './fees-api.controller';
import { FeesApiService } from './fees-api.service';
import { FeeItemEntity } from '../entities/fee-item.entity';
import { assertRegistered } from '../entities/registry';

@Module({
  imports: process.env['DATABASE_URL']
    ? [TypeOrmModule.forFeature(assertRegistered([FeeItemEntity]))]
    : [],
  controllers: [FeesApiController],
  providers: [FeesApiService],
  exports: [FeesApiService],
})
export class FeesApiModule {}
