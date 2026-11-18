import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfills tables that migrations 004 and 008 should have created but didn't.
 *
 * Both migrations mix service-owned tables with views over attendance / ia_marks
 * / fee_payments, which belong to other services. The guard added to skip those
 * views was placed at the top of `up()` and returned early, so on a database
 * without the foreign read-model the whole migration was skipped — taking
 * fee_reminders and the four placement_* tables with it.
 *
 * 004 and 008 have since been corrected to guard only their view, which fixes
 * new databases. It does nothing for existing ones: both are already recorded in
 * the migrations table, so TypeORM will never run them again. Hence this.
 *
 * Every statement is IF NOT EXISTS, so on a database where the corrected 004/008
 * already created these, this is a no-op. DDL is duplicated from those
 * migrations rather than shared, because a migration must keep describing the
 * schema as it was at the time it ran.
 */
export class BackfillGuardedTables1700000000025 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── from 004: fee reminder audit trail ───────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fee_reminders (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn     VARCHAR NOT NULL,
        fee_payment_id  UUID NOT NULL,
        reminder_type   VARCHAR NOT NULL,
        channel         VARCHAR NOT NULL CHECK (channel IN ('WHATSAPP','VOICE','SMS')),
        status          VARCHAR NOT NULL DEFAULT 'SENT'
                          CHECK (status IN ('SENT','DELIVERED','FAILED','ANSWERED','NO_ANSWER')),
        sent_at         TIMESTAMP NOT NULL DEFAULT NOW(),
        responded_at    TIMESTAMP,
        notes           TEXT,
        CONSTRAINT fk_fr_student FOREIGN KEY (student_usn) REFERENCES students(usn)
      );

      CREATE INDEX IF NOT EXISTS idx_fee_reminders_student ON fee_reminders(student_usn);
      CREATE INDEX IF NOT EXISTS idx_fee_reminders_fee     ON fee_reminders(fee_payment_id);
      CREATE INDEX IF NOT EXISTS idx_fee_reminders_sent    ON fee_reminders(sent_at);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_reminder_dedup
        ON fee_reminders(fee_payment_id, reminder_type)
        WHERE status != 'FAILED';
    `);

    // ── from 008: placement intelligence ─────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS placement_companies (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name               VARCHAR(255) NOT NULL,
        logo_url           TEXT,
        industry           VARCHAR(100),
        role_offered       VARCHAR(255) NOT NULL,
        ctc_lpa            NUMERIC(5,2),
        min_cgpa           NUMERIC(3,2) DEFAULT 6.0,
        eligible_branches  TEXT[] DEFAULT '{}',
        eligible_semesters INTEGER[] DEFAULT '{8}',
        required_skills    TEXT[] DEFAULT '{}',
        company_type       VARCHAR(50) DEFAULT 'SERVICE',
        active             BOOLEAN DEFAULT true,
        drive_date         DATE,
        created_at         TIMESTAMPTZ DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS placement_matches (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn      VARCHAR(20) NOT NULL REFERENCES students(student_id),
        company_id       UUID NOT NULL REFERENCES placement_companies(id),
        fit_score        INTEGER NOT NULL,
        prediction_pct   INTEGER,
        claude_rationale TEXT,
        status           VARCHAR(50) DEFAULT 'ELIGIBLE',
        created_at       TIMESTAMPTZ DEFAULT now(),
        UNIQUE(student_usn, company_id)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS placement_resumes (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn  VARCHAR(20) NOT NULL REFERENCES students(student_id),
        company_type VARCHAR(50) NOT NULL,
        resume_text  TEXT NOT NULL,
        pdf_path     TEXT,
        version      INTEGER DEFAULT 1,
        created_at   TIMESTAMPTZ DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS placement_offers (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn  VARCHAR(20) NOT NULL REFERENCES students(student_id),
        company_id   UUID NOT NULL REFERENCES placement_companies(id),
        ctc_lpa      NUMERIC(5,2),
        role         VARCHAR(255),
        offer_date   DATE DEFAULT CURRENT_DATE,
        joining_date DATE,
        status       VARCHAR(50) DEFAULT 'ACCEPTED',
        created_at   TIMESTAMPTZ DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_matches_student ON placement_matches(student_usn, fit_score DESC);
      CREATE INDEX IF NOT EXISTS idx_matches_company ON placement_matches(company_id, fit_score DESC);
      CREATE INDEX IF NOT EXISTS idx_offers_student  ON placement_offers(student_usn);
      CREATE INDEX IF NOT EXISTS idx_offers_company  ON placement_offers(company_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dependency order: matches/offers reference placement_companies.
    for (const t of [
      'placement_offers',
      'placement_matches',
      'placement_resumes',
      'placement_companies',
      'fee_reminders',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t}`);
    }
  }
}
