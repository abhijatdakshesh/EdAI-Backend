import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 001 — Identity baseline schema.
 *
 * Creates the five tables the identity service actually owns: users, parents,
 * students, parent_student_links and roles. Previously this file was a stub
 * with every statement commented out, so no deployment has ever had a schema
 * and the whole migration chain died at 002.
 *
 * SCOPE — what is deliberately NOT here
 * -------------------------------------
 * `attendance`, `internal_marks` and `fee_payments` are not created. They
 * belong to the attendance, academics and finance services, each of which owns
 * its own database (CLAUDE.md). Identity only ever saw them because
 * `seed_chatbot_data.sql` builds a local read-model copy for the chatbot demo,
 * and that file is not part of the migration chain. Migrations 002/004/015/016
 * read those tables and now skip when they are absent (see _guards.ts).
 *
 * SCHEMA DECISIONS, and the conflicts they resolve
 * ------------------------------------------------
 * The codebase contained two irreconcilable pictures of `students`:
 *
 *   - StudentEntity declares `usn` (varchar) and `semester` (integer).
 *   - Migrations 008/011 use `student_id` as the USN and treat `semester` as
 *     text — 008 does REGEXP_REPLACE(COALESCE(s.semester,'0'), ...)::INTEGER,
 *     which only type-checks if the column is textual. 008's own comment states
 *     "students.id (UUID PK), students.student_id (USN), semester is VARCHAR".
 *   - Migrations 004/015/020/021 reference `s.usn`, and 004 declares
 *     FOREIGN KEY (student_usn) REFERENCES students(usn).
 *
 * So `usn` and `student_id` each have real dependents, and neither can simply
 * be dropped. Resolution:
 *
 *   student_id  VARCHAR(20) UNIQUE NOT NULL   — canonical USN; FK target for 008
 *   usn         GENERATED ALWAYS AS (student_id) STORED, UNIQUE
 *                                            — FK target for 004, read by 015/020/021
 *
 * A generated column rather than a trigger: the two can never drift, and there
 * is no write path that could desynchronise them.
 *
 * `semester` is VARCHAR(10), matching 008 and 011 ('8'). Migration 006's
 * `ADD COLUMN IF NOT EXISTS semester INTEGER` becomes a no-op, and its
 * `UPDATE ... SET semester = 5` coerces to '5' — both remain correct.
 *
 * TWO KNOWN StudentEntity DIVERGENCES, deliberately left for a separate change:
 *   1. `usn` maps to the generated column, so TypeORM INSERTs through
 *      StudentEntity will fail; the property needs @Column({ name: 'student_id' }).
 *   2. `semester` is declared `type: 'integer'` but the column is varchar.
 * Neither is a regression — StudentsService has never had a table to talk to —
 * and fixing them touches application code, which this migration should not.
 */
export class CreateIdentityBaseline1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() is built into PostgreSQL 13+; pgcrypto is not required.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email              VARCHAR(255) NOT NULL,
        password_hash      VARCHAR(255) NOT NULL,
        name               VARCHAR(150) NOT NULL,
        role               VARCHAR(30)  NOT NULL,
        institution_id     VARCHAR(50)  NOT NULL DEFAULT 'rvce',
        preferred_language VARCHAR(10)  NOT NULL DEFAULT 'en',
        is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
        sap_id             VARCHAR(20),
        department_code    VARCHAR(20),
        created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
      -- Email is unique per tenant, not globally: two institutions may legitimately
      -- both have a 'principal@' address once this is genuinely multi-tenant.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_tenant
        ON users (LOWER(email), institution_id);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS parents (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
        name               VARCHAR(150) NOT NULL,
        phone              VARCHAR(20),
        email              VARCHAR(255),
        preferred_language VARCHAR(10) NOT NULL DEFAULT 'kn',
        institution_id     VARCHAR(50) NOT NULL DEFAULT 'rvce',
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_parents_phone ON parents (phone);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS students (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                   UUID REFERENCES users(id) ON DELETE SET NULL,
        student_id                VARCHAR(20)  NOT NULL,
        usn                       VARCHAR(20)  GENERATED ALWAYS AS (student_id) STORED,
        sap_id                    VARCHAR(20),
        name                      VARCHAR(150) NOT NULL,
        email                     VARCHAR(255),
        dob                       DATE,
        section_id                VARCHAR(20),
        semester                  VARCHAR(10)  DEFAULT '5',
        section                   VARCHAR(20),
        department                VARCHAR(100),
        cgpa                      NUMERIC(4,2),
        skills                    TEXT[],
        status                    VARCHAR(20)  NOT NULL DEFAULT 'active',
        preferred_language        VARCHAR(10)  DEFAULT 'en',
        photo_url                 TEXT,
        biometric_ref             VARCHAR(100),
        institution_id            VARCHAR(50)  NOT NULL DEFAULT 'rvce',
        home_state                VARCHAR(50),
        parent_phone              VARCHAR(20),
        parent_name               VARCHAR(150),
        consent_voice             BOOLEAN      NOT NULL DEFAULT FALSE,
        parent_preferred_language VARCHAR(5)   NOT NULL DEFAULT 'kn',
        created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
      -- Both unique indexes are load-bearing: 008 FKs reference students(student_id)
      -- and 004 references students(usn). A FK needs a unique index on its target.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_students_student_id ON students (student_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_students_usn        ON students (usn);
      CREATE INDEX IF NOT EXISTS idx_students_dept_semester ON students (department, semester);
      CREATE INDEX IF NOT EXISTS idx_students_institution     ON students (institution_id);
    `);

    // student_id here is students.id (a UUID) — NOT students.student_id (the USN).
    // The name collision is inherited from ParentStudentLinkEntity; renaming it
    // would be an application change, so it is documented rather than "fixed".
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS parent_student_links (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id  UUID NOT NULL REFERENCES parents(id)  ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        linked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_psl_parent_student
        ON parent_student_links (parent_id, student_id);
      CREATE INDEX IF NOT EXISTS idx_psl_student ON parent_student_links (student_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR(50) NOT NULL,
        permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name ON roles (name);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of ['parent_student_links', 'roles', 'students', 'parents', 'users']) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
  }
}
