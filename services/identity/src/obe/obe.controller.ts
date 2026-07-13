import { Controller, Get, Post, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { resolveCollegeId } from '../lms/tenant-context';
import { ObeService } from './obe.service';
import { ObeAttainmentService } from './obe-attainment.service';
import { AssessmentComponent } from '../entities/obe.entity';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PRINCIPAL', 'DEAN', 'HOD', 'FACULTY')
@Controller('obe')
export class ObeController {
  constructor(
    private readonly obe: ObeService,
    private readonly attain: ObeAttainmentService,
  ) {}

  // ── Programs / outcomes ────────────────────────────────────────────────
  @Get('programs')
  listPrograms(@Req() req: unknown) {
    return this.obe.listPrograms(resolveCollegeId(req));
  }

  @Post('programs')
  upsertProgram(@Req() req: unknown, @Body() body: Record<string, unknown>) {
    return this.obe.upsertProgram(resolveCollegeId(req), body);
  }

  @Get('outcomes')
  listOutcomes(@Req() req: unknown, @Query('programId') programId: string) {
    return this.obe.listOutcomes(resolveCollegeId(req), programId);
  }

  @Post('outcomes')
  upsertOutcome(@Req() req: unknown, @Body() body: Record<string, unknown>) {
    return this.obe.upsertOutcome(resolveCollegeId(req), body);
  }

  @Post('outcomes/seed-standard')
  seedStandard(@Req() req: unknown, @Body() body: { programId: string }) {
    return this.obe.seedStandardPos(resolveCollegeId(req), body.programId);
  }

  // ── Course outcomes ────────────────────────────────────────────────────
  @Get('courses/:courseId/cos')
  listCos(@Req() req: unknown, @Param('courseId') courseId: string) {
    return this.obe.listCos(resolveCollegeId(req), courseId);
  }

  @Post('courses/:courseId/cos')
  upsertCo(@Req() req: unknown, @Param('courseId') courseId: string, @Body() body: Record<string, unknown>) {
    return this.obe.upsertCo(resolveCollegeId(req), courseId, body);
  }

  @Delete('cos/:id')
  deleteCo(@Req() req: unknown, @Param('id') id: string) {
    this.obe.deleteCo(resolveCollegeId(req), id);
    return { ok: true };
  }

  @Post('courses/:courseId/cos/suggest')
  async suggestCos(@Req() req: unknown, @Param('courseId') courseId: string, @Body() body: { syllabus: string }) {
    return this.obe.suggestCosFromSyllabus(resolveCollegeId(req), courseId, body?.syllabus ?? '');
  }

  // ── CO-PO matrix ───────────────────────────────────────────────────────
  @Get('courses/:courseId/matrix')
  getMatrix(@Req() req: unknown, @Param('courseId') courseId: string, @Query('programId') programId: string) {
    return this.obe.getMatrix(resolveCollegeId(req), courseId, programId);
  }

  @Post('matrix/cell')
  setCell(@Req() req: unknown, @Body() body: { coId: string; outcomeId: string; correlation: number }) {
    this.obe.setMatrixCell(resolveCollegeId(req), body.coId, body.outcomeId, Number(body.correlation));
    return { ok: true };
  }

  // ── Assessment ↔ CO ────────────────────────────────────────────────────
  @Get('courses/:courseId/assessment-map')
  listAssessmentMap(@Req() req: unknown, @Param('courseId') courseId: string) {
    return this.obe.listAssessmentMap(resolveCollegeId(req), courseId);
  }

  @Post('courses/:courseId/assessment-map')
  setAssessmentMap(
    @Req() req: unknown,
    @Param('courseId') courseId: string,
    @Body() body: { component: AssessmentComponent; coId: string; questionNo?: number; maxMarks?: number },
  ) {
    return this.obe.setAssessmentMap(
      resolveCollegeId(req), courseId, body.component, body.coId, body.questionNo, body.maxMarks ?? 0,
    );
  }

  // ── Question marks ─────────────────────────────────────────────────────
  @Get('courses/:courseId/question-marks')
  getQuestionMarks(@Req() req: unknown, @Param('courseId') courseId: string, @Query('component') component?: AssessmentComponent) {
    return this.obe.getQuestionMarks(resolveCollegeId(req), courseId, component);
  }

  @Post('courses/:courseId/question-marks')
  saveQuestionMarks(
    @Req() req: unknown,
    @Param('courseId') courseId: string,
    @Body() body: { component: AssessmentComponent; rows: Array<{ usn: string; questionNo: number; marks: number; maxMarks: number }> },
  ) {
    this.obe.saveQuestionMarks(resolveCollegeId(req), courseId, body.component, body.rows ?? []);
    return { ok: true };
  }

  // ── Exit survey + config ───────────────────────────────────────────────
  @Post('courses/:courseId/exit-survey')
  setSurvey(@Req() req: unknown, @Param('courseId') courseId: string, @Body() body: { coId: string; avgRating: number; responseCount: number }) {
    return this.obe.upsertExitSurvey(resolveCollegeId(req), courseId, body.coId, body.avgRating, body.responseCount ?? 0);
  }

  @Get('courses/:courseId/config')
  getConfig(@Req() req: unknown, @Param('courseId') courseId: string) {
    return this.obe.getConfig(resolveCollegeId(req), courseId);
  }

  @Post('courses/:courseId/config')
  setConfig(@Req() req: unknown, @Param('courseId') courseId: string, @Body() body: Record<string, number>) {
    return this.obe.setConfig(resolveCollegeId(req), courseId, body);
  }

  // ── Attainment dashboards ──────────────────────────────────────────────
  @Get('courses/:courseId/attainment')
  courseAttainment(@Req() req: unknown, @Param('courseId') courseId: string, @Query('sem') sem?: string) {
    return this.attain.getCourseDashboard(resolveCollegeId(req), courseId, Number(sem ?? 5));
  }

  @Get('programs/:programId/attainment')
  programAttainment(
    @Req() req: unknown,
    @Param('programId') programId: string,
    @Query('courses') courses?: string,
    @Query('sem') sem?: string,
  ) {
    const courseIds = (courses ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    return this.attain.getProgramDashboard(resolveCollegeId(req), programId, courseIds, Number(sem ?? 5));
  }
}
