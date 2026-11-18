import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObeController } from './obe.controller';
import { ObeService } from './obe.service';
import { ObeAttainmentService } from './obe-attainment.service';
import { IaModule } from '../ia/ia.module';
import { CoursesModule } from '../courses/courses.module';
import {
  ObeProgramEntity, ObeOutcomeEntity, CourseOutcomeEntity, CoPoMapEntity,
  AssessmentCoMapEntity, QuestionMarkEntity, ExitSurveyEntity, AttainmentConfigEntity,
} from '../entities/obe.entity';
import { assertRegistered } from '../entities/registry';

@Module({
  imports: [
    IaModule,
    CoursesModule,
    ...(process.env['DATABASE_URL']
      ? [TypeOrmModule.forFeature(assertRegistered([
          ObeProgramEntity, ObeOutcomeEntity, CourseOutcomeEntity, CoPoMapEntity,
          AssessmentCoMapEntity, QuestionMarkEntity, ExitSurveyEntity, AttainmentConfigEntity,
        ]))]
      : []),
  ],
  controllers: [ObeController],
  providers: [ObeService, ObeAttainmentService],
  exports: [ObeService, ObeAttainmentService],
})
export class ObeModule {}
