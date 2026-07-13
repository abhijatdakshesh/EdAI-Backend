import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { resolveCollegeId } from '../lms/tenant-context';
import { RevisionService } from './revision.service';

@UseGuards(JwtAuthGuard)
@Controller('revision')
export class RevisionController {
  constructor(private readonly svc: RevisionService) {}

  /** Revision plan for the signed-in student (or :usn for staff). */
  @Get('plan/:courseId')
  myPlan(
    @Req() req: { user?: { sub?: string; usn?: string; institutionId?: string } },
    @Param('courseId') courseId: string,
    @Query('usn') usn?: string,
    @Query('threshold') threshold?: string,
  ) {
    const collegeId = resolveCollegeId(req);
    const student = usn ?? req.user?.usn ?? req.user?.sub ?? '';
    const t = threshold ? Math.max(0, Math.min(1, Number(threshold))) : undefined;
    return this.svc.getRevisionPlan(collegeId, student, courseId, t);
  }
}
