import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '../entities/registry';

/**
 * Boot-time report on how much of the persistence layer is actually live.
 *
 * There are two independent ways an entity can be non-functional, and neither
 * announces itself:
 *
 *   MISSING METADATA — the entity is injected via forFeature but absent from
 *   forRoot. `DataSource.getRepository()` hands back a Repository object
 *   without validating anything, so DI succeeds and the service takes its
 *   database branch. The first query then throws EntityMetadataNotFoundError.
 *   `assertRegistered()` now prevents this at module-construction time; this
 *   check is the backstop for entities reached some other way.
 *
 *   MISSING TABLE — metadata is fine, but no migration ever created the table.
 *   Queries fail at the driver with `relation "x" does not exist`, once per
 *   request, forever.
 *
 * Both used to surface as a 500 on one endpoint, in production, long after
 * deploy. This turns them into a single startup summary.
 *
 * Set STRICT_DB=1 to make either gap fatal at boot instead of logged. Prefer
 * that in CI and staging; in production a loud ERROR plus a degraded service
 * usually beats a container that will not start.
 */
@Injectable()
export class DatabasePreflightService implements OnApplicationBootstrap {
  private readonly logger = new Logger('DatabasePreflight');

  constructor(
    @Optional() @InjectDataSource() private readonly dataSource: DataSource | null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.dataSource) {
      this.logger.warn(
        'DATABASE_URL is not set — every service is running on its in-memory fallback. ' +
          'Data will be lost on cold start, and the process CANNOT be safely scaled beyond one replica.',
      );
      return;
    }

    const ready: string[] = [];
    const missingMetadata: string[] = [];
    const missingTable: string[] = [];

    for (const entity of ALL_ENTITIES) {
      if (!this.dataSource.hasMetadata(entity)) {
        missingMetadata.push(entity.name);
        continue;
      }

      const { tableName } = this.dataSource.getMetadata(entity);
      try {
        // Cheapest possible existence probe; the row itself is irrelevant.
        await this.dataSource.query(`SELECT 1 FROM "${tableName}" LIMIT 1`);
        ready.push(tableName);
      } catch {
        missingTable.push(`${entity.name} → ${tableName}`);
      }
    }

    this.logger.log(
      `Persistence ready for ${ready.length}/${ALL_ENTITIES.length} entities.`,
    );

    if (missingMetadata.length > 0) {
      this.logger.error(
        `${missingMetadata.length} entities have NO TypeORM metadata — any query against them ` +
          `throws EntityMetadataNotFoundError: ${missingMetadata.join(', ')}. ` +
          `Add them to ALL_ENTITIES in src/entities/registry.ts.`,
      );
    }

    if (missingTable.length > 0) {
      this.logger.error(
        `${missingTable.length} entities have metadata but NO TABLE — owning services will ` +
          `fail or silently fall back to in-memory storage: ${missingTable.join(', ')}. ` +
          `A migration is missing for each. Run: DATABASE_URL=... npx ts-node src/migrations/run.ts`,
      );
    }

    const gaps = missingMetadata.length + missingTable.length;
    if (gaps > 0 && process.env['STRICT_DB'] === '1') {
      throw new Error(
        `[database-preflight] STRICT_DB=1 and ${gaps} entity/table gaps detected — refusing to start. ` +
          `See the errors above.`,
      );
    }
  }
}
