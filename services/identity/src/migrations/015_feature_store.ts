import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 0 — Shared Feature Store.
 *
 * Assembles canonical per-student signals consumed by ALL predictive features
 * (placement readiness, accreditation, scholarship, parent agent, faculty dev).
 * Model-specific weighting lives in the prediction service, NOT here — this view
 * stays a neutral, reusable signal layer.
 *
 * NOTE: Built against the LIVE runtime schema created by seed_chatbot_data.sql:
 *   attendance(student_usn, subject_name, status, attendance_date)
 *   internal_marks(student_usn, subject_name, exam_type, marks_obtained, max_marks)
 *   fee_payments(student_usn, total_amount, paid_amount, payment_status, due_date)
 * The older `student_risk_scores` view (migration 002) assumed different column
 * names (date / subject_code / test_type / status); that inconsistency is
 * corrected in migration 016_fix_risk_view_schema.
 */
export class AddFeatureStore1700000000015 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE VIEW student_feature_snapshots AS
      WITH
      att_30 AS (
        SELECT
          student_usn,
          COUNT(*) AS total_classes,
          ROUND(
            COUNT(*) FILTER (WHERE status = 'PRESENT') * 100.0
            / NULLIF(COUNT(*), 0), 1
          ) AS att_pct
        FROM attendance
        WHERE attendance_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY student_usn
      ),
      att_this_week AS (
        SELECT student_usn,
               ROUND(COUNT(*) FILTER (WHERE status = 'PRESENT') * 100.0
                     / NULLIF(COUNT(*), 0), 1) AS pct
        FROM attendance
        WHERE attendance_date >= DATE_TRUNC('week', CURRENT_DATE)
        GROUP BY student_usn
      ),
      att_last_week AS (
        SELECT student_usn,
               ROUND(COUNT(*) FILTER (WHERE status = 'PRESENT') * 100.0
                     / NULLIF(COUNT(*), 0), 1) AS pct
        FROM attendance
        WHERE attendance_date >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days'
          AND attendance_date <  DATE_TRUNC('week', CURRENT_DATE)
        GROUP BY student_usn
      ),
      trend AS (
        SELECT COALESCE(tw.student_usn, lw.student_usn) AS student_usn,
               COALESCE(tw.pct, 0) - COALESCE(lw.pct, 0) AS delta_pct
        FROM att_this_week tw
        FULL OUTER JOIN att_last_week lw USING (student_usn)
      ),
      marks AS (
        SELECT
          student_usn,
          ROUND(AVG(marks_obtained * 100.0 / NULLIF(max_marks, 0)), 1) AS avg_marks_pct,
          COUNT(DISTINCT subject_name) FILTER (
            WHERE marks_obtained * 100.0 / NULLIF(max_marks, 0) < 40
          ) AS failing_subject_count
        FROM internal_marks
        WHERE exam_type IN ('IA1', 'IA2', 'IA3')
        GROUP BY student_usn
      ),
      fees AS (
        SELECT
          student_usn,
          CASE
            WHEN bool_or(payment_status = 'OVERDUE') THEN 'OVERDUE'
            WHEN bool_or(payment_status = 'PARTIAL') THEN 'PARTIAL'
            WHEN bool_or(payment_status = 'PENDING') THEN 'PENDING'
            ELSE 'PAID'
          END AS worst_status,
          COALESCE(SUM(GREATEST(total_amount - paid_amount, 0)), 0) AS outstanding_amount
        FROM fee_payments
        WHERE due_date IS NULL OR due_date <= CURRENT_DATE
        GROUP BY student_usn
      )
      SELECT
        s.usn                                   AS student_usn,
        s.name,
        s.department,
        s.semester,
        s.section,
        COALESCE(s.preferred_language, 'en')     AS preferred_language,
        COALESCE(a.att_pct, 0)                    AS attendance_pct_30d,
        COALESCE(t.delta_pct, 0)                  AS attendance_trend_delta,
        COALESCE(m.avg_marks_pct, 0)              AS avg_marks_pct,
        COALESCE(m.failing_subject_count, 0)      AS failing_subject_count,
        COALESCE(f.worst_status, 'PAID')          AS fee_status,
        COALESCE(f.outstanding_amount, 0)         AS fee_outstanding,
        NOW()                                     AS computed_at
      FROM students s
      LEFT JOIN att_30 a ON a.student_usn = s.usn
      LEFT JOIN trend  t ON t.student_usn = s.usn
      LEFT JOIN marks  m ON m.student_usn = s.usn
      LEFT JOIN fees   f ON f.student_usn = s.usn;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS student_feature_snapshots;`);
  }
}
