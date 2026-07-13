import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OBE Phase 1 — programs, PO/PSO outcomes, course outcomes, CO-PO map,
 * assessment→CO map, question marks, exit surveys, attainment config.
 * Seeds the 12 standard NBA POs for a default program when empty.
 */
export class ObeTables1700000000014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS obe_programs (
        id VARCHAR PRIMARY KEY, college_id VARCHAR NOT NULL,
        code VARCHAR NOT NULL, name VARCHAR NOT NULL,
        department VARCHAR, version VARCHAR,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_obe_programs_college ON obe_programs(college_id);

      CREATE TABLE IF NOT EXISTS obe_outcomes (
        id VARCHAR PRIMARY KEY, college_id VARCHAR NOT NULL, "programId" VARCHAR NOT NULL,
        kind VARCHAR NOT NULL, seq INT NOT NULL, code VARCHAR NOT NULL,
        statement TEXT NOT NULL, target FLOAT NOT NULL DEFAULT 2.0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_obe_outcomes_college ON obe_outcomes(college_id);
      CREATE INDEX IF NOT EXISTS idx_obe_outcomes_program ON obe_outcomes(college_id, "programId");

      CREATE TABLE IF NOT EXISTS obe_course_outcomes (
        id VARCHAR PRIMARY KEY, college_id VARCHAR NOT NULL, "courseId" VARCHAR NOT NULL,
        seq INT NOT NULL, code VARCHAR NOT NULL, statement TEXT NOT NULL,
        "bloomLevel" VARCHAR, "targetThreshold" FLOAT NOT NULL DEFAULT 60,
        "targetAttainmentLevel" FLOAT NOT NULL DEFAULT 2.0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_obe_cos_college ON obe_course_outcomes(college_id);
      CREATE INDEX IF NOT EXISTS idx_obe_cos_course ON obe_course_outcomes(college_id, "courseId");

      CREATE TABLE IF NOT EXISTS obe_co_po_map (
        id VARCHAR PRIMARY KEY, college_id VARCHAR NOT NULL,
        "coId" VARCHAR NOT NULL, "outcomeId" VARCHAR NOT NULL, correlation INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_obe_copo_college ON obe_co_po_map(college_id);
      CREATE INDEX IF NOT EXISTS idx_obe_copo_co ON obe_co_po_map(college_id, "coId");

      CREATE TABLE IF NOT EXISTS obe_assessment_co_map (
        id VARCHAR PRIMARY KEY, college_id VARCHAR NOT NULL, "courseId" VARCHAR NOT NULL,
        component VARCHAR NOT NULL, "questionNo" INT, "coId" VARCHAR NOT NULL,
        "maxMarks" FLOAT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_obe_am_college ON obe_assessment_co_map(college_id);
      CREATE INDEX IF NOT EXISTS idx_obe_am_course ON obe_assessment_co_map(college_id, "courseId");

      CREATE TABLE IF NOT EXISTS obe_question_marks (
        id VARCHAR PRIMARY KEY, college_id VARCHAR NOT NULL, "courseId" VARCHAR NOT NULL,
        usn VARCHAR NOT NULL, component VARCHAR NOT NULL, "questionNo" INT NOT NULL,
        marks FLOAT NOT NULL, "maxMarks" FLOAT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_obe_qm_college ON obe_question_marks(college_id);
      CREATE INDEX IF NOT EXISTS idx_obe_qm_course ON obe_question_marks(college_id, "courseId");

      CREATE TABLE IF NOT EXISTS obe_exit_survey (
        id VARCHAR PRIMARY KEY, college_id VARCHAR NOT NULL, "courseId" VARCHAR NOT NULL,
        "coId" VARCHAR NOT NULL, "avgRating" FLOAT NOT NULL, "responseCount" INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_obe_survey_college ON obe_exit_survey(college_id);
      CREATE INDEX IF NOT EXISTS idx_obe_survey_course ON obe_exit_survey(college_id, "courseId");

      CREATE TABLE IF NOT EXISTS obe_attainment_config (
        id VARCHAR PRIMARY KEY, college_id VARCHAR NOT NULL, "courseId" VARCHAR,
        "directWeight" FLOAT NOT NULL DEFAULT 80, "indirectWeight" FLOAT NOT NULL DEFAULT 20,
        "level1Pct" FLOAT NOT NULL DEFAULT 40, "level2Pct" FLOAT NOT NULL DEFAULT 55,
        "level3Pct" FLOAT NOT NULL DEFAULT 70,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_obe_cfg_college ON obe_attainment_config(college_id);
    `);

    // Seed a default program + 12 NBA POs when empty.
    const college = process.env['DEFAULT_COLLEGE_ID'] ?? 'rvce';
    const existing = await queryRunner.query(`SELECT COUNT(*)::int AS n FROM obe_programs WHERE college_id = $1`, [college]);
    if (!existing?.[0]?.n) {
      const progId = `prog-${college}-cse`;
      await queryRunner.query(
        `INSERT INTO obe_programs (id, college_id, code, name, department, version) VALUES ($1,$2,$3,$4,$5,$6)`,
        [progId, college, 'CSE-BE', 'B.E. Computer Science & Engineering', 'CSE', '2022'],
      );
      const POS: Array<[number, string, string]> = [
        [1, 'PO1', 'Engineering knowledge'], [2, 'PO2', 'Problem analysis'],
        [3, 'PO3', 'Design/development of solutions'], [4, 'PO4', 'Conduct investigations'],
        [5, 'PO5', 'Modern tool usage'], [6, 'PO6', 'The engineer and society'],
        [7, 'PO7', 'Environment and sustainability'], [8, 'PO8', 'Ethics'],
        [9, 'PO9', 'Individual and team work'], [10, 'PO10', 'Communication'],
        [11, 'PO11', 'Project management and finance'], [12, 'PO12', 'Life-long learning'],
      ];
      for (const [seq, code, statement] of POS) {
        await queryRunner.query(
          `INSERT INTO obe_outcomes (id, college_id, "programId", kind, seq, code, statement, target) VALUES ($1,$2,$3,'PO',$4,$5,$6,2.0)`,
          [`po-${college}-${seq}`, college, progId, seq, code, statement],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS obe_attainment_config;
      DROP TABLE IF EXISTS obe_exit_survey;
      DROP TABLE IF EXISTS obe_question_marks;
      DROP TABLE IF EXISTS obe_assessment_co_map;
      DROP TABLE IF EXISTS obe_co_po_map;
      DROP TABLE IF EXISTS obe_course_outcomes;
      DROP TABLE IF EXISTS obe_outcomes;
      DROP TABLE IF EXISTS obe_programs;
    `);
  }
}
