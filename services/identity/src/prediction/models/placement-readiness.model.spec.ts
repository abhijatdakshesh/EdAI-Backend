import { PlacementReadinessModel } from './placement-readiness.model';
import { StudentFeatures } from '../../feature-store/feature-store.service';

const NOW = '2026-07-05T00:00:00Z';

function makeFeatures(overrides: Partial<StudentFeatures> = {}): StudentFeatures {
  return {
    studentUsn: '1RV21CS001',
    name: 'Arjun Sharma',
    department: 'CSE',
    semester: 5,
    section: 'A',
    preferredLanguage: 'en',
    attendancePct30d: 90,
    attendanceTrendDelta: 0,
    avgMarksPct: 85,
    failingSubjectCount: 0,
    feeStatus: 'PAID',
    feeOutstanding: 0,
    computedAt: NOW,
    ...overrides,
  };
}

describe('PlacementReadinessModel', () => {
  const model = new PlacementReadinessModel();

  it('scores a strong student LOW-risk (high readiness)', () => {
    const r = model.predict(makeFeatures(), NOW);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.band).toBe('LOW');
    expect(r.model).toBe('placement-readiness');
  });

  it('scores a weak student as needing intervention (HIGH/CRITICAL)', () => {
    const r = model.predict(
      makeFeatures({ avgMarksPct: 42, attendancePct30d: 58, failingSubjectCount: 2 }),
      NOW,
    );
    expect(r.score).toBeLessThan(55);
    expect(['HIGH', 'CRITICAL']).toContain(r.band);
  });

  it('applies a backlog penalty and surfaces it as a driver', () => {
    const clean = model.predict(makeFeatures({ failingSubjectCount: 0 }), NOW);
    const withBacklog = model.predict(makeFeatures({ failingSubjectCount: 2 }), NOW);
    expect(withBacklog.score).toBeLessThan(clean.score);
    expect(withBacklog.drivers.some((d) => d.factor === 'backlogs' && d.impact < 0)).toBe(true);
  });

  it('ranks drivers by absolute impact', () => {
    const r = model.predict(makeFeatures(), NOW);
    const impacts = r.drivers.map((d) => Math.abs(d.impact));
    expect(impacts).toEqual([...impacts].sort((a, b) => b - a));
  });

  it('clamps score to 0–100', () => {
    const r = model.predict(
      makeFeatures({ avgMarksPct: 100, attendancePct30d: 100, attendanceTrendDelta: 20 }),
      NOW,
    );
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('lowers confidence when signals are missing', () => {
    const full = model.predict(makeFeatures(), NOW);
    const sparse = model.predict(
      makeFeatures({ avgMarksPct: 0, attendancePct30d: 0, attendanceTrendDelta: 0 }),
      NOW,
    );
    expect(sparse.confidence).toBeLessThan(full.confidence);
  });
});
