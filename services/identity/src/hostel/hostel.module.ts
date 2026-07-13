import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HostelController } from './hostel.controller';
import { HostelService } from './hostel.service';

/**
 * Hostel Management — allocation/rooms, complaints, leave, mess, visitors.
 * DB-backed replacement for the in-memory hostel data in student-portal.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [HostelController],
  providers: [HostelService],
  exports: [HostelService],
})
export class HostelModule {}
