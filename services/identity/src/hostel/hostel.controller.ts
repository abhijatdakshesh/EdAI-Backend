import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
  NotFoundException, BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { HostelService } from './hostel.service';

interface ComplaintDto { category?: string; description: string; }
interface LeaveDto { fromDate: string; toDate: string; reason: string; }
interface AllocateDto { roomId: string; bedNo?: number; messType?: string; }
interface VisitorDto { visitorName: string; relation?: string; purpose?: string; }

const WARDEN_ROLES = ['ADMIN', 'PRINCIPAL', 'HOD'] as const;

/**
 * Hostel Management API. Students read/act on their own record; warden/admin
 * roles manage allocation, complaint triage, and leave approval.
 */
@Controller('hostel')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HostelController {
  constructor(private readonly hostel: HostelService) {}

  private assertOwner(req: { user?: { role?: string; id?: string } }, usn: string) {
    if (req.user?.role === 'STUDENT' && req.user?.id !== usn) {
      throw new NotFoundException('Not found');
    }
  }

  @Get('student/:usn')
  @Roles('ADMIN', 'PRINCIPAL', 'HOD', 'STUDENT', 'PARENT')
  getStudent(@Param('usn') usn: string, @Req() req: { user: { role?: string; id?: string } }) {
    this.assertOwner(req, usn);
    return this.hostel.getStudentHostel(usn);
  }

  @Post('student/:usn/complaints')
  @Roles('ADMIN', 'PRINCIPAL', 'HOD', 'STUDENT')
  raiseComplaint(
    @Param('usn') usn: string,
    @Body() body: ComplaintDto,
    @Req() req: { user: { role?: string; id?: string } },
  ) {
    this.assertOwner(req, usn);
    if (!body?.description) throw new BadRequestException('description is required');
    return this.hostel.raiseComplaint(usn, body.category || 'GENERAL', body.description);
  }

  @Post('student/:usn/leave')
  @Roles('ADMIN', 'PRINCIPAL', 'HOD', 'STUDENT')
  requestLeave(
    @Param('usn') usn: string,
    @Body() body: LeaveDto,
    @Req() req: { user: { role?: string; id?: string } },
  ) {
    this.assertOwner(req, usn);
    if (!body?.fromDate || !body?.toDate || !body?.reason) {
      throw new BadRequestException('fromDate, toDate, reason are required');
    }
    return this.hostel.requestLeave(usn, body.fromDate, body.toDate, body.reason);
  }

  @Get('student/:usn/visitors')
  @Roles('ADMIN', 'PRINCIPAL', 'HOD', 'STUDENT', 'PARENT')
  visitors(@Param('usn') usn: string, @Req() req: { user: { role?: string; id?: string } }) {
    this.assertOwner(req, usn);
    return this.hostel.listVisitors(usn);
  }

  // ── Warden / admin ──

  @Get('complaints')
  @Roles(...WARDEN_ROLES)
  listComplaints(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.hostel.listComplaints({ status, limit: limit ? parseInt(limit, 10) : 200 });
  }

  @Patch('complaints/:id/resolve')
  @Roles(...WARDEN_ROLES)
  async resolve(@Param('id') id: string, @Req() req: { user: { id?: string } }) {
    const c = await this.hostel.resolveComplaint(id, req.user?.id ?? 'warden');
    if (!c) throw new NotFoundException('Complaint not found');
    return c;
  }

  @Get('leave')
  @Roles(...WARDEN_ROLES)
  listLeave(@Query('status') status?: string) {
    return this.hostel.listLeave({ status });
  }

  @Patch('leave/:id')
  @Roles(...WARDEN_ROLES)
  async decideLeave(
    @Param('id') id: string,
    @Body() body: { approve: boolean },
    @Req() req: { user: { id?: string } },
  ) {
    const l = await this.hostel.decideLeave(id, Boolean(body?.approve), req.user?.id ?? 'warden');
    if (!l) throw new NotFoundException('Leave request not found or already decided');
    return l;
  }

  @Post('allocate/:usn')
  @Roles('ADMIN', 'PRINCIPAL')
  async allocate(@Param('usn') usn: string, @Body() body: AllocateDto) {
    if (!body?.roomId) throw new BadRequestException('roomId is required');
    const res = await this.hostel.allocateRoom(usn, body.roomId, body.bedNo ?? 1, body.messType ?? 'VEG');
    if (!res.ok) throw new BadRequestException(res.reason ?? 'allocation-failed');
    return res;
  }

  @Post('visitors/:usn')
  @Roles(...WARDEN_ROLES)
  logVisitor(@Param('usn') usn: string, @Body() body: VisitorDto) {
    if (!body?.visitorName) throw new BadRequestException('visitorName is required');
    return this.hostel.logVisitor(usn, body.visitorName, body.relation || '', body.purpose || '');
  }

  @Patch('visitors/:id/checkout')
  @Roles(...WARDEN_ROLES)
  checkoutVisitor(@Param('id') id: string) {
    return this.hostel.checkoutVisitor(id);
  }

  @Get('occupancy')
  @Roles(...WARDEN_ROLES)
  occupancy() {
    return this.hostel.occupancySummary();
  }
}
