import { ObeService } from './obe.service';
import { IaService } from '../ia/ia.service';
import { ObeAttainmentService } from './obe-attainment.service';

const COLLEGE = 'rvce';
const COURSE = 'CS501';
const SEM = 5;

function addIa(ia: IaService, usn: string, ia1: number, ia2 = 0, ia3 = 0): void {
  ia.entries.push({ usn, name: usn, ia1, ia2, ia3, subjectCode: COURSE, sem: SEM });
}

describe('ObeAttainmentService', () => {
  let obe: ObeService;
  let ia: IaService;
  let attain: ObeAttainmentService;

  beforeEach(() => {
    obe = new ObeService();
    ia = new IaService();
    attain = new ObeAttainmentService(obe, ia);
  });

  it('direct CO attainment: % students ≥ threshold maps to level (defaults 40/55/70)', () => {
    const co = obe.upsertCo(COLLEGE, COURSE, { code: 'CO1', statement: 'x', targetThreshold: 60, targetAttainmentLevel: 2 });
    obe.setAssessmentMap(COLLEGE, COURSE, 'IA1', co.id); // whole IA1 (max 50) → CO1
    // 7 of 10 students ≥ 30/50 (=60%)
    [45, 40, 38, 35, 32, 31, 30, 20, 15, 10].forEach((m, i) => addIa(ia, `S${i}`, m));

    const [r] = attain.computeCoAttainment(COLLEGE, COURSE, SEM);
    expect(r.studentsConsidered).toBe(10);
    expect(r.attainmentPct).toBe(70);
    expect(r.directLevel).toBe(3);      // 70 ≥ level3Pct(70)
    expect(r.finalLevel).toBe(3);       // no survey → indirect=direct
    expect(r.gap).toBe(1);              // 3 - target(2)
  });

  it('boundary: a student exactly at threshold counts as attained', () => {
    const co = obe.upsertCo(COLLEGE, COURSE, { code: 'CO1', statement: 'x', targetThreshold: 60 });
    obe.setAssessmentMap(COLLEGE, COURSE, 'IA1', co.id);
    addIa(ia, 'A', 30); // exactly 60%
    addIa(ia, 'B', 29); // just below
    const [r] = attain.computeCoAttainment(COLLEGE, COURSE, SEM);
    expect(r.attainmentPct).toBe(50); // 1 of 2
  });

  it('question-level weighting aggregates marks/maxMarks across questions', () => {
    const co = obe.upsertCo(COLLEGE, COURSE, { code: 'CO1', statement: 'x', targetThreshold: 60 });
    obe.setAssessmentMap(COLLEGE, COURSE, 'IA1', co.id, 1, 10);
    obe.setAssessmentMap(COLLEGE, COURSE, 'IA1', co.id, 3, 10);
    addIa(ia, 'A', 0); addIa(ia, 'B', 0); // roster only
    obe.saveQuestionMarks(COLLEGE, COURSE, 'IA1', [
      { usn: 'A', questionNo: 1, marks: 8, maxMarks: 10 },
      { usn: 'A', questionNo: 3, marks: 7, maxMarks: 10 }, // 15/20 = 75% → attained
      { usn: 'B', questionNo: 1, marks: 4, maxMarks: 10 },
      { usn: 'B', questionNo: 3, marks: 3, maxMarks: 10 }, // 7/20 = 35% → not
    ]);
    const [r] = attain.computeCoAttainment(COLLEGE, COURSE, SEM);
    expect(r.attainmentPct).toBe(50);
  });

  it('blend uses direct/indirect weights with exit survey', () => {
    const co = obe.upsertCo(COLLEGE, COURSE, { code: 'CO1', statement: 'x', targetThreshold: 60, targetAttainmentLevel: 2 });
    obe.setAssessmentMap(COLLEGE, COURSE, 'IA1', co.id);
    // 50% attained → directLevel 1 (≥40, <55)
    addIa(ia, 'A', 40); addIa(ia, 'B', 10);
    obe.upsertExitSurvey(COLLEGE, COURSE, co.id, 3, 20); // indirect level 3
    const [r] = attain.computeCoAttainment(COLLEGE, COURSE, SEM);
    expect(r.directLevel).toBe(1);
    expect(r.indirectLevel).toBe(3);
    expect(r.finalLevel).toBe(Number(((80 * 1 + 20 * 3) / 100).toFixed(2))); // 1.4
  });

  it('zero students is safe (no divide-by-zero)', () => {
    const co = obe.upsertCo(COLLEGE, COURSE, { code: 'CO1', statement: 'x' });
    obe.setAssessmentMap(COLLEGE, COURSE, 'IA1', co.id);
    const [r] = attain.computeCoAttainment(COLLEGE, COURSE, SEM);
    expect(r.attainmentPct).toBe(0);
    expect(r.directLevel).toBe(0);
  });

  it('PO roll-up = correlation-weighted mean of contributing CO final levels', () => {
    const program = obe.upsertProgram(COLLEGE, { code: 'CSE', name: 'CSE' });
    const po1 = obe.upsertOutcome(COLLEGE, { programId: program.id, kind: 'PO', seq: 1, code: 'PO1', statement: 'x', target: 2 });
    const co1 = obe.upsertCo(COLLEGE, COURSE, { code: 'CO1', statement: 'x', targetThreshold: 60 });
    const co2 = obe.upsertCo(COLLEGE, COURSE, { code: 'CO2', statement: 'y', targetThreshold: 60 });
    obe.setAssessmentMap(COLLEGE, COURSE, 'IA1', co1.id);
    obe.setAssessmentMap(COLLEGE, COURSE, 'IA2', co2.id);
    // CO1 → all attained (level 3); CO2 → ~50% (level 1)
    addIa(ia, 'A', 45, 40); addIa(ia, 'B', 40, 10); addIa(ia, 'C', 35, 45); addIa(ia, 'D', 33, 12);
    // Actually compute finals dynamically, then check PO formula consistency.
    obe.setMatrixCell(COLLEGE, co1.id, po1.id, 3);
    obe.setMatrixCell(COLLEGE, co2.id, po1.id, 2);

    const cos = attain.computeCoAttainment(COLLEGE, COURSE, SEM);
    const f1 = cos.find((c) => c.coId === co1.id)!.finalLevel;
    const f2 = cos.find((c) => c.coId === co2.id)!.finalLevel;
    const expected = Number(((3 * f1 + 2 * f2) / (3 + 2)).toFixed(2));

    const pos = attain.computePoAttainment(COLLEGE, program.id, [COURSE], SEM);
    const po = pos.find((p) => p.outcomeId === po1.id)!;
    expect(po.attainment).toBe(expected);
    expect(po.gap).toBe(Number((expected - 2).toFixed(2)));
  });

  it('seedStandardPos creates the 12 NBA POs idempotently', () => {
    const program = obe.upsertProgram(COLLEGE, { code: 'CSE', name: 'CSE' });
    obe.seedStandardPos(COLLEGE, program.id);
    obe.seedStandardPos(COLLEGE, program.id); // idempotent
    const pos = obe.listOutcomes(COLLEGE, program.id).filter((o) => o.kind === 'PO');
    expect(pos).toHaveLength(12);
    expect(pos[0].code).toBe('PO1');
  });
});
