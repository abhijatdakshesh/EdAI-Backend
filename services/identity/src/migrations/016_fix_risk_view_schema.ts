import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix: `student_risk_scores` (migration 002) referenced column names that do
 * not exist in the live runtime schema created by seed_chatbot_data.sql, so the
 * view was broken (or silently empty) wherever the seed schema is authoritative:
 *
 *   attendance.date        → attendance.attendance_date
 *   internal_marks.subject_code → internal_marks.subject_name
 *   internal_marks.test_type    → internal_marks.exam_type
 *   fee_payments.status         → fee_payments.payment_status
 *
 * This migration redefines the view with the correct columns. Scoring logic,
 * output columns, and thresholds are unchanged — only source column names are
 * corrected — so RiskService and every consumer keep working untouched.
 */
export class FixRiskViewSchema1700000000016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE VIEW student_risk_scores AS
      WITH
      att_30 AS (
        SELECT
          student_usn,
          COUNT(*) AS total_classes,
          COUNT(*) FILTER (WHERE status = 'PRESENT') AS present_count,
          ROUND(
            COUNT(*) FILTER (WHERE status = 'PRESENT') * 100.0
            / NULLIF(COUNT(*), 0), 1
          ) AS att_pct
        FROM attendance
        WHERE attendance_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY student_usn
      ),
      att_this_week AS (
        SELECT
          student_usn,
          ROUND(
            COUNT(*) FILTER (WHERE status = 'PRESENT') * 100.0
            / NULLIF(COUNT(*), 0), 1
          ) AS pct
        FROM attendance
        WHERE attendance_date >= DATE_TRUNC('week', CURRENT_DATE)
        GROUP BY student_usn
      ),
      att_last_week AS (
        SELECT
          student_usn,
          ROUND(
            COUNT(*) FILTER (WHERE status = 'PRESENT') * 100.0
            / NULLIF(COUNT(*), 0), 1
          ) AS pct
        FROM attendance
        WHERE attendance_date >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days'
          AND attendance_date < DATE_TRUNC('week', CURRENT_DATE)
        GROUP BY student_usn
      ),
      failing_subjects AS (
        SELECT
          student_usn,
          COUNT(DISTINCT subject_name) AS failing_count
        FROM internal_marks
        WHERE marks_obtained * 100.0 / NULLIF(max_marks, 0) < 40
          AND exam_type IN ('IA1', 'IA2', 'IA3')
        GROUP BY student_usn
      ),
      fee_status AS (
        SELECT
          student_usn,
          CASE
            WHEN bool_or(payment_status = 'OVERDUE')  THEN 'OVERDUE'
            WHEN bool_or(payment_status = 'PARTIAL')  THEN 'PARTIAL'
            WHEN bool_or(payment_status = 'PENDING')  THEN 'PENDING'
            ELSE 'PAID'
          END AS worst_status
        FROM fee_payments
        WHERE due_date IS NULL OR due_date <= CURRENT_DATE
        GROUP BY student_usn
      ),
      trend AS (
        SELECT
          COALESCE(tw.student_usn, lw.student_usn) AS student_usn,
          COALESCE(tw.pct, 0) - COALESCE(lw.pct, 0) AS delta_pct
        FROM att_this_week tw
        FULL OUTER JOIN att_last_week lw USING (student_usn)
      ),
      scored AS (
        SELECT
          s.usn AS student_usn,
          s.name,
          s.department,
          s.semester,
          s.section,
          CASE
            WHEN COALESCE(a.att_pct, 0) < 50  THEN 45
            WHEN COALESCE(a.att_pct, 0) < 60  THEN 35
            WHEN COALESCE(a.att_pct, 0) < 75  THEN 20
            WHEN COALESCE(a.att_pct, 0) < 85  THEN 8
            ELSE 0
          END AS att_score,
          LEAST(COALESCE(f.failing_count, 0) * 12, 36) AS marks_score,
          CASE COALESCE(fs.worst_status, 'PAID')
            WHEN 'OVERDUE'  THEN 20
            WHEN 'PARTIAL'  THEN 10
            WHEN 'PENDING'  THEN 5
            ELSE 0
          END AS fee_score,
          GREATEST(
            CASE
              WHEN COALESCE(t.delta_pct, 0) < -15 THEN 12
              WHEN COALESCE(t.delta_pct, 0) < -5  THEN 6
              WHEN COALESCE(t.delta_pct, 0) > 5   THEN -5
              ELSE 0
            END,
          0) AS trend_score,
          COALESCE(a.att_pct, 0)            AS attendance_pct,
          COALESCE(f.failing_count, 0)      AS failing_subject_count,
          COALESCE(fs.worst_status, 'PAID') AS fee_status,
          COALESCE(t.delta_pct, 0)          AS att_trend_delta
        FROM students s
        LEFT JOIN att_30          a  ON a.student_usn  = s.usn
        LEFT JOIN failing_subjects f  ON f.student_usn  = s.usn
        LEFT JOIN fee_status      fs ON fs.student_usn = s.usn
        LEFT JOIN trend           t  ON t.student_usn  = s.usn
      )
      SELECT
        student_usn,
        name,
        department,
        semester,
        section,
        attendance_pct,
        failing_subject_count,
        fee_status,
        att_trend_delta,
        att_score,
        marks_score,
        fee_score,
        trend_score,
        LEAST(att_score + marks_score + fee_score + trend_score, 100) AS risk_score,
        CASE
          WHEN LEAST(att_score + marks_score + fee_score + trend_score, 100) >= 76 THEN 'CRITICAL'
          WHEN LEAST(att_score + marks_score + fee_score + trend_score, 100) >= 51 THEN 'HIGH'
          WHEN LEAST(att_score + marks_score + fee_score + trend_score, 100) >= 26 THEN 'MEDIUM'
          ELSE 'LOW'
        END AS risk_level,
        NOW() AS computed_at
      FROM scored
      ORDER BY risk_score DESC;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to the original (broken) 002 definition using the old column names.
    await queryRunner.query(`
      CREATE OR REPLACE VIEW student_risk_scores AS
      WITH
      att_30 AS (
        SELECT student_usn,
               ROUND(COUNT(*) FILTER (WHERE status = 'PRESENT') * 100.0
                     / NULLIF(COUNT(*), 0), 1) AS att_pct
        FROM attendance
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY student_usn
      )
      SELECT s.usn AS student_usn, s.name, s.department, s.semester, s.section,
             COALESCE(a.att_pct, 0) AS attendance_pct,
             0 AS failing_subject_count, 'PAID' AS fee_status, 0 AS att_trend_delta,
             0 AS att_score, 0 AS marks_score, 0 AS fee_score, 0 AS trend_score,
             0 AS risk_score, 'LOW' AS risk_level, NOW() AS computed_at
      FROM students s
      LEFT JOIN att_30 a ON a.student_usn = s.usn;
    `);
  }
}
