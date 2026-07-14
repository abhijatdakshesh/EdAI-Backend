import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface HostelAllocation {
  studentUsn: string;
  block: string;
  blockType: string;
  roomNumber: string;
  floor: number;
  bedNo: number;
  messType: string;
  warden: string | null;
  wardenPhone: string | null;
  status: string;
}

export interface Complaint {
  id: string;
  studentUsn: string;
  category: string;
  description: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface LeaveRequest {
  id: string;
  studentUsn: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: string;
  approvedBy: string | null;
  createdAt: string;
}

@Injectable()
export class HostelService {
  private readonly logger = new Logger(HostelService.name);

  constructor(@Optional() @InjectDataSource() private readonly db: DataSource | null) {}

  /** A student's current allocation + warden + mess menu. */
  async getStudentHostel(usn: string): Promise<(HostelAllocation & { messMenu: unknown[] }) | null> {
    if (!this.db) return null;
    const rows = await this.db.query(
      `SELECT a.student_usn, a.bed_no, a.mess_type, a.status,
              r.room_number, r.floor, r.block_id,
              b.name AS block, b.type AS block_type, b.warden_name, b.warden_phone
       FROM hostel_allocations a
       JOIN hostel_rooms  r ON r.id = a.room_id
       JOIN hostel_blocks b ON b.id = r.block_id
       WHERE a.student_usn = $1`,
      [usn],
    );
    if (!rows.length) return null;
    const r = rows[0];
    const messMenu = await this.db.query(
      `SELECT day, breakfast, lunch, dinner FROM mess_menu WHERE block_id = $1 ORDER BY id`,
      [r.block_id],
    );
    return {
      studentUsn: r.student_usn,
      block: r.block,
      blockType: r.block_type,
      roomNumber: r.room_number,
      floor: Number(r.floor),
      bedNo: Number(r.bed_no),
      messType: r.mess_type,
      warden: r.warden_name ?? null,
      wardenPhone: r.warden_phone ?? null,
      status: r.status,
      messMenu,
    };
  }

  /** Admin: allocate a student to a room (increments occupancy atomically). */
  async allocateRoom(usn: string, roomId: string, bedNo = 1, messType = 'VEG'): Promise<{ ok: boolean; reason?: string }> {
    if (!this.db) return { ok: false, reason: 'no-db' };
    return this.db.transaction(async (mgr) => {
      const room = await mgr.query(`SELECT capacity, occupied FROM hostel_rooms WHERE id = $1 FOR UPDATE`, [roomId]);
      if (!room.length) return { ok: false, reason: 'room-not-found' };
      if (Number(room[0].occupied) >= Number(room[0].capacity)) return { ok: false, reason: 'room-full' };
      await mgr.query(
        `INSERT INTO hostel_allocations (student_usn, room_id, bed_no, mess_type)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_usn) DO UPDATE SET room_id = EXCLUDED.room_id,
           bed_no = EXCLUDED.bed_no, mess_type = EXCLUDED.mess_type, status = 'ACTIVE'`,
        [usn, roomId, bedNo, messType],
      );
      await mgr.query(`UPDATE hostel_rooms SET occupied = occupied + 1 WHERE id = $1`, [roomId]);
      return { ok: true };
    });
  }

  async raiseComplaint(usn: string, category: string, description: string): Promise<Complaint | null> {
    if (!this.db) return null;
    const rows = await this.db.query(
      `INSERT INTO hostel_complaints (student_usn, category, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [usn, category, description],
    );
    return this.mapComplaint(rows[0]);
  }

  async listComplaints(filters: { status?: string; usn?: string; limit?: number } = {}): Promise<Complaint[]> {
    if (!this.db) return [];
    const { status, usn, limit = 200 } = filters;
    let q = `SELECT * FROM hostel_complaints WHERE 1=1`;
    const params: unknown[] = [];
    let i = 1;
    if (status) { q += ` AND status = $${i++}`; params.push(status.toUpperCase()); }
    if (usn) { q += ` AND student_usn = $${i++}`; params.push(usn); }
    q += ` ORDER BY created_at DESC LIMIT $${i}`;
    params.push(limit);
    const rows = await this.db.query(q, params);
    return rows.map(this.mapComplaint);
  }

  async resolveComplaint(id: string, resolvedBy: string): Promise<Complaint | null> {
    if (!this.db) return null;
    const rows = await this.db.query(
      `UPDATE hostel_complaints
       SET status = 'RESOLVED', resolved_by = $2, resolved_at = now()
       WHERE id = $1 RETURNING *`,
      [id, resolvedBy],
    );
    return rows.length ? this.mapComplaint(rows[0]) : null;
  }

  async requestLeave(usn: string, fromDate: string, toDate: string, reason: string): Promise<LeaveRequest | null> {
    if (!this.db) return null;
    const rows = await this.db.query(
      `INSERT INTO hostel_leave_requests (student_usn, from_date, to_date, reason)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [usn, fromDate, toDate, reason],
    );
    return this.mapLeave(rows[0]);
  }

  async decideLeave(id: string, approve: boolean, by: string): Promise<LeaveRequest | null> {
    if (!this.db) return null;
    const rows = await this.db.query(
      `UPDATE hostel_leave_requests SET status = $2, approved_by = $3
       WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [id, approve ? 'APPROVED' : 'REJECTED', by],
    );
    return rows.length ? this.mapLeave(rows[0]) : null;
  }

  async listLeave(filters: { status?: string; usn?: string } = {}): Promise<LeaveRequest[]> {
    if (!this.db) return [];
    const { status, usn } = filters;
    let q = `SELECT * FROM hostel_leave_requests WHERE 1=1`;
    const params: unknown[] = [];
    let i = 1;
    if (status) { q += ` AND status = $${i++}`; params.push(status.toUpperCase()); }
    if (usn) { q += ` AND student_usn = $${i++}`; params.push(usn); }
    q += ` ORDER BY created_at DESC`;
    const rows = await this.db.query(q, params);
    return rows.map(this.mapLeave);
  }

  async logVisitor(usn: string, visitorName: string, relation: string, purpose: string): Promise<{ id: string } | null> {
    if (!this.db) return null;
    const rows = await this.db.query(
      `INSERT INTO hostel_visitors (student_usn, visitor_name, relation, purpose)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [usn, visitorName, relation, purpose],
    );
    return rows[0];
  }

  async checkoutVisitor(id: string): Promise<{ ok: boolean }> {
    if (!this.db) return { ok: false };
    await this.db.query(`UPDATE hostel_visitors SET out_time = now() WHERE id = $1 AND out_time IS NULL`, [id]);
    return { ok: true };
  }

  async listVisitors(usn: string): Promise<unknown[]> {
    if (!this.db) return [];
    return this.db.query(
      `SELECT id, visitor_name, relation, purpose, in_time, out_time
       FROM hostel_visitors WHERE student_usn = $1 ORDER BY in_time DESC LIMIT 100`,
      [usn],
    );
  }

  async occupancySummary(): Promise<unknown[]> {
    if (!this.db) return [];
    return this.db.query(
      `SELECT b.name AS block, b.type,
              COALESCE(SUM(r.capacity), 0) AS capacity,
              COALESCE(SUM(r.occupied), 0) AS occupied
       FROM hostel_blocks b LEFT JOIN hostel_rooms r ON r.block_id = b.id
       GROUP BY b.id ORDER BY b.name`,
    );
  }

  private mapComplaint = (r: Record<string, unknown>): Complaint => ({
    id: r['id'] as string,
    studentUsn: r['student_usn'] as string,
    category: r['category'] as string,
    description: r['description'] as string,
    status: r['status'] as string,
    createdAt: r['created_at'] as string,
    resolvedAt: (r['resolved_at'] as string) ?? null,
  });

  private mapLeave = (r: Record<string, unknown>): LeaveRequest => ({
    id: r['id'] as string,
    studentUsn: r['student_usn'] as string,
    fromDate: r['from_date'] as string,
    toDate: r['to_date'] as string,
    reason: r['reason'] as string,
    status: r['status'] as string,
    approvedBy: (r['approved_by'] as string) ?? null,
    createdAt: r['created_at'] as string,
  });
}
