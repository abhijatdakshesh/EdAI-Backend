import { Module } from '@nestjs/common';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy';
import { DatabasePreflightService } from './database-preflight.service';
import { ALL_ENTITIES } from '../entities/registry';

/**
 * Conditionally connects to PostgreSQL when DATABASE_URL is set.
 * Falls back to no-op (in-memory services continue working) when DATABASE_URL is absent.
 * This allows tests to run without a running database.
 *
 * The entity list lives in `../entities/registry` and is shared with every
 * feature module's forFeature() call and with migrations/run.ts. Do not inline
 * an entity list here — see that file for why the three lists must not drift.
 */
@Module({
  imports: process.env['DATABASE_URL']
    ? [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: process.env['DATABASE_URL'],
          entities: ALL_ENTITIES,
          synchronize: false,
          namingStrategy: new SnakeNamingStrategy(),
          ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
          logging: false,
          extra: {
            max: parseInt(process.env['DB_POOL_MAX'] ?? '20', 10),
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
          },
        }),
        TypeOrmModule.forFeature(ALL_ENTITIES),
      ]
    : [],
  // When no DATABASE_URL, register a null DataSource so modules importing DatabaseModule
  // can inject DataSource (receiving null) without NestJS throwing a DI resolution error.
  providers: process.env['DATABASE_URL']
    ? [DatabasePreflightService]
    : [{ provide: getDataSourceToken(), useValue: null }, DatabasePreflightService],
  exports: process.env['DATABASE_URL']
    ? [TypeOrmModule]
    : [getDataSourceToken()],
})
export class DatabaseModule {}
