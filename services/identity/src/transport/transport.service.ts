import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LatLng, etaMinutes } from './geo';
import { EventsGateway } from '../events/events.gateway';

export interface TransportAllocation {
  studentUsn: string;
  routeCode: string;
  routeName: string;
  driverName: string | null;
  driverPhone: string | null;
  vehicleNo: string | null;
  stopName: string | null;
  pickupTime: string | null;
  passStatus: string;
  feeStatus: string;
  validUntil: string | null;
}

export interface BusLocation {
  routeId: string;
  lat: number;
  lng: number;
  speedKmph: number | null;
  heading: number | null;
  recordedAt: string;
}

@Injectable()
export class TransportService {
  private readonly logger = new Logger(TransportService.name);

  constructor(
    @Optional() @InjectDataSource() private readonly db: DataSource | null,
    @Optional() private readonly events?: EventsGateway,
  ) {}

  /** A student's route/stop/pass + live bus location and ETA to their stop. */
  async getStudentTransport(usn: string): Promise<
    (TransportAllocation & { live: BusLocation | null; etaMinutes: number | null }) | null
  > {
    if (!this.db) return null;
    const rows = await this.db.query(
      `SELECT a.student_usn, a.pass_status, a.fee_status, a.valid_until, a.route_id,
              r.code AS route_code, r.name AS route_name, r.driver_name, r.driver_phone, r.vehicle_no,
              s.name AS stop_name, s.pickup_time, s.lat AS stop_lat, s.lng AS stop_lng
       FROM transport_allocations a
       JOIN bus_routes r ON r.id = a.route_id
       LEFT JOIN bus_stops s ON s.id = a.stop_id
       WHERE a.student_usn = $1`,
      [usn],
    );
    if (!rows.length) return null;
    const r = rows[0];

    const live = await this.latestLocation(r.route_id);
    const stop: LatLng | null =
      r.stop_lat != null && r.stop_lng != null ? { lat: Number(r.stop_lat), lng: Number(r.stop_lng) } : null;
    const busPos: LatLng | null = live ? { lat: live.lat, lng: live.lng } : null;

    return {
      studentUsn: r.student_usn,
      routeCode: r.route_code,
      routeName: r.route_name,
      driverName: r.driver_name ?? null,
      driverPhone: r.driver_phone ?? null,
      vehicleNo: r.vehicle_no ?? null,
      stopName: r.stop_name ?? null,
      pickupTime: r.pickup_time ?? null,
      passStatus: r.pass_status,
      feeStatus: r.fee_status,
      validUntil: r.valid_until ?? null,
      live,
      etaMinutes: etaMinutes(busPos, stop, live?.speedKmph),
    };
  }

  /** Latest GPS ping for a route (drives the live map). */
  async latestLocation(routeId: string): Promise<BusLocation | null> {
    if (!this.db) return null;
    const rows = await this.db.query(
      `SELECT route_id, lat, lng, speed_kmph, heading, recorded_at
       FROM bus_locations WHERE route_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [routeId],
    );
    return rows.length ? this.mapLocation(rows[0]) : null;
  }

  /** Ingest a GPS ping from the bus device/driver app. */
  async recordLocation(
    routeId: string,
    lat: number,
    lng: number,
    speedKmph?: number,
    heading?: number,
  ): Promise<BusLocation | null> {
    if (!this.db) return null;
    const rows = await this.db.query(
      `INSERT INTO bus_locations (route_id, lat, lng, speed_kmph, heading)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING route_id, lat, lng, speed_kmph, heading, recorded_at`,
      [routeId, lat, lng, speedKmph ?? null, heading ?? null],
    );
    if (!rows.length) return null;
    const loc = this.mapLocation(rows[0]);
    // Push to live subscribers (student/parent maps) if the gateway is present.
    this.events?.emitBusLocation({
      routeId: loc.routeId,
      lat: loc.lat,
      lng: loc.lng,
      speedKmph: loc.speedKmph,
      recordedAt: loc.recordedAt,
    });
    return loc;
  }

  async listRoutes(): Promise<unknown[]> {
    if (!this.db) return [];
    return this.db.query(
      `SELECT r.id, r.code, r.name, r.driver_name, r.driver_phone, r.vehicle_no, r.capacity,
              COUNT(a.id)::int AS allocated
       FROM bus_routes r
       LEFT JOIN transport_allocations a ON a.route_id = r.id
       WHERE r.active = true
       GROUP BY r.id ORDER BY r.code`,
    );
  }

  async routeStops(routeId: string): Promise<unknown[]> {
    if (!this.db) return [];
    return this.db.query(
      `SELECT id, name, seq, pickup_time, lat, lng FROM bus_stops
       WHERE route_id = $1 ORDER BY seq`,
      [routeId],
    );
  }

  async allocatePass(usn: string, routeId: string, stopId: string | null, validUntil: string | null): Promise<{ ok: boolean }> {
    if (!this.db) return { ok: false };
    await this.db.query(
      `INSERT INTO transport_allocations (student_usn, route_id, stop_id, valid_until)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (student_usn) DO UPDATE SET route_id = EXCLUDED.route_id,
         stop_id = EXCLUDED.stop_id, valid_until = EXCLUDED.valid_until, pass_status = 'ACTIVE'`,
      [usn, routeId, stopId, validUntil],
    );
    return { ok: true };
  }

  private mapLocation(r: Record<string, unknown>): BusLocation {
    return {
      routeId: r['route_id'] as string,
      lat: Number(r['lat']),
      lng: Number(r['lng']),
      speedKmph: r['speed_kmph'] == null ? null : Number(r['speed_kmph']),
      heading: r['heading'] == null ? null : Number(r['heading']),
      recordedAt: r['recorded_at'] as string,
    };
  }
}
