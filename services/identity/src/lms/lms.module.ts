import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LmsController } from './lms.controller';
import { LmsExtensionsController } from './lms-extensions.controller';
import { LmsHotlineController } from './lms-hotline.controller';
import { LmsService } from './lms.service';
import { LmsExtensionsService } from './lms-extensions.service';
import { LmsCronService } from './lms-cron.service';
import { AbcCreditsModule } from '../abc-credits/abc-credits.module';
import {
  LessonEntity, LessonProgressEntity, ModuleEntity, TopicMasteryEntity,
} from '../entities/lms.entity';
import {
  LmsAssignmentEntity, LmsSubmissionEntity, LmsQuizQuestionEntity, LmsDiscussionPostEntity,
  LmsLessonPrerequisiteEntity, LmsLearningSessionEntity, LmsStreakEntity,
} from '../entities/lms-extensions.entity';
import { assertRegistered } from '../entities/registry';
import { CommsModule } from '../comms/comms.module';
import { EventsModule } from '../events/events.module';
import { CoursesModule } from '../courses/courses.module';

@Module({
  imports: [
    forwardRef(() => CommsModule),
    EventsModule,
    AbcCreditsModule,
    forwardRef(() => CoursesModule),
    ...(process.env['DATABASE_URL']
      ? [TypeOrmModule.forFeature(assertRegistered([
          ModuleEntity, LessonEntity, LessonProgressEntity, TopicMasteryEntity,
          // Extension tables ship in migration 013 but were never injected, so
          // assignments/submissions/quizzes/discussions/streaks lived only in
          // process memory and reset on every cold start.
          LmsAssignmentEntity, LmsSubmissionEntity, LmsQuizQuestionEntity, LmsDiscussionPostEntity,
          LmsLessonPrerequisiteEntity, LmsLearningSessionEntity, LmsStreakEntity,
        ]))]
      : []),
  ],
  controllers: [LmsController, LmsExtensionsController, LmsHotlineController],
  providers: [LmsService, LmsExtensionsService, LmsCronService],
  exports: [LmsService, LmsExtensionsService, LmsCronService],
})
export class LmsModule {}
