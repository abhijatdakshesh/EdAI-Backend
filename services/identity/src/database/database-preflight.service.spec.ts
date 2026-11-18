import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DatabasePreflightService } from './database-preflight.service';
import { ALL_ENTITIES } from '../entities/registry';

/**
 * Builds a DataSource stub whose behaviour is driven by two opt-out sets:
 * entities named in `noMetadata` report no metadata, and tables named in
 * `noTable` reject the existence probe.
 */
function fakeDataSource(opts: { noMetadata?: string[]; noTable?: string[] } = {}) {
  const noMetadata = new Set(opts.noMetadata ?? []);
  const noTable = new Set(opts.noTable ?? []);
  return {
    hasMetadata: (e: Function) => !noMetadata.has(e.name),
    getMetadata: (e: Function) => ({ tableName: `tbl_${e.name}` }),
    query: jest.fn(async (sql: string) => {
      const hit = [...noTable].find((n) => sql.includes(`tbl_${n}`));
      if (hit) throw new Error(`relation "tbl_${hit}" does not exist`);
      return [];
    }),
  } as unknown as DataSource;
}

describe('DatabasePreflightService', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    delete process.env['STRICT_DB'];
  });

  afterEach(() => jest.restoreAllMocks());

  it('warns loudly when there is no DataSource at all', async () => {
    await new DatabasePreflightService(null).onApplicationBootstrap();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('in-memory fallback'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CANNOT be safely scaled'));
    expect(error).not.toHaveBeenCalled();
  });

  it('reports every entity ready when metadata and tables both resolve', async () => {
    await new DatabasePreflightService(fakeDataSource()).onApplicationBootstrap();
    expect(log).toHaveBeenCalledWith(
      `Persistence ready for ${ALL_ENTITIES.length}/${ALL_ENTITIES.length} entities.`,
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('reports entities that have no TypeORM metadata', async () => {
    const ds = fakeDataSource({ noMetadata: ['ObeProgramEntity'] });
    await new DatabasePreflightService(ds).onApplicationBootstrap();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('EntityMetadataNotFoundError'),
    );
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ObeProgramEntity'));
  });

  it('reports entities whose table is missing', async () => {
    const ds = fakeDataSource({ noTable: ['FeeItemEntity'] });
    await new DatabasePreflightService(ds).onApplicationBootstrap();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('NO TABLE'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FeeItemEntity'));
  });

  it('does not throw on gaps by default — a degraded service beats a dead one', async () => {
    const ds = fakeDataSource({ noTable: ['FeeItemEntity'] });
    await expect(
      new DatabasePreflightService(ds).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });

  it('refuses to start under STRICT_DB=1 when any gap exists', async () => {
    process.env['STRICT_DB'] = '1';
    const ds = fakeDataSource({ noMetadata: ['ObeProgramEntity'], noTable: ['FeeItemEntity'] });
    await expect(new DatabasePreflightService(ds).onApplicationBootstrap()).rejects.toThrow(
      /STRICT_DB=1 and 2 entity\/table gaps/,
    );
  });

  it('starts cleanly under STRICT_DB=1 when there are no gaps', async () => {
    process.env['STRICT_DB'] = '1';
    await expect(
      new DatabasePreflightService(fakeDataSource()).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });
});
