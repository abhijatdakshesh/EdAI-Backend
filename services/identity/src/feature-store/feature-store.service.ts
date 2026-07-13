import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Canonical per-student signal vector, read from the `student_feature_snapshots`
 * view. This is the single source of truth every predictive feature consumes —
 * no feature should query attendance/marks/fees tables directly.
 */
export interface StudentFeatures {
  studentUsn: string;
  name: string;
  department: string;
  semester: number;
  section: string;
  preferredLanguage: string;
  attendancePct30d: number;
  attendanceTrendDelta: number;
  avgMarksPct: number;
  failingSubjectCount: number;
  feeStatus: string;
  feeOutstanding: number;
  computedAt: string;
}

export interface FeatureFilters {
  department?: string;
  semester?: number;
  limit?: number;
}

const SELECT_COLUMNS = `
  student_usn            AS "studentUsn",
  name,
  department,
  semester,
  section,
  preferred_language     AS "preferredLanguage",
  attendance_pct_30d     AS "attendancePct30d",
  attendance_trend_delta AS "attendanceTrendDelta",
  avg_marks_pct          AS "avgMarksPct",
  failing_subject_count  AS "failingSubjectCount",
  fee_status             AS "feeStatus",
  fee_outstanding        AS "feeOutstanding",
  computed_at            AS "computedAt"
`;

@Injectable()
export class FeatureStoreService {
  private readonly logger = new Logger(FeatureStoreService.name);

  constructor(@Optional() @InjectDataSource() private readonly db: DataSource | null) {}

  /** Signal vector for one student. Returns null when absent or DB offline. */
  async getStudentFeatures(usn: string): Promise<StudentFeatures | null> {
    if (!this.db) return null;
    const rows = await this.db.query(
      `SELECT ${SELECT_COLUMNS} FROM student_feature_snapshots WHERE student_usn = $1`,
      [usn],
    );
    return rows.length ? this.map(rows[0]) : null;
  }

  /** Batch signal vectors, optionally scoped by department / semester. */
  async getCohortFeatures(filters: FeatureFilters = {}): Promise<StudentFeatures[]> {
    if (!this.db) return [];
    const { department, semester, limit = 500 } = filters;
    let query = `SELECT ${SELECT_COLUMNS} FROM student_feature_snapshots WHERE 1 = 1`;
    const params: unknown[] = [];
    let i = 1;
    if (department) {
      query += ` AND department = $${i++}`;
      params.push(department);
    }
    if (semester !== undefined) {
      query += ` AND semester = $${i++}`;
      params.push(semester);
    }
    query += ` ORDER BY student_usn LIMIT $${i}`;
    params.push(limit);
    const rows = await this.db.query(query, params);
    return rows.map((r: Record<string, unknown>) => this.map(r));
  }

  private map(r: Record<string, unknown>): StudentFeatures {
    return {
      studentUsn: r['studentUsn'] as string,
      name: r['name'] as string,
      department: r['department'] as string,
      semester: Number(r['semester']),
      section: r['section'] as string,
      preferredLanguage: (r['preferredLanguage'] as string) ?? 'en',
      attendancePct30d: Number(r['attendancePct30d']),
      attendanceTrendDelta: Number(r['attendanceTrendDelta']),
      avgMarksPct: Number(r['avgMarksPct']),
      failingSubjectCount: Number(r['failingSubjectCount']),
      feeStatus: r['feeStatus'] as string,
      feeOutstanding: Number(r['feeOutstanding']),
      computedAt: r['computedAt'] as string,
    };
  }
}
