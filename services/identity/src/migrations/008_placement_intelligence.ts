import { MigrationInterface, QueryRunner } from 'typeorm';
import { hasTables, skip } from './_guards';

export class PlacementIntelligence1700000000008 implements MigrationInterface {
  public readonly name = 'PlacementIntelligence1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const REQUIRES = ['ia_marks', 'attendance', 'students', 'users'];
    if (!(await hasTables(queryRunner, REQUIRES))) {
      skip('PlacementIntelligence1700000000008', REQUIRES);
      return;
    }
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS placement_companies (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name              VARCHAR(255) NOT NULL,
        logo_url          TEXT,
        industry          VARCHAR(100),
        role_offered      VARCHAR(255) NOT NULL,
        ctc_lpa           NUMERIC(5,2),
        min_cgpa          NUMERIC(3,2) DEFAULT 6.0,
        eligible_branches TEXT[] DEFAULT '{}',
        eligible_semesters INTEGER[] DEFAULT '{8}',
        required_skills   TEXT[] DEFAULT '{}',
        company_type      VARCHAR(50) DEFAULT 'SERVICE',
        active            BOOLEAN DEFAULT true,
        drive_date        DATE,
        created_at        TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Uses actual DB schema: ia_marks (not internal_marks), students.id (UUID PK),
    // students.student_id (USN), attendance.status lowercase, semester is VARCHAR
    await queryRunner.query(`
      CREATE OR REPLACE VIEW placement_readiness_scores AS
      WITH
        cgpa_score AS (
          SELECT
            s.id AS student_id,
            s.student_id AS usn,
            CASE
              WHEN AVG(im.marks) / NULLIF(AVG(im.max_marks), 0) * 10 >= 9.0 THEN 35
              WHEN AVG(im.marks) / NULLIF(AVG(im.max_marks), 0) * 10 >= 8.0 THEN 28
              WHEN AVG(im.marks) / NULLIF(AVG(im.max_marks), 0) * 10 >= 7.0 THEN 20
              WHEN AVG(im.marks) / NULLIF(AVG(im.max_marks), 0) * 10 >= 6.0 THEN 12
              ELSE 5
            END AS cgpa_pts,
            ROUND(AVG(im.marks) / NULLIF(AVG(im.max_marks), 0) * 10, 2) AS cgpa_10
          FROM students s
          LEFT JOIN ia_marks im ON im.student_id = s.id
          GROUP BY s.id, s.student_id
        ),
        attendance_score AS (
          SELECT
            a.student_id,
            CASE
              WHEN ROUND(COUNT(*) FILTER (WHERE a.status = 'present') * 100.0 / NULLIF(COUNT(*), 0), 1) >= 90 THEN 25
              WHEN ROUND(COUNT(*) FILTER (WHERE a.status = 'present') * 100.0 / NULLIF(COUNT(*), 0), 1) >= 80 THEN 18
              WHEN ROUND(COUNT(*) FILTER (WHERE a.status = 'present') * 100.0 / NULLIF(COUNT(*), 0), 1) >= 75 THEN 10
              ELSE 3
            END AS att_pts,
            ROUND(COUNT(*) FILTER (WHERE a.status = 'present') * 100.0 / NULLIF(COUNT(*), 0), 1) AS att_pct
          FROM attendance a
          GROUP BY a.student_id
        ),
        backlog_score AS (
          SELECT
            im.student_id,
            COUNT(DISTINCT im.subject_id) FILTER (WHERE im.marks < (im.max_marks * 0.4)) AS backlog_count
          FROM ia_marks im
          GROUP BY im.student_id
        ),
        trend_score AS (
          SELECT
            im.student_id,
            CASE
              WHEN AVG(CASE WHEN im.ia_number = 3 THEN im.marks / NULLIF(im.max_marks, 0) END)
                 > AVG(CASE WHEN im.ia_number = 1 THEN im.marks / NULLIF(im.max_marks, 0) END) THEN 10
              WHEN AVG(CASE WHEN im.ia_number = 3 THEN im.marks / NULLIF(im.max_marks, 0) END)
                 < AVG(CASE WHEN im.ia_number = 1 THEN im.marks / NULLIF(im.max_marks, 0) END) - 0.1 THEN -5
              ELSE 5
            END AS trend_pts
          FROM ia_marks im
          GROUP BY im.student_id
        )
      SELECT
        s.student_id AS usn,
        (u.first_name || ' ' || u.last_name) AS name,
        s.department,
        REGEXP_REPLACE(COALESCE(s.semester, '0'), '[^0-9]', '', 'g')::INTEGER AS semester,
        s.section,
        COALESCE(cs.cgpa_10, 0) AS cgpa,
        COALESCE(att.att_pct, 0) AS attendance_pct,
        COALESCE(bl.backlog_count, 0) AS backlogs,
        GREATEST(0, LEAST(100,
          COALESCE(cs.cgpa_pts, 5)
          + COALESCE(att.att_pts, 3)
          + GREATEST(0, 20 - COALESCE(bl.backlog_count, 0) * 8)
          + COALESCE(tr.trend_pts, 5)
          + CASE WHEN REGEXP_REPLACE(COALESCE(s.semester, '0'), '[^0-9]', '', 'g')::INTEGER >= 7 THEN 10 ELSE 0 END
        )) AS readiness_score,
        CASE
          WHEN GREATEST(0, LEAST(100,
            COALESCE(cs.cgpa_pts, 5) + COALESCE(att.att_pts, 3)
            + GREATEST(0, 20 - COALESCE(bl.backlog_count, 0) * 8)
            + COALESCE(tr.trend_pts, 5)
            + CASE WHEN REGEXP_REPLACE(COALESCE(s.semester, '0'), '[^0-9]', '', 'g')::INTEGER >= 7 THEN 10 ELSE 0 END
          )) >= 75 THEN 'PLACEMENT_READY'
          WHEN GREATEST(0, LEAST(100,
            COALESCE(cs.cgpa_pts, 5) + COALESCE(att.att_pts, 3)
            + GREATEST(0, 20 - COALESCE(bl.backlog_count, 0) * 8)
            + COALESCE(tr.trend_pts, 5)
            + CASE WHEN REGEXP_REPLACE(COALESCE(s.semester, '0'), '[^0-9]', '', 'g')::INTEGER >= 7 THEN 10 ELSE 0 END
          )) >= 50 THEN 'NEEDS_COACHING'
          ELSE 'HIGH_RISK'
        END AS placement_status
      FROM students s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN cgpa_score cs ON cs.student_id = s.id
      LEFT JOIN attendance_score att ON att.student_id = s.id
      LEFT JOIN backlog_score bl ON bl.student_id = s.id
      LEFT JOIN trend_score tr ON tr.student_id = s.id;
    `);

    // FK references students(student_id) — the USN column (UNIQUE NOT NULL)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS placement_matches (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn     VARCHAR(20) NOT NULL REFERENCES students(student_id),
        company_id      UUID NOT NULL REFERENCES placement_companies(id),
        fit_score       INTEGER NOT NULL,
        prediction_pct  INTEGER,
        claude_rationale TEXT,
        status          VARCHAR(50) DEFAULT 'ELIGIBLE',
        created_at      TIMESTAMPTZ DEFAULT now(),
        UNIQUE(student_usn, company_id)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS placement_resumes (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn     VARCHAR(20) NOT NULL REFERENCES students(student_id),
        company_type    VARCHAR(50) NOT NULL,
        resume_text     TEXT NOT NULL,
        pdf_path        TEXT,
        version         INTEGER DEFAULT 1,
        created_at      TIMESTAMPTZ DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS placement_offers (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn     VARCHAR(20) NOT NULL REFERENCES students(student_id),
        company_id      UUID NOT NULL REFERENCES placement_companies(id),
        ctc_lpa         NUMERIC(5,2),
        role            VARCHAR(255),
        offer_date      DATE DEFAULT CURRENT_DATE,
        joining_date    DATE,
        status          VARCHAR(50) DEFAULT 'ACCEPTED',
        created_at      TIMESTAMPTZ DEFAULT now()
      );
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_matches_student ON placement_matches(student_usn, fit_score DESC);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_matches_company ON placement_matches(company_id, fit_score DESC);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_offers_student ON placement_offers(student_usn);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_offers_company ON placement_offers(company_id);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offers_company;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offers_student;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_matches_company;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_matches_student;`);
    await queryRunner.query(`DROP TABLE IF EXISTS placement_offers;`);
    await queryRunner.query(`DROP TABLE IF EXISTS placement_resumes;`);
    await queryRunner.query(`DROP TABLE IF EXISTS placement_matches;`);
    await queryRunner.query(`DROP VIEW IF EXISTS placement_readiness_scores;`);
    await queryRunner.query(`DROP TABLE IF EXISTS placement_companies;`);
  }
}
