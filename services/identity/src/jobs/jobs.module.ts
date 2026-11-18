import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { AlumniOutcomeEntity } from '../entities/placement.entity';
import { assertRegistered } from '../entities/registry';

@Module({
  imports: process.env['DATABASE_URL']
    ? [TypeOrmModule.forFeature(assertRegistered([AlumniOutcomeEntity]))]
    : [],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
