import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { IntegrityService, SubmissionInput } from './integrity.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PRINCIPAL', 'HOD', 'FACULTY')
@Controller('integrity')
export class IntegrityController {
  constructor(private readonly svc: IntegrityService) {}

  /** Check a batch of submissions for plagiarism (pairwise) + AI-generated text. */
  @Post('check')
  check(@Body() body: { submissions: SubmissionInput[] }) {
    return this.svc.checkBatch(body?.submissions ?? []);
  }
}
