import { MigrationInterface, QueryRunner } from 'typeorm';
import { hasTables, skip } from './_guards';

export class AddFeeReminders1700000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The guard covers ONLY the fee_risk_scores view further down, which reads
    // fee_payments. fee_reminders itself is owned by this service and must be
    // created either way — an earlier version of this guard sat at the top of
    // the method and skipped the whole migration, so the table silently never
    // existed on a database without the finance read-model.

    // Tracks every reminder sent — prevents double-sending and gives NAAC audit trail
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fee_reminders (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn     VARCHAR NOT NULL,
        fee_payment_id  UUID NOT NULL,
        reminder_type   VARCHAR NOT NULL,
        -- WHATSAPP_10D | CALL_5D | CALL_1D | SMS_2D | OVERDUE_CALL | MANUAL_CALL
        channel         VARCHAR NOT NULL CHECK (channel IN ('WHATSAPP','VOICE','SMS')),
        status          VARCHAR NOT NULL DEFAULT 'SENT'
                          CHECK (status IN ('SENT','DELIVERED','FAILED','ANSWERED','NO_ANSWER')),
        sent_at         TIMESTAMP NOT NULL DEFAULT NOW(),
        responded_at    TIMESTAMP,
        notes           TEXT,
        CONSTRAINT fk_fr_student FOREIGN KEY (student_usn) REFERENCES students(usn)
      );

      CREATE INDEX IF NOT EXISTS idx_fee_reminders_student  ON fee_reminders(student_usn);
      CREATE INDEX IF NOT EXISTS idx_fee_reminders_fee      ON fee_reminders(fee_payment_id);
      CREATE INDEX IF NOT EXISTS idx_fee_reminders_sent     ON fee_reminders(sent_at);

      -- Unique constraint prevents double-sending the same reminder type for the same fee
      CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_reminder_dedup
        ON fee_reminders(fee_payment_id, reminder_type)
        WHERE status != 'FAILED';
    `);

    // View: fee risk scores — runs live, no caching needed at this scale.
    // Reads fee_payments, which belongs to the finance service, so it is skipped
    // where that read-model is absent. The table above is unaffected.
    const VIEW_REQUIRES = ['fee_payments', 'students'];
    if (!(await hasTables(queryRunner, VIEW_REQUIRES))) {
      skip('AddFeeReminders1700000000004 (fee_risk_scores view only)', VIEW_REQUIRES);
      return;
    }

    await queryRunner.query(`
      CREATE OR REPLACE VIEW fee_risk_scores AS
      WITH
      pay_history AS (
        SELECT
          student_usn,
          COUNT(*) AS total_fees,
          COUNT(*) FILTER (
            WHERE paid_date IS NOT NULL AND paid_date > due_date
            OR (paid_date IS NULL AND due_date < CURRENT_DATE)
          ) AS late_count
        FROM fee_payments
        WHERE due_date < CURRENT_DATE
        GROUP BY student_usn
      ),
      att AS (
        SELECT
          student_usn,
          ROUND(
            COUNT(*) FILTER (WHERE status = 'PRESENT') * 100.0
            / NULLIF(COUNT(*), 0), 1
          ) AS att_pct
        FROM attendance
        WHERE date >= CURRENT_DATE - INTERVAL '60 days'
        GROUP BY student_usn
      ),
      outstanding AS (
        SELECT
          fp.id             AS fee_payment_id,
          fp.student_usn,
          fp.fee_type,
          fp.amount_due,
          fp.amount_paid,
          fp.due_date,
          fp.status         AS fee_status,
          fp.semester,
          (fp.amount_due - COALESCE(fp.amount_paid, 0)) AS balance,
          (fp.due_date - CURRENT_DATE)                   AS days_to_due
        FROM fee_payments fp
        WHERE fp.status IN ('PENDING', 'PARTIAL', 'OVERDUE')
          AND fp.amount_due > COALESCE(fp.amount_paid, 0)
      )
      SELECT
        o.fee_payment_id,
        o.student_usn,
        s.name                      AS student_name,
        s.department,
        s.semester,
        s.parent_phone,
        s.parent_preferred_language AS language,
        o.fee_type,
        o.amount_due,
        o.amount_paid,
        o.balance,
        o.due_date,
        o.days_to_due,
        o.fee_status,
        CASE
          WHEN COALESCE(ph.total_fees, 0) = 0 THEN 15
          WHEN ph.late_count * 100 / NULLIF(ph.total_fees, 0) >= 75 THEN 40
          WHEN ph.late_count * 100 / NULLIF(ph.total_fees, 0) >= 50 THEN 28
          WHEN ph.late_count * 100 / NULLIF(ph.total_fees, 0) >= 25 THEN 15
          ELSE 0
        END AS history_score,
        CASE
          WHEN COALESCE(a.att_pct, 75) < 60 THEN 25
          WHEN COALESCE(a.att_pct, 75) < 75 THEN 15
          WHEN COALESCE(a.att_pct, 75) < 85 THEN 5
          ELSE 0
        END AS attendance_score,
        CASE
          WHEN (o.amount_due - COALESCE(o.amount_paid, 0)) >= 50000 THEN 15
          WHEN (o.amount_due - COALESCE(o.amount_paid, 0)) >= 25000 THEN 10
          WHEN (o.amount_due - COALESCE(o.amount_paid, 0)) >= 10000 THEN 5
          ELSE 0
        END AS amount_score,
        CASE
          WHEN o.days_to_due < 0  THEN 20
          WHEN o.days_to_due <= 1 THEN 15
          WHEN o.days_to_due <= 5 THEN 10
          WHEN o.days_to_due <= 10 THEN 5
          ELSE 0
        END AS urgency_score,
        LEAST(
          CASE WHEN COALESCE(ph.total_fees,0)=0 THEN 15 WHEN ph.late_count*100/NULLIF(ph.total_fees,0)>=75 THEN 40 WHEN ph.late_count*100/NULLIF(ph.total_fees,0)>=50 THEN 28 WHEN ph.late_count*100/NULLIF(ph.total_fees,0)>=25 THEN 15 ELSE 0 END
          + CASE WHEN COALESCE(a.att_pct,75)<60 THEN 25 WHEN COALESCE(a.att_pct,75)<75 THEN 15 WHEN COALESCE(a.att_pct,75)<85 THEN 5 ELSE 0 END
          + CASE WHEN (o.amount_due-COALESCE(o.amount_paid,0))>=50000 THEN 15 WHEN (o.amount_due-COALESCE(o.amount_paid,0))>=25000 THEN 10 WHEN (o.amount_due-COALESCE(o.amount_paid,0))>=10000 THEN 5 ELSE 0 END
          + CASE WHEN o.days_to_due<0 THEN 20 WHEN o.days_to_due<=1 THEN 15 WHEN o.days_to_due<=5 THEN 10 WHEN o.days_to_due<=10 THEN 5 ELSE 0 END,
          100
        ) AS risk_score,
        CASE
          WHEN LEAST(
            CASE WHEN COALESCE(ph.total_fees,0)=0 THEN 15 WHEN ph.late_count*100/NULLIF(ph.total_fees,0)>=75 THEN 40 WHEN ph.late_count*100/NULLIF(ph.total_fees,0)>=50 THEN 28 WHEN ph.late_count*100/NULLIF(ph.total_fees,0)>=25 THEN 15 ELSE 0 END
            + CASE WHEN COALESCE(a.att_pct,75)<60 THEN 25 WHEN COALESCE(a.att_pct,75)<75 THEN 15 WHEN COALESCE(a.att_pct,75)<85 THEN 5 ELSE 0 END
            + CASE WHEN (o.amount_due-COALESCE(o.amount_paid,0))>=50000 THEN 15 WHEN (o.amount_due-COALESCE(o.amount_paid,0))>=25000 THEN 10 WHEN (o.amount_due-COALESCE(o.amount_paid,0))>=10000 THEN 5 ELSE 0 END
            + CASE WHEN o.days_to_due<0 THEN 20 WHEN o.days_to_due<=1 THEN 15 WHEN o.days_to_due<=5 THEN 10 WHEN o.days_to_due<=10 THEN 5 ELSE 0 END,
            100) >= 61 THEN 'HIGH'
          WHEN LEAST(
            CASE WHEN COALESCE(ph.total_fees,0)=0 THEN 15 WHEN ph.late_count*100/NULLIF(ph.total_fees,0)>=75 THEN 40 WHEN ph.late_count*100/NULLIF(ph.total_fees,0)>=50 THEN 28 WHEN ph.late_count*100/NULLIF(ph.total_fees,0)>=25 THEN 15 ELSE 0 END
            + CASE WHEN COALESCE(a.att_pct,75)<60 THEN 25 WHEN COALESCE(a.att_pct,75)<75 THEN 15 WHEN COALESCE(a.att_pct,75)<85 THEN 5 ELSE 0 END
            + CASE WHEN (o.amount_due-COALESCE(o.amount_paid,0))>=50000 THEN 15 WHEN (o.amount_due-COALESCE(o.amount_paid,0))>=25000 THEN 10 WHEN (o.amount_due-COALESCE(o.amount_paid,0))>=10000 THEN 5 ELSE 0 END
            + CASE WHEN o.days_to_due<0 THEN 20 WHEN o.days_to_due<=1 THEN 15 WHEN o.days_to_due<=5 THEN 10 WHEN o.days_to_due<=10 THEN 5 ELSE 0 END,
            100) >= 31 THEN 'MEDIUM'
          ELSE 'LOW'
        END AS risk_level,
        COALESCE(ph.late_count, 0) AS historical_late_count,
        COALESCE(ph.total_fees, 0) AS historical_total_fees,
        COALESCE(a.att_pct, 0)     AS attendance_pct,
        NOW()                       AS computed_at
      FROM outstanding o
      JOIN students s ON s.usn = o.student_usn
      LEFT JOIN pay_history ph ON ph.student_usn = o.student_usn
      LEFT JOIN att a ON a.student_usn = o.student_usn
      ORDER BY risk_score DESC;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS fee_risk_scores;`);
    await queryRunner.query(`DROP TABLE IF EXISTS fee_reminders;`);
  }
}
