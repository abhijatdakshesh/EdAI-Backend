import { Module } from '@nestjs/common';
import { LmsModule } from '../lms/lms.module';
import { RevisionController } from './revision.controller';
import { RevisionService } from './revision.service';

@Module({
  imports: [LmsModule],
  controllers: [RevisionController],
  providers: [RevisionService],
  exports: [RevisionService],
})
export class RevisionModule {}
