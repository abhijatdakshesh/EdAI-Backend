import { Module } from '@nestjs/common';
import { ProctorController, ProctorStaffController } from './proctor.controller';
import { ProctorService } from './proctor.service';

@Module({
  controllers: [ProctorController, ProctorStaffController],
  providers: [ProctorService],
  exports: [ProctorService],
})
export class ProctorModule {}
