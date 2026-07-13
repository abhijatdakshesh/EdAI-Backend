import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { resolveCollegeId } from '../lms/tenant-context';
import { GamificationService } from './gamification.service';

@UseGuards(JwtAuthGuard)
@Controller('gamification')
export class GamificationController {
  constructor(private readonly svc: GamificationService) {}

  @Get('profile/:courseId')
  profile(
    @Req() req: { user?: { sub?: string; usn?: string; institutionId?: string } },
    @Param('courseId') courseId: string,
    @Query('usn') usn?: string,
  ) {
    const student = usn ?? req.user?.usn ?? req.user?.sub ?? '';
    return this.svc.getProfile(resolveCollegeId(req), student, courseId);
  }

  @Get('leaderboard/:courseId')
  leaderboard(
    @Req() req: { user?: { sub?: string; usn?: string; institutionId?: string } },
    @Param('courseId') courseId: string,
  ) {
    const student = req.user?.usn ?? req.user?.sub ?? '';
    return this.svc.getLeaderboard(resolveCollegeId(req), student, courseId);
  }
}
