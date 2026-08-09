import { MigrationInterface, QueryRunner } from 'typeorm';

export class RecruiterPortal1700000000009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS recruiter_jobs (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recruiter_id    TEXT NOT NULL,
        institution_id  TEXT NOT NULL,
        title           TEXT NOT NULL,
        description     TEXT NOT NULL,
        role_type       TEXT NOT NULL CHECK (role_type IN ('PRODUCT','SERVICE','STARTUP','CORE')),
        ctc_lpa         NUMERIC(5,2) NOT NULL,
        min_cgpa        NUMERIC(3,1) NOT NULL DEFAULT 6.0,
        eligible_branches TEXT[] NOT NULL DEFAULT '{}',
        eligible_semesters INT[] NOT NULL DEFAULT '{}',
        required_skills TEXT[] NOT NULL DEFAULT '{}',
        location        TEXT NOT NULL DEFAULT 'Bengaluru',
        apply_deadline  DATE,
        status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','CANCELLED')),
        posted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_recruiter_jobs_recruiter ON recruiter_jobs(recruiter_id);
      CREATE INDEX IF NOT EXISTS idx_recruiter_jobs_institution ON recruiter_jobs(institution_id, status);

      CREATE TABLE IF NOT EXISTS job_applications (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id          UUID NOT NULL REFERENCES recruiter_jobs(id) ON DELETE CASCADE,
        student_usn     TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'APPLIED'
                          CHECK (status IN ('APPLIED','SHORTLISTED','INTERVIEW','OFFERED','REJECTED','WITHDRAWN')),
        applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(job_id, student_usn)
      );

      CREATE INDEX IF NOT EXISTS idx_job_applications_job ON job_applications(job_id, status);
      CREATE INDEX IF NOT EXISTS idx_job_applications_student ON job_applications(student_usn);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS job_applications;
      DROP TABLE IF EXISTS recruiter_jobs;
    `);
  }
}
