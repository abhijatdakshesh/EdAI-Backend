import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { ProctorService, FlagType } from './proctor.service';

@UseGuards(JwtAuthGuard)
@Controller('proctor')
export class ProctorController {
  constructor(private readonly svc: ProctorService) {}

  /** Student: fetch assessment questions (no answer key). */
  @Get('assessments/:id')
  getAssessment(@Param('id') id: string) {
    return this.svc.getForStudent(id);
  }

  @Post('assessments/:id/start')
  start(@Param('id') id: string, @Req() req: { user?: { sub?: string; usn?: string } }) {
    const usn = req.user?.usn ?? req.user?.sub ?? '';
    return this.svc.startAttempt(id, usn);
  }

  /** Record a proctoring event (tab switch, focus loss, fullscreen exit, …). */
  @Post('attempts/:attemptId/flag')
  flag(@Param('attemptId') attemptId: string, @Body() body: { type: FlagType }) {
    return this.svc.flag(attemptId, body.type);
  }

  @Post('attempts/:attemptId/submit')
  submit(@Param('attemptId') attemptId: string, @Body() body: { answers: Record<string, number> }) {
    return this.svc.submit(attemptId, body?.answers ?? {});
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PRINCIPAL', 'HOD', 'FACULTY')
@Controller('proctor')
export class ProctorStaffController {
  constructor(private readonly svc: ProctorService) {}

  /** Staff: all attempts + integrity for an assessment. */
  @Get('assessments/:id/attempts')
  attempts(@Param('id') id: string) {
    return this.svc.listAttempts(id);
  }
}
