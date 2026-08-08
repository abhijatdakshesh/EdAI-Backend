import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentsTable1700000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE SEQUENCE IF NOT EXISTS document_number_seq START 1000 INCREMENT 1;

      CREATE TABLE IF NOT EXISTS document_requests (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        doc_number        TEXT UNIQUE DEFAULT 'DOC-' || nextval('document_number_seq'),
        student_usn       TEXT NOT NULL,
        student_name      TEXT NOT NULL,
        doc_type          TEXT NOT NULL CHECK (doc_type IN ('BONAFIDE','ATTENDANCE_CERT','FEE_RECEIPT','COURSE_COMPLETION')),
        purpose           TEXT NOT NULL,
        purpose_detail    TEXT,
        status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','REVOKED')),
        ai_body           TEXT,
        signed_token      TEXT,
        requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at       TIMESTAMPTZ,
        reviewed_by       TEXT,
        rejection_reason  TEXT,
        expires_at        TIMESTAMPTZ,
        consent_given     BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE INDEX IF NOT EXISTS idx_doc_requests_usn    ON document_requests(student_usn);
      CREATE INDEX IF NOT EXISTS idx_doc_requests_status ON document_requests(status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS document_requests;
      DROP SEQUENCE IF EXISTS document_number_seq;
    `);
  }
}
