import { IntegrityService, jaccard, aiHeuristic } from './integrity.service';

describe('integrity math', () => {
  it('jaccard: identical text = 1, disjoint = 0', () => {
    const t = 'the quick brown fox jumps over the lazy dog';
    expect(jaccard(t, t)).toBe(1);
    expect(jaccard('alpha beta gamma delta', 'one two three four five')).toBe(0);
  });

  it('jaccard: partial overlap is between 0 and 1', () => {
    const sim = jaccard('the cat sat on the mat', 'the cat sat on the rug today');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('aiHeuristic: uniform sentences + connectives score higher than bursty human text', () => {
    const aiLike = 'This module explains the core idea here. Furthermore the next point is given here. Moreover another aspect is covered here. In conclusion the summary is provided here.';
    const human = 'Yes. I went to the market yesterday and ended up buying way too many random vegetables and snacks. No idea why.';
    expect(aiHeuristic(aiLike)).toBeGreaterThan(aiHeuristic(human));
    expect(aiHeuristic(aiLike)).toBeGreaterThan(50);
  });
});

describe('IntegrityService.checkBatch', () => {
  const svc = new IntegrityService();

  it('flags copied submissions with high plagiarism + correct match', () => {
    const text = 'binary search works by repeatedly dividing the sorted array in half until the target is found';
    const res = svc.checkBatch([
      { id: 'a', usn: 'S1', text },
      { id: 'b', usn: 'S2', text }, // exact copy
      { id: 'c', usn: 'S3', text: 'this essay discusses the history of the french revolution in europe' },
    ]);
    const a = res.find((r) => r.id === 'a')!;
    expect(a.plagiarismScore).toBe(100);
    expect(a.matchedWith).toBe('S2');
    expect(a.flagged).toBe(true);
    const c = res.find((r) => r.id === 'c')!;
    expect(c.plagiarismScore).toBeLessThan(60);
  });

  it('single submission has zero plagiarism', () => {
    const res = svc.checkBatch([{ id: 'a', usn: 'S1', text: 'a unique original answer with several words here' }]);
    expect(res[0].plagiarismScore).toBe(0);
    expect(res[0].matchedWith).toBeUndefined();
  });
});
