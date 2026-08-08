import { QueryRunner } from 'typeorm';

/**
 * Helpers shared by migrations. Named with a leading underscore so it does NOT
 * match the `0[0-9][0-9]_*.ts` glob in run.ts and is never loaded as a migration.
 */

/**
 * True when every named table exists in the current schema.
 *
 * Used to guard migrations that read tables the identity service does not own.
 * `attendance`, `internal_marks` and `fee_payments` belong to the attendance,
 * academics and finance services respectively (see CLAUDE.md — one database per
 * service). Identity only ever had them because `seed_chatbot_data.sql` creates
 * a local read-model copy for the chatbot demo; that file is not a migration and
 * is not applied by run.ts.
 *
 * Migrations 002, 004, 015 and 016 build views over those tables. Rather than
 * delete four working features, or have the identity baseline claim ownership of
 * another service's schema, those migrations now skip when the source tables are
 * absent. Where a deployment does have the read-model copy, they behave exactly
 * as before.
 */
export async function hasTables(qr: QueryRunner, tables: string[]): Promise<boolean> {
  const rows = await qr.query(
    `SELECT count(*)::int AS c
       FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ANY($1)`,
    [tables],
  );
  return rows[0].c === tables.length;
}

/** Logs a uniform skip message so a half-applied chain is obvious in CI output. */
export function skip(migration: string, tables: string[]): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[${migration}] skipped — requires ${tables.join(', ')}, which the identity ` +
      `service does not own. Not an error: these tables belong to the attendance/` +
      `academics/finance services.`,
  );
}
