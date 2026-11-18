import { MigrationInterface, QueryRunner } from 'typeorm';

export class DriveManagement1700000000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE drive_tier AS ENUM (
        'POOL', 'DREAM', 'SUPER_DREAM', 'MASS', 'NICHE'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE drive_status AS ENUM (
        'DRAFT', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE tpo_approval_status AS ENUM (
        'PENDING', 'APPROVED', 'REJECTED', 'NEEDS_INFO'
      );
    `);

    // Campus drives — one record per planned drive campaign
    await queryRunner.query(`
      CREATE TABLE placement_drives (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id               UUID NOT NULL REFERENCES recruiter_jobs(id) ON DELETE CASCADE,
        recruiter_id         TEXT NOT NULL,
        drive_tier           drive_tier NOT NULL DEFAULT 'POOL',
        status               drive_status NOT NULL DEFAULT 'DRAFT',
        drive_date           DATE,
        max_active_backlogs  INTEGER NOT NULL DEFAULT 0,
        max_historical_backlogs INTEGER NOT NULL DEFAULT 0,
        lateral_entry_allowed BOOLEAN NOT NULL DEFAULT FALSE,
        estimated_hires      INTEGER,
        estimated_cost_per_hire INTEGER,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`CREATE INDEX idx_placement_drives_job ON placement_drives(job_id);`);
    await queryRunner.query(`CREATE INDEX idx_placement_drives_recruiter ON placement_drives(recruiter_id, status);`);

    // Which colleges are targeted per drive, with per-college slot and TPO state
    await queryRunner.query(`
      CREATE TABLE drive_college_mappings (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        drive_id             UUID NOT NULL REFERENCES placement_drives(id) ON DELETE CASCADE,
        college_id           TEXT NOT NULL,
        college_name         TEXT NOT NULL,
        tpo_user_id          TEXT,
        tpo_name             TEXT,
        tpo_email            TEXT,
        slot_date            DATE,
        slot_confirmed       BOOLEAN NOT NULL DEFAULT FALSE,
        eligible_count       INTEGER,
        registered_count     INTEGER NOT NULL DEFAULT 0,
        approval_status      tpo_approval_status NOT NULL DEFAULT 'PENDING',
        tpo_notes            TEXT,
        eligibility_flags    TEXT[],
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(drive_id, college_id)
      );
    `);

    await queryRunner.query(`CREATE INDEX idx_drive_colleges_drive ON drive_college_mappings(drive_id);`);
    await queryRunner.query(`CREATE INDEX idx_drive_colleges_college ON drive_college_mappings(college_id, approval_status);`);

    // Per-student applications to a drive (replaces single-college job_applications for multi-college drives)
    await queryRunner.query(`
      CREATE TABLE drive_applications (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        drive_id             UUID NOT NULL REFERENCES placement_drives(id) ON DELETE CASCADE,
        college_id           TEXT NOT NULL,
        student_usn          TEXT NOT NULL,
        student_name         TEXT,
        department           TEXT,
        cgpa                 NUMERIC(4,2),
        active_backlogs      INTEGER NOT NULL DEFAULT 0,
        historical_backlogs  INTEGER NOT NULL DEFAULT 0,
        placement_score      INTEGER,
        status               TEXT NOT NULL DEFAULT 'REGISTERED'
                             CHECK (status IN ('REGISTERED','APPEARED','CLEARED_TEST','GD_CLEARED',
                                               'TECH_CLEARED','HR_CLEARED','OFFERED','REJECTED','WITHDRAWN')),
        offer_ctc_lpa        NUMERIC(6,2),
        tpo_eligibility_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
        applied_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- Enforce one-offer-per-student per drive
        UNIQUE(drive_id, student_usn)
      );
    `);

    await queryRunner.query(`CREATE INDEX idx_drive_apps_drive ON drive_applications(drive_id, status);`);
    await queryRunner.query(`CREATE INDEX idx_drive_apps_student ON drive_applications(student_usn);`);
    await queryRunner.query(`CREATE INDEX idx_drive_apps_college ON drive_applications(college_id, drive_id);`);

    // DPDP Act 2023: explicit student consent for recruiter discovery
    await queryRunner.query(`
      CREATE TABLE student_recruiter_consent (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn            TEXT NOT NULL,
        college_id             TEXT NOT NULL,
        consented_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        consent_scope          TEXT NOT NULL DEFAULT 'ALL_RECRUITERS'
                               CHECK (consent_scope IN ('ALL_RECRUITERS','COLLEGE_APPROVED_ONLY','NONE')),
        opted_out_at           TIMESTAMPTZ,
        opt_out_reason         TEXT,
        last_updated           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(student_usn, college_id)
      );
    `);

    await queryRunner.query(`CREATE INDEX idx_consent_college ON student_recruiter_consent(college_id, consent_scope);`);

    // Pre-joining engagement tracking
    await queryRunner.query(`
      CREATE TABLE pre_joining_engagements (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn            TEXT NOT NULL,
        drive_id               UUID REFERENCES placement_drives(id),
        offer_ctc_lpa          NUMERIC(6,2),
        joining_date           DATE,
        joining_probability    INTEGER CHECK (joining_probability BETWEEN 0 AND 100),
        risk_level             TEXT NOT NULL DEFAULT 'LOW'
                               CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
        risk_reasons           TEXT[],
        buddy_assigned         BOOLEAN NOT NULL DEFAULT FALSE,
        skill_bridge_enrolled  BOOLEAN NOT NULL DEFAULT FALSE,
        documents_complete     BOOLEAN NOT NULL DEFAULT FALSE,
        parent_comm_sent       BOOLEAN NOT NULL DEFAULT FALSE,
        last_engaged_at        TIMESTAMPTZ,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(student_usn, drive_id)
      );
    `);

    await queryRunner.query(`CREATE INDEX idx_pre_joining_risk ON pre_joining_engagements(risk_level, joining_probability);`);

    // Outreach message audit trail (DPDP requires logging who was contacted when)
    await queryRunner.query(`
      CREATE TABLE outreach_audit_log (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recruiter_id         TEXT NOT NULL,
        student_usn          TEXT NOT NULL,
        college_id           TEXT NOT NULL,
        channel              TEXT NOT NULL CHECK (channel IN ('WHATSAPP','EMAIL','LINKEDIN','SMS')),
        consent_verified     BOOLEAN NOT NULL,
        consent_timestamp    TIMESTAMPTZ,
        message_preview_hash TEXT,
        sent_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`CREATE INDEX idx_outreach_student ON outreach_audit_log(student_usn, sent_at);`);
    await queryRunner.query(`CREATE INDEX idx_outreach_recruiter ON outreach_audit_log(recruiter_id, sent_at);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS outreach_audit_log;`);
    await queryRunner.query(`DROP TABLE IF EXISTS pre_joining_engagements;`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_recruiter_consent;`);
    await queryRunner.query(`DROP TABLE IF EXISTS drive_applications;`);
    await queryRunner.query(`DROP TABLE IF EXISTS drive_college_mappings;`);
    await queryRunner.query(`DROP TABLE IF EXISTS placement_drives;`);
    await queryRunner.query(`DROP TYPE IF EXISTS tpo_approval_status;`);
    await queryRunner.query(`DROP TYPE IF EXISTS drive_status;`);
    await queryRunner.query(`DROP TYPE IF EXISTS drive_tier;`);
  }
}
