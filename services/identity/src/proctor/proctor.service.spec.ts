import { ProctorService } from './proctor.service';

const ASSESSMENT = 'as-cs501-1';

describe('ProctorService', () => {
  let svc: ProctorService;
  beforeEach(() => { svc = new ProctorService(); });

  it('serves student questions without the answer key', () => {
    const a = svc.getForStudent(ASSESSMENT);
    expect(a.questions.length).toBeGreaterThan(0);
    expect(a.questions[0]).not.toHaveProperty('correctIndex');
  });

  it('auto-grades a submission (all correct = 100)', () => {
    const at = svc.startAttempt(ASSESSMENT, 'S1');
    const res = svc.submit(at.id, { q1: 2, q2: 1, q3: 1 });
    expect(res.score).toBe(100);
    expect(res.integrityScore).toBe(100);
    expect(res.flagged).toBe(false);
  });

  it('partial score rounds correctly', () => {
    const at = svc.startAttempt(ASSESSMENT, 'S1');
    const res = svc.submit(at.id, { q1: 2, q2: 0, q3: 0 }); // 1/3 correct
    expect(res.score).toBe(33);
  });

  it('integrity score drops with flags and trips the threshold', () => {
    const at = svc.startAttempt(ASSESSMENT, 'S1');
    svc.flag(at.id, 'TAB_SWITCH');     // -10
    svc.flag(at.id, 'TAB_SWITCH');     // -10
    svc.flag(at.id, 'COPY_PASTE');     // -15
    const res = svc.submit(at.id, { q1: 2, q2: 1, q3: 1 });
    expect(res.integrityScore).toBe(65); // 100 - 35
    expect(res.flagged).toBe(true);      // < 70
  });

  it('flags after submission are ignored', () => {
    const at = svc.startAttempt(ASSESSMENT, 'S1');
    svc.submit(at.id, { q1: 2, q2: 1, q3: 1 });
    svc.flag(at.id, 'TAB_SWITCH');
    expect(svc.getAttempt(at.id).flags).toHaveLength(0);
  });
});
