import { Injectable, BadRequestException, InternalServerErrorException, Optional, Inject } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { geminiGenerate, GEMINI_SMART } from '../shared/gemini-ai';

const SCHEMA_CONTEXT = `
You are a PostgreSQL expert for EdAI, an Indian college ERP (RVCE, Bangalore).
Generate ONLY a single, read-only SELECT statement. No markdown, no explanation, no semicolon.

Every column below is snake_case and was verified against the live database.
Never invent a table or column, and never quote a column name — this schema has
no camelCase identifiers.

  students(id UUID, user_id UUID, student_id VARCHAR, usn VARCHAR, sap_id VARCHAR,
           name VARCHAR, email VARCHAR, dob DATE, section_id VARCHAR,
           semester VARCHAR, section VARCHAR, department VARCHAR,
           cgpa NUMERIC, skills TEXT[], status VARCHAR,
           preferred_language VARCHAR, photo_url TEXT, biometric_ref VARCHAR,
           institution_id VARCHAR, home_state VARCHAR, parent_phone VARCHAR,
           parent_name VARCHAR, consent_voice BOOLEAN,
           parent_preferred_language VARCHAR, created_at TIMESTAMPTZ)
           -- usn is the canonical student key (e.g. '1RV21CS001'); student_id mirrors it.
           -- semester is VARCHAR, not INT: cast before comparing numerically.
           -- status values: active, inactive

  parent_student_links(id UUID, parent_id UUID, student_id UUID,
                       is_primary BOOLEAN, linked_at TIMESTAMPTZ)
                       -- student_id here is students.id (a UUID), NOT the USN.

  fee_items(id VARCHAR, usn VARCHAR, component VARCHAR, amount NUMERIC, status VARCHAR,
            due_date VARCHAR, paid_date VARCHAR, semester INT, institution_id VARCHAR,
            created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
            -- status values: PENDING, PAID, WAIVED

  promotion_batches(id VARCHAR, class_name VARCHAR, from_semester INT, to_semester INT,
                    academic_year VARCHAR, dept VARCHAR, status VARCHAR,
                    promoted_at VARCHAR, stats JSONB, created_at TIMESTAMPTZ)

  vtu_windows(id VARCHAR, title VARCHAR, open_date VARCHAR, close_date VARCHAR,
              semester INT, is_active BOOLEAN, subject_codes TEXT[])

  vtu_eligibilities(id VARCHAR, window_id VARCHAR, usn VARCHAR,
                    eligible_subjects TEXT[], is_eligible BOOLEAN, category VARCHAR)

  vtu_registrations(id VARCHAR, window_id VARCHAR, usn VARCHAR,
                    subject_codes TEXT[], registered_at TIMESTAMPTZ)

  ai_call_logs(id VARCHAR, student_usn VARCHAR, student_name VARCHAR, parent_id VARCHAR,
               outcome VARCHAR, duration INT, institution_id VARCHAR, class_id VARCHAR,
               parent_phone VARCHAR, transcript TEXT, summary TEXT,
               transfer_status VARCHAR, transfer_reason VARCHAR,
               transferred_at TIMESTAMPTZ, transfer_duration INT, called_at TIMESTAMPTZ)
               -- outcome values: ANSWERED, NO_ANSWER, BUSY, FAILED

  consent_records(id VARCHAR, principal_id VARCHAR, institution_id VARCHAR,
                  channels TEXT[], active BOOLEAN, revoked_at VARCHAR,
                  granted_at TIMESTAMPTZ)
                  -- DPDP consent. channels e.g. {WHATSAPP,SMS,VOICE}.

  announcements(id VARCHAR, title VARCHAR, content TEXT, audience VARCHAR,
                institution_id VARCHAR, created_at TIMESTAMPTZ)
                -- audience values: STUDENT, PARENT, FACULTY, ALL

  recruiter_jobs(id UUID, recruiter_id TEXT, institution_id TEXT, title TEXT,
                 description TEXT, role_type TEXT, ctc_lpa NUMERIC, min_cgpa NUMERIC,
                 eligible_branches TEXT[], eligible_semesters TEXT[],
                 required_skills TEXT[], location TEXT, apply_deadline DATE,
                 status TEXT, posted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)

  placement_drives(id UUID, job_id UUID, recruiter_id TEXT, drive_tier VARCHAR,
                   status VARCHAR, drive_date DATE, max_active_backlogs INT,
                   max_historical_backlogs INT, lateral_entry_allowed BOOLEAN,
                   estimated_hires INT, estimated_cost_per_hire INT,
                   created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
                   -- recruiter drive scheduling; joins recruiter_jobs on job_id.

NOT AVAILABLE in this database — the identity service does not own them, and any
query touching them will fail. Answer questions needing these with the
"not possible" response below:
  attendance, internal_marks, ia_marks, fee_payments, student_risk_scores,
  faculty, recruiter_applications
Attendance, marks and payment records live in the attendance, academics and
finance services respectively.

Rules:
  1. Return ONLY a valid PostgreSQL SELECT — nothing else.
  2. Never use INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE.
  3. Use ILIKE for case-insensitive string matching.
  4. All identifiers are snake_case and unquoted. Never quote a column name.
  5. For "this month" use called_at >= date_trunc('month', now()); for "today" use CURRENT_DATE.
  6. Column aliases must be human-readable and quoted (e.g., "Student Name").
  7. Always add LIMIT 100 unless the question asks for a count or aggregate.
  8. If the question needs a table listed as NOT AVAILABLE, or cannot be answered
     from this schema, return exactly:
     SELECT 'Query not possible with available data' AS message

EXAMPLES (few-shot learning — match this style):

Q: How many students in CSE department semester 5?
SQL: SELECT COUNT(*) AS "Student Count" FROM students WHERE department ILIKE '%cse%' AND semester = '5'

Q: List students with unpaid fees
SQL: SELECT s.name AS "Student Name", s.usn AS "USN", fi.component AS "Component", fi.amount AS "Amount", fi.due_date AS "Due Date" FROM students s JOIN fee_items fi ON fi.usn = s.usn WHERE fi.status = 'PENDING' ORDER BY fi.due_date ASC LIMIT 100

Q: How many AI calls were made this month and what was the outcome?
SQL: SELECT outcome AS "Outcome", COUNT(*) AS "Call Count" FROM ai_call_logs WHERE called_at >= date_trunc('month', now()) GROUP BY outcome ORDER BY "Call Count" DESC

Q: List students eligible for VTU exam registration
SQL: SELECT s.name AS "Student Name", ve.usn AS "USN", ve.category AS "Category", array_to_string(ve.eligible_subjects, ', ') AS "Eligible Subjects" FROM vtu_eligibilities ve JOIN students s ON s.usn = ve.usn WHERE ve.is_eligible = true LIMIT 100

Q: Show students with attendance below 75%
SQL: SELECT 'Query not possible with available data' AS message
`;

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;
const MAX_ROWS = 500;

@Injectable()
export class NlQueryService {
  static readonly SUGGESTIONS: string[] = [
    'Show students with unpaid fees',
    'List students eligible for VTU exam registration this semester',
    'How many AI calls were made this month and what was the outcome?',
    'Show students promoted to semester 6 in CSE department',
    'List all consent records where voice calling was not granted',
    'Which announcements were sent to students this month?',
    'Show students with parent preferred language as Kannada',
    'List fee items due this month that are not yet paid',
  ];

  constructor(
    @Optional() @Inject(getDataSourceToken()) private readonly dataSource: DataSource | null,
  ) {}

  async query(naturalLanguage: string): Promise<{
    sql: string;
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
  }> {
    if (!naturalLanguage?.trim()) throw new BadRequestException('Query cannot be empty');
    if (naturalLanguage.length > 500) throw new BadRequestException('Query too long — keep it under 500 characters');

    const question = naturalLanguage.trim();
    let sql = await this.generateSql(question);
    this.assertSafe(sql);

    // First execute attempt — on Postgres syntax/column error, give Gemini one
    // chance to self-correct using the actual error message. Many NL queries
    // fail on first try because of misnamed columns ("usn" vs "student_id");
    // a single re-prompt turns a 500 into a working answer (KAN-50/33).
    try {
      const rows = await this.execute(sql);
      return {
        sql,
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rows,
        rowCount: rows.length,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Retry only for SQL-level errors (column/table/syntax). Don't retry on
      // permission, connection, or our own assertSafe failures.
      const retriable = /column|relation|syntax|does not exist|undefined/i.test(errorMessage);
      if (!retriable) throw err;

      try {
        sql = await this.generateSqlWithFeedback(question, sql, errorMessage);
        this.assertSafe(sql);
        const rows = await this.execute(sql);
        return {
          sql,
          columns: rows.length > 0 ? Object.keys(rows[0]) : [],
          rows,
          rowCount: rows.length,
        };
      } catch {
        // Re-throw the original error — surface the first attempt's failure
        // so the user sees the most helpful diagnostic.
        throw err;
      }
    }
  }

  private async generateSql(question: string): Promise<string> {
    try {
      const combined = `${SCHEMA_CONTEXT}\n\nQuestion: ${question}`;
      const raw = await geminiGenerate(combined, GEMINI_SMART);
      const text = raw;
      if (!text?.trim()) throw new InternalServerErrorException('No SQL generated');
      return text.trim().replace(/^```(?:sql)?\n?/i, '').replace(/\n?```$/i, '').trim();
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException(`AI generation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async generateSqlWithFeedback(question: string, prevSql: string, prevError: string): Promise<string> {
    const combined = `${SCHEMA_CONTEXT}

Question: ${question}

Your previous SQL attempt failed with PostgreSQL error:
  ${prevError}

Previous SQL:
  ${prevSql}

Generate a corrected SQL query. Pay attention to exact column names from the schema above.
Return ONLY the SQL — no markdown, no explanation.`;
    const raw = await geminiGenerate(combined, GEMINI_SMART);
    if (!raw?.trim()) throw new InternalServerErrorException('No corrected SQL generated');
    return raw.trim().replace(/^```(?:sql)?\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  private assertSafe(sql: string): void {
    const noStrings = sql.replace(/'[^']*'/g, "''");
    if (FORBIDDEN.test(noStrings)) throw new BadRequestException('Query contains disallowed statement type');
    const withoutTrailing = sql.trimEnd().replace(/;$/, '');
    if (withoutTrailing.includes(';')) throw new BadRequestException('Multi-statement queries are not allowed');
    if (!sql.trimStart().toLowerCase().startsWith('select')) throw new BadRequestException('Only SELECT queries are allowed');
  }

  private async execute(sql: string): Promise<Record<string, unknown>[]> {
    if (!this.dataSource) {
      throw new InternalServerErrorException(
        'Database not configured — set DATABASE_URL in the identity service environment',
      );
    }
    const hasLimit = /\bLIMIT\b/i.test(sql);
    const safeSql = hasLimit ? sql : `${sql.trimEnd().replace(/;$/, '')} LIMIT ${MAX_ROWS}`;
    try {
      return (await this.dataSource.query(safeSql)) as Record<string, unknown>[];
    } catch (err: unknown) {
      throw new BadRequestException(`SQL error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
