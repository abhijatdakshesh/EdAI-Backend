import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PredictionService } from './prediction.service';
import { FeatureStoreService, StudentFeatures } from '../feature-store/feature-store.service';

function features(overrides: Partial<StudentFeatures> = {}): StudentFeatures {
  return {
    studentUsn: '1RV21CS003',
    name: 'Karthik Reddy',
    department: 'CSE',
    semester: 5,
    section: 'A',
    preferredLanguage: 'en',
    attendancePct30d: 60,
    attendanceTrendDelta: -6,
    avgMarksPct: 45,
    failingSubjectCount: 2,
    feeStatus: 'PARTIAL',
    feeOutstanding: 65000,
    computedAt: '2026-07-05T00:00:00Z',
    ...overrides,
  };
}

describe('PredictionService', () => {
  let service: PredictionService;
  let store: { getStudentFeatures: jest.Mock; getCohortFeatures: jest.Mock };

  beforeEach(async () => {
    store = {
      getStudentFeatures: jest.fn(),
      getCohortFeatures: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PredictionService,
        { provide: FeatureStoreService, useValue: store },
      ],
    }).compile();
    service = moduleRef.get(PredictionService);
  });

  it('lists registered models', () => {
    expect(service.listModels()).toContain('placement-readiness');
  });

  it('rejects an unknown model', async () => {
    await expect(service.predictForStudent('does-not-exist', '1RV21CS003')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFound when the student has no snapshot', async () => {
    store.getStudentFeatures.mockResolvedValue(null);
    await expect(
      service.predictForStudent('placement-readiness', '1RV21CS999'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns an explainable prediction for a known student', async () => {
    store.getStudentFeatures.mockResolvedValue(features());
    const r = await service.predictForStudent('placement-readiness', '1RV21CS003');
    expect(r.studentUsn).toBe('1RV21CS003');
    expect(r.drivers.length).toBeGreaterThan(0);
    expect(r.breakdown).toHaveProperty('academics');
  });

  it('sorts cohort results most-in-need (lowest score) first', async () => {
    store.getCohortFeatures.mockResolvedValue([
      features({ studentUsn: 'STRONG', avgMarksPct: 88, attendancePct30d: 92, failingSubjectCount: 0, attendanceTrendDelta: 0 }),
      features({ studentUsn: 'WEAK', avgMarksPct: 40, attendancePct30d: 55, failingSubjectCount: 3, attendanceTrendDelta: -12 }),
    ]);
    const results = await service.predictForCohort('placement-readiness', {});
    expect(results[0].studentUsn).toBe('WEAK');
    expect(results[0].score).toBeLessThanOrEqual(results[1].score);
  });
});
