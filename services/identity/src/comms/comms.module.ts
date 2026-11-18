import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommsController, PublicCommsController, AudioController } from './comms.controller';
import { CommsService } from './comms.service';
import { ConsentService } from './consent.service';
import { ConversationStateService } from './conversation-state.service';
import { EventsModule } from '../events/events.module';
import { StudentPortalModule } from '../student-portal/student-portal.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { AiCallLogEntity, AnnouncementEntity } from '../entities/comms.entity';
import { assertRegistered } from '../entities/registry';

@Module({
  imports: [
    EventsModule,
    forwardRef(() => StudentPortalModule),
    ChatbotModule,
    ...(process.env['DATABASE_URL']
      ? [TypeOrmModule.forFeature(assertRegistered([AiCallLogEntity, AnnouncementEntity]))]
      : []),
  ],
  controllers: [PublicCommsController, AudioController, CommsController],
  providers: [CommsService, ConsentService, ConversationStateService],
  exports: [CommsService, ConsentService, ConversationStateService],
})
export class CommsModule {}
