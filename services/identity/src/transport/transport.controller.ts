import {
  Body, Controller, Get, Param, Post, Req, UseGuards, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { TransportService } from './transport.service';

interface LocationDto { lat: number; lng: number; speedKmph?: number; heading?: number; }
interface AllocateDto { routeId: string; stopId?: string; validUntil?: string; }

const STAFF_ROLES = ['ADMIN', 'PRINCIPAL', 'HOD'] as const;

/**
 * Bus Transportation API — student pass + live tracking (read), staff route/pass
 * management, and a GPS ingest endpoint for the bus device/driver app.
 */
@Controller('transport')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransportController {
  constructor(private readonly transport: TransportService) {}

  @Get('student/:usn')
  @Roles('ADMIN', 'PRINCIPAL', 'HOD', 'STUDENT', 'PARENT')
  getStudent(@Param('usn') usn: string, @Req() req: { user: { role?: string; id?: string } }) {
    if (req.user?.role === 'STUDENT' && req.user?.id !== usn) {
      throw new NotFoundException('Not found');
    }
    return this.transport.getStudentTransport(usn);
  }

  @Get('routes')
  @Roles('ADMIN', 'PRINCIPAL', 'HOD', 'STUDENT', 'PARENT')
  routes() {
    return this.transport.listRoutes();
  }

  @Get('routes/:id/stops')
  @Roles('ADMIN', 'PRINCIPAL', 'HOD', 'STUDENT', 'PARENT')
  stops(@Param('id') id: string) {
    return this.transport.routeStops(id);
  }

  @Get('routes/:id/location')
  @Roles('ADMIN', 'PRINCIPAL', 'HOD', 'STUDENT', 'PARENT')
  location(@Param('id') id: string) {
    return this.transport.latestLocation(id);
  }

  /**
   * GPS ingest from the on-bus device (authenticates as a DRIVER principal;
   * ADMIN/PRINCIPAL allowed for ops/testing). Emits over WebSocket for live maps.
   */
  @Post('routes/:id/location')
  @Roles('ADMIN', 'PRINCIPAL', 'DRIVER')
  recordLocation(@Param('id') id: string, @Body() body: LocationDto) {
    if (typeof body?.lat !== 'number' || typeof body?.lng !== 'number') {
      throw new BadRequestException('lat and lng are required numbers');
    }
    return this.transport.recordLocation(id, body.lat, body.lng, body.speedKmph, body.heading);
  }

  @Post('allocate/:usn')
  @Roles(...STAFF_ROLES)
  allocate(@Param('usn') usn: string, @Body() body: AllocateDto) {
    if (!body?.routeId) throw new BadRequestException('routeId is required');
    return this.transport.allocatePass(usn, body.routeId, body.stopId ?? null, body.validUntil ?? null);
  }
}
