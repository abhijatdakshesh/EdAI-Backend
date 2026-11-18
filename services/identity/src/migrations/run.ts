/**
 * Run TypeORM migrations manually.
 * Usage: DATABASE_URL=postgresql://... npx ts-node src/migrations/run.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '../entities/registry';

// Entities come from the shared registry so this runner cannot drift from the
// application's own list — see src/entities/registry.ts.
const ds = new DataSource({
  type: 'postgres',
  url: process.env['DATABASE_URL'],
  entities: ALL_ENTITIES,
  synchronize: false,
  migrations: [__dirname + '/0[0-9][0-9]_*.ts'],
});

ds.initialize()
  .then(() => ds.runMigrations({ transaction: 'all' }))
  .then(() => { console.log('Migrations complete'); process.exit(0); })
  .catch((e) => { console.error('Migration failed:', e); process.exit(1); });
