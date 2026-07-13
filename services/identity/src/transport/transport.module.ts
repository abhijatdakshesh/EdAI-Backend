import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';

/**
 * Bus Transportation — routes, stops, student passes, and live GPS tracking.
 * Imports EventsModule so location pings broadcast over WebSocket for live maps.
 */
@Module({
  imports: [DatabaseModule, EventsModule],
  controllers: [TransportController],
  providers: [TransportService],
  exports: [TransportService],
})
export class TransportModule {}
