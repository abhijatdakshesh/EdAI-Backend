import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { FeatureStoreService } from './feature-store.service';

function snapshotRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    studentUsn: '1RV21CS003',
    name: 'Karthik Reddy',
    department: 'CSE',
    semester: '5',
    section: 'A',
    preferredLanguage: 'kn',
    attendancePct30d: '60',
    attendanceTrendDelta: '-6',
    avgMarksPct: '45',
    failingSubjectCount: '2',
    feeStatus: 'PARTIAL',
    feeOutstanding: '65000',
    computedAt: '2026-07-05T00:00:00Z',
    ...overrides,
  };
}

describe('FeatureStoreService', () => {
  describe('with no database (DataSource = null)', () => {
    let service: FeatureStoreService;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          FeatureStoreService,
          { provide: getDataSourceToken(), useValue: null },
        ],
      }).compile();
      service = moduleRef.get(FeatureStoreService);
    });

    it('returns null for a single student', async () => {
      await expect(service.getStudentFeatures('1RV21CS003')).resolves.toBeNull();
    });

    it('returns [] for a cohort', async () => {
      await expect(service.getCohortFeatures()).resolves.toEqual([]);
    });
  });

  describe('with a database', () => {
    let service: FeatureStoreService;
    let db: { query: jest.Mock };

    beforeEach(async () => {
      db = { query: jest.fn() };
      const moduleRef = await Test.createTestingModule({
        providers: [
          FeatureStoreService,
          { provide: getDataSourceToken(), useValue: db },
        ],
      }).compile();
      service = moduleRef.get(FeatureStoreService);
    });

    it('maps and coerces a single snapshot row', async () => {
      db.query.mockResolvedValue([snapshotRow()]);
      const f = await service.getStudentFeatures('1RV21CS003');
      expect(f).not.toBeNull();
      expect(f!.semester).toBe(5);
      expect(f!.avgMarksPct).toBe(45);
      expect(f!.failingSubjectCount).toBe(2);
      expect(f!.preferredLanguage).toBe('kn');
    });

    it('returns null when the student is absent', async () => {
      db.query.mockResolvedValue([]);
      await expect(service.getStudentFeatures('nope')).resolves.toBeNull();
    });

    it('passes department + semester filters as bound params', async () => {
      db.query.mockResolvedValue([snapshotRow()]);
      await service.getCohortFeatures({ department: 'CSE', semester: 5, limit: 10 });
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('department = $1');
      expect(sql).toContain('semester = $2');
      expect(params).toEqual(['CSE', 5, 10]);
    });
  });
});
