import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the ten tables whose entities were registered but which no migration
 * had ever created.
 *
 * These entities are injected via TypeOrmModule.forFeature() in fees-api,
 * promotion, vtu, comms and jobs, so with DATABASE_URL set their services took
 * the repository branch and every query failed at the driver with
 * `relation "..." does not exist`. Without DATABASE_URL they silently used an
 * in-memory fallback and lost data on cold start. Neither state was visible
 * until DatabasePreflightService started reporting it at boot.
 *
 * Column names here are the snake_case forms produced by SnakeNamingStrategy
 * (src/database/snake-naming.strategy.ts), which the application DataSource
 * applies. Property `studentUsn` becomes `student_usn`, and so on — the DDL
 * must match that mapping exactly or the tables will exist but every column
 * reference will miss.
 *
 * Nullability and defaults mirror the entity decorators rather than what looks
 * tidy: TypeORM will happily INSERT NULL into a column the entity treats as
 * optional, and a NOT NULL added here would surface as a runtime write failure.
 *
 * Idempotent (IF NOT EXISTS throughout) so it is safe to re-run against a
 * database where some tables were hand-created.
 */
export class MissingCoreTables1700000000023 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Fees (FeeItemEntity) ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fee_items (
        id             VARCHAR PRIMARY KEY,
        usn            VARCHAR NOT NULL,
        component      VARCHAR NOT NULL,
        amount         DECIMAL(10,2) NOT NULL,
        status         VARCHAR NOT NULL DEFAULT 'PENDING',
        due_date       VARCHAR,
        paid_date      VARCHAR,
        semester       INTEGER NOT NULL DEFAULT 1,
        institution_id VARCHAR NOT NULL DEFAULT 'default',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_fee_items_usn ON fee_items (usn);
      CREATE INDEX IF NOT EXISTS idx_fee_items_tenant_status
        ON fee_items (institution_id, status);
    `);

    // ── Promotion (PromotionBatchEntity, PromotionAuditEntity) ───────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS promotion_batches (
        id            VARCHAR PRIMARY KEY,
        class_name    VARCHAR NOT NULL,
        from_semester INTEGER NOT NULL,
        to_semester   INTEGER NOT NULL,
        academic_year VARCHAR NOT NULL,
        dept          VARCHAR NOT NULL,
        status        VARCHAR NOT NULL DEFAULT 'PENDING',
        promoted_at   VARCHAR,
        stats         JSONB,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_promotion_batches_year_dept
        ON promotion_batches (academic_year, dept);
    `);

    // "timestamp" is quoted throughout: it is a type name in Postgres and an
    // unquoted reference in a later ALTER or view would be ambiguous.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS promotion_audit_log (
        id          VARCHAR PRIMARY KEY,
        batch_id    VARCHAR NOT NULL,
        action      VARCHAR NOT NULL,
        actor_id    VARCHAR NOT NULL,
        actor_role  VARCHAR NOT NULL,
        reason      VARCHAR,
        overrides   JSONB,
        "timestamp" VARCHAR NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_promotion_audit_batch
        ON promotion_audit_log (batch_id);
    `);

    // ── VTU (VtuWindowEntity, VtuEligibilityEntity, VtuRegistrationEntity) ───
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS vtu_windows (
        id            VARCHAR PRIMARY KEY,
        title         VARCHAR NOT NULL,
        open_date     VARCHAR NOT NULL,
        close_date    VARCHAR NOT NULL,
        semester      INTEGER NOT NULL,
        is_active     BOOLEAN NOT NULL DEFAULT FALSE,
        subject_codes TEXT[] NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_vtu_windows_active ON vtu_windows (is_active);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS vtu_eligibilities (
        id                VARCHAR PRIMARY KEY,
        window_id         VARCHAR NOT NULL,
        usn               VARCHAR NOT NULL,
        eligible_subjects TEXT[] NOT NULL DEFAULT '{}',
        is_eligible       BOOLEAN NOT NULL DEFAULT FALSE,
        category          VARCHAR NOT NULL DEFAULT 'REGULAR'
      );
      CREATE INDEX IF NOT EXISTS idx_vtu_eligibilities_window_usn
        ON vtu_eligibilities (window_id, usn);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS vtu_registrations (
        id            VARCHAR PRIMARY KEY,
        window_id     VARCHAR NOT NULL,
        usn           VARCHAR NOT NULL,
        subject_codes TEXT[] NOT NULL DEFAULT '{}',
        registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_vtu_registrations_window_usn
        ON vtu_registrations (window_id, usn);
    `);

    // ── Comms (AiCallLogEntity, ConsentRecordEntity, AnnouncementEntity) ─────
    // transcript/summary are declared as plain @Column() (varchar). Postgres
    // varchar without a length is unbounded, so full call transcripts fit.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_call_logs (
        id                VARCHAR PRIMARY KEY,
        student_usn       VARCHAR NOT NULL,
        student_name      VARCHAR NOT NULL,
        parent_id         VARCHAR NOT NULL,
        outcome           VARCHAR NOT NULL,
        duration          INTEGER,
        institution_id    VARCHAR,
        class_id          VARCHAR,
        parent_phone      VARCHAR,
        transcript        VARCHAR,
        summary           VARCHAR,
        transfer_status   VARCHAR,
        transfer_reason   VARCHAR,
        transferred_at    TIMESTAMPTZ,
        transfer_duration INTEGER,
        called_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_call_logs_student ON ai_call_logs (student_usn);
      CREATE INDEX IF NOT EXISTS idx_ai_call_logs_called_at ON ai_call_logs (called_at DESC);
    `);

    // DPDP Act 2023: consent is the legal basis for every WhatsApp/SMS/voice
    // contact, so this table is the audit record. One active row per
    // (principal, institution) is enforced by a partial unique index rather
    // than a plain constraint, since revoked rows must be retained as evidence.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS consent_records (
        id             VARCHAR PRIMARY KEY,
        principal_id   VARCHAR NOT NULL,
        institution_id VARCHAR NOT NULL,
        channels       TEXT[] NOT NULL,
        active         BOOLEAN NOT NULL DEFAULT TRUE,
        revoked_at     VARCHAR,
        granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_consent_principal
        ON consent_records (principal_id, institution_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_one_active
        ON consent_records (principal_id, institution_id) WHERE active;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id             VARCHAR PRIMARY KEY,
        title          VARCHAR NOT NULL,
        content        TEXT NOT NULL,
        audience       VARCHAR NOT NULL,
        institution_id VARCHAR,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_announcements_tenant_created
        ON announcements (institution_id, created_at DESC);
    `);

    // ── Placement (AlumniOutcomeEntity) ──────────────────────────────────────
    // PrimaryColumn is usn — one outcome row per alumnus, no surrogate key.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS alumni_outcomes (
        usn             VARCHAR PRIMARY KEY,
        name            VARCHAR NOT NULL,
        graduation_year INTEGER NOT NULL,
        company         VARCHAR NOT NULL,
        role            VARCHAR NOT NULL,
        package_lpa     DECIMAL(6,2) NOT NULL,
        dept            VARCHAR NOT NULL,
        location        VARCHAR NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alumni_dept_year
        ON alumni_outcomes (dept, graduation_year);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [
      'alumni_outcomes',
      'announcements',
      'consent_records',
      'ai_call_logs',
      'vtu_registrations',
      'vtu_eligibilities',
      'vtu_windows',
      'promotion_audit_log',
      'promotion_batches',
      'fee_items',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t}`);
    }
  }
}
