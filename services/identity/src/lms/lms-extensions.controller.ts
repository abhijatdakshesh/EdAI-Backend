import {
  Body, Controller, Get, Param, Post, Query, Request, UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { resolveCollegeId, getCollegeFeatures } from './tenant-context';
import { LmsExtensionsService } from './lms-extensions.service';
import { LmsService } from './lms.service';
import { LMS_DEMO_COURSE_ID } from './lms-demo-seed';

@UseGuards(JwtAuthGuard)
@Controller('lms')
export class LmsExtensionsController {
  constructor(
    private readonly ext: LmsExtensionsService,
    private readonly lms: LmsService,
  ) {}

  private usn(req: { user?: { sapId?: string; usn?: string; sub?: string } }) {
    return req.user?.sapId ?? req.user?.usn ?? req.user?.sub ?? '';
  }

  private isStudent(req: { user?: { role?: string } }) {
    return req.user?.role === 'STUDENT';
  }

  // ── Assignments ──────────────────────────────────────────────────────────

  @Get('lessons/:lessonId/assignments')
  listAssignments(@Param('lessonId') lessonId: string, @Request() req: any) {
    const collegeId = resolveCollegeId(req);
    return this.ext.listAssignments(collegeId, lessonId, this.isStudent(req));
  }

  @Post('assignments/:id/submit')
  submitAssignment(
    @Param('id') id: string,
    @Body() body: { body: string },
    @Request() req: any,
  ) {
    const collegeId = resolveCollegeId(req);
    const usn = this.usn(req);
    if (!usn) throw new BadRequestException('USN required');
    return this.ext.submitAssignment(collegeId, id, usn, body.body ?? '');
  }

  // ── Quizzes ──────────────────────────────────────────────────────────────

  @Get('quizzes/adaptive')
  async adaptiveQuiz(@Query('courseId') courseId: string, @Request() req: any) {
    if (!courseId) throw new BadRequestException('courseId required');
    const collegeId = resolveCollegeId(req);
    const usn = this.usn(req);
    if (this.isStudent(req)) this.lms.assertStudentEnrollment(usn, courseId);
    return this.ext.getAdaptiveQuiz(collegeId, usn, courseId);
  }

  @Post('quizzes/grade')
  gradeQuiz(
    @Body() body: { courseId: string; answers: Array<{ questionId: string; selectedIndex: number }> },
    @Request() req: any,
  ) {
    const collegeId = resolveCollegeId(req);
    const usn = this.usn(req);
    return this.ext.gradeQuiz(collegeId, usn, body.courseId, body.answers ?? []);
  }

  // ── Discussions ──────────────────────────────────────────────────────────

  @Get('lessons/:lessonId/discussions')
  listDiscussions(@Param('lessonId') lessonId: string, @Request() req: any) {
    return this.ext.listDiscussions(resolveCollegeId(req), lessonId);
  }

  @Post('lessons/:lessonId/discussions')
  postDiscussion(
    @Param('lessonId') lessonId: string,
    @Body() body: { body: string },
    @Request() req: any,
  ) {
    const collegeId = resolveCollegeId(req);
    return this.ext.postDiscussion(
      collegeId,
      lessonId,
      this.usn(req),
      req.user?.role ?? 'STUDENT',
      body.body ?? '',
    );
  }

  // ── Streaks + learning hours ─────────────────────────────────────────────

  @Get('streak')
  getStreak(@Request() req: any) {
    return this.ext.getStreak(resolveCollegeId(req), this.usn(req));
  }

  @Post('heartbeat')
  async heartbeat(
    @Body() body: { courseId: string; lessonId: string },
    @Request() req: any,
  ) {
    const collegeId = resolveCollegeId(req);
    const usn = this.usn(req);
    await this.ext.recordLearningMinute(collegeId, usn, body.courseId, body.lessonId);
    const streak = await this.ext.touchStreak(collegeId, usn);
    return { ok: true, ...streak, hours: await this.ext.getLearningHours(usn, body.courseId) };
  }

  @Get('learning-hours')
  async learningHours(@Query('courseId') courseId: string, @Request() req: any) {
    return { hours: await this.ext.getLearningHours(this.usn(req), courseId) };
  }

  // ── Faculty / admin analytics ────────────────────────────────────────────

  @Get('faculty/heatmap')
  heatmap(@Query('courseId') courseId: string, @Request() req: any) {
    if (!courseId) throw new BadRequestException('courseId required');
    return this.ext.facultyHeatmap(resolveCollegeId(req), courseId);
  }

  @Get('reports/naac-export')
  naacExport(@Query('courseId') courseId: string, @Request() req: any) {
    return this.ext.naacLmsExport(resolveCollegeId(req), courseId ?? LMS_DEMO_COURSE_ID);
  }

  // ── Placement bridge ─────────────────────────────────────────────────────

  @Get('placement/recommendations')
  placementRecs(@Query('courseId') courseId: string, @Request() req: any) {
    const collegeId = resolveCollegeId(req);
    const usn = this.usn(req);
    return this.ext.placementRecommendations(collegeId, usn, courseId);
  }

  // ── Phase 6 bulk import ────────────────────────────────────────────────────

  @Post('bulk-import/syllabus')
  bulkImport(
    @Body() body: { courseId: string; syllabus: string },
    @Request() req: any,
  ) {
    const collegeId = resolveCollegeId(req);
    const features = getCollegeFeatures(collegeId);
    if (features['lms_assignments'] === false) {
      throw new BadRequestException('LMS authoring disabled');
    }
    return this.ext.bulkImportSyllabus(collegeId, body.courseId, body.syllabus);
  }
}
