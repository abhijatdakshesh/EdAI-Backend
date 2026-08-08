import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VtuController } from './vtu.controller';
import { VtuService } from './vtu.service';
import { VtuNotificationsService } from './vtu-notifications.service';
import { EventsModule } from '../events/events.module';
import { VtuWindowEntity, VtuEligibilityEntity, VtuRegistrationEntity } from '../entities/vtu.entity';
import { assertRegistered } from '../entities/registry';

@Module({
  imports: [
    EventsModule,
    ...(process.env['DATABASE_URL']
      ? [TypeOrmModule.forFeature(
          assertRegistered([VtuWindowEntity, VtuEligibilityEntity, VtuRegistrationEntity]),
        )]
      : []),
  ],
  controllers: [VtuController],
  providers: [VtuService, VtuNotificationsService],
  exports: [VtuService, VtuNotificationsService],
})
export class VtuModule {}
