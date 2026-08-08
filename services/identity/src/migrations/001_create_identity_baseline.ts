/**
 * Migration 001 — Identity baseline schema.
 *
 * ⚠️  THIS MIGRATION IS A STUB. IT CREATES NOTHING. ⚠️
 *
 * Every statement below is commented out, so `users`, `parents`, `students`,
 * `parent_student_links` and `roles` have no DDL anywhere in the codebase.
 * Consequences, all currently live:
 *
 *   - Migration 002 (risk-score view) fails immediately with
 *     `relation "attendance" does not exist`, so the migration chain CANNOT be
 *     run against an empty database at all.
 *   - Migration 006 ALTERs `students`; migration 011 seeds it. Both depend on a
 *     table nothing creates.
 *   - StudentEntity and ParentStudentLinkEntity are registered and injected in
 *     students.module.ts, so DatabasePreflightService reports them as having no
 *     table.
 *
 * Writing the real baseline needs decisions this file cannot make on its own —
 * notably whether `attendance` belongs in the identity database at all, given
 * that CLAUDE.md assigns it to its own service and database. Migration 002 may
 * simply not belong here.
 *
 * The class name was `CreateIdentityBaseline001` with a `name` property
 * override of the same value; TypeORM requires a 13-digit timestamp suffix and
 * rejected it, which is why the runner failed before reaching any migration.
 */
export class CreateIdentityBaseline1700000000000 {

  public async up(): Promise<void> {
    // CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    // CREATE TABLE users (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), ...);
    // CREATE TABLE parents (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), ...);
    // CREATE TABLE students (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), usn VARCHAR UNIQUE, ...);
    // CREATE TABLE parent_student_links (id UUID PRIMARY KEY, parent_id UUID, student_id UUID, UNIQUE(parent_id, student_id));
    // CREATE TABLE roles (id UUID PRIMARY KEY, name VARCHAR UNIQUE, permissions JSONB);
  }

  public async down(): Promise<void> {
    // DROP TABLE parent_student_links;
    // DROP TABLE students;
    // DROP TABLE parents;
    // DROP TABLE users;
    // DROP TABLE roles;
  }
}
