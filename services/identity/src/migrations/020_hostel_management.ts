import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hostel Management — persistent tables (replaces the in-memory seeded
 * hostel data in student-portal). Covers allocation/rooms, complaints, leave,
 * mess, and visitor/gate logging. Keyed on students.usn.
 */
export class AddHostelManagement1700000000020 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS hostel_blocks (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         VARCHAR(80) NOT NULL,
        type         VARCHAR(10) NOT NULL DEFAULT 'BOYS',   -- BOYS | GIRLS
        warden_name  VARCHAR(150),
        warden_phone VARCHAR(20),
        total_rooms  INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ DEFAULT now(),
        UNIQUE(name)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS hostel_rooms (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        block_id    UUID NOT NULL REFERENCES hostel_blocks(id) ON DELETE CASCADE,
        room_number VARCHAR(20) NOT NULL,
        floor       INTEGER NOT NULL DEFAULT 0,
        capacity    INTEGER NOT NULL DEFAULT 2,
        occupied    INTEGER NOT NULL DEFAULT 0,
        UNIQUE(block_id, room_number)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS hostel_allocations (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn  VARCHAR(50) NOT NULL UNIQUE,
        room_id      UUID NOT NULL REFERENCES hostel_rooms(id),
        bed_no       INTEGER NOT NULL DEFAULT 1,
        mess_type    VARCHAR(20) NOT NULL DEFAULT 'VEG',   -- VEG | NONVEG
        status       VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        allocated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS hostel_complaints (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn VARCHAR(50) NOT NULL,
        category    VARCHAR(40) NOT NULL DEFAULT 'GENERAL', -- ELECTRICAL | PLUMBING | CLEANLINESS | MESS | GENERAL
        description TEXT NOT NULL,
        status      VARCHAR(20) NOT NULL DEFAULT 'OPEN',    -- OPEN | IN_PROGRESS | RESOLVED
        resolved_by VARCHAR(100),
        created_at  TIMESTAMPTZ DEFAULT now(),
        resolved_at TIMESTAMPTZ
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_hostel_complaints_open
        ON hostel_complaints (status, created_at DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS hostel_leave_requests (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn VARCHAR(50) NOT NULL,
        from_date   DATE NOT NULL,
        to_date     DATE NOT NULL,
        reason      TEXT NOT NULL,
        status      VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
        approved_by VARCHAR(100),
        created_at  TIMESTAMPTZ DEFAULT now(),
        CHECK (to_date >= from_date)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mess_menu (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        block_id  UUID REFERENCES hostel_blocks(id) ON DELETE CASCADE,
        day       VARCHAR(10) NOT NULL,   -- Monday..Sunday
        breakfast VARCHAR(200),
        lunch     VARCHAR(200),
        dinner    VARCHAR(200),
        UNIQUE(block_id, day)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS hostel_visitors (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn  VARCHAR(50) NOT NULL,
        visitor_name VARCHAR(150) NOT NULL,
        relation     VARCHAR(50),
        purpose      VARCHAR(200),
        in_time      TIMESTAMPTZ NOT NULL DEFAULT now(),
        out_time     TIMESTAMPTZ
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_hostel_visitors_student
        ON hostel_visitors (student_usn, in_time DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [
      'hostel_visitors', 'mess_menu', 'hostel_leave_requests',
      'hostel_complaints', 'hostel_allocations', 'hostel_rooms', 'hostel_blocks',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
