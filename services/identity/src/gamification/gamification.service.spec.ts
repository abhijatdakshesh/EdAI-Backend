import { GamificationService } from './gamification.service';

// LmsExtensionsService.getStreak/getLearningHours are async now that they read
// through to Postgres, so the stub resolves rather than returns.
function ext(streak: number, learningHours: number) {
  return {
    getStreak: jest.fn().mockResolvedValue({ currentStreak: streak, longestStreak: streak }),
    getLearningHours: jest.fn().mockResolvedValue(learningHours),
  };
}

describe('GamificationService', () => {
  it('awards badges by streak/hours and computes points', async () => {
    const svc = new GamificationService(ext(7, 20) as never);
    const p = await svc.getProfile('rvce', '1RV21CS001', 'CS501');
    const earned = p.badges.filter((b) => b.earned).map((b) => b.code);
    expect(earned).toEqual(expect.arrayContaining(['FIRST_STEP', 'STREAK_3', 'STREAK_7', 'HOURS_5', 'HOURS_20']));
    expect(p.earnedCount).toBe(5);
    // points = 7*10 + 20*5 + 5*25 = 70 + 100 + 125 = 295
    expect(p.points).toBe(295);
  });

  it('low activity earns only the entry badge', async () => {
    const svc = new GamificationService(ext(1, 1) as never);
    const p = await svc.getProfile('rvce', 'x', 'CS501');
    expect(p.badges.filter((b) => b.earned).map((b) => b.code)).toEqual(['FIRST_STEP']);
  });

  it('zero activity earns no badges', async () => {
    const svc = new GamificationService(ext(0, 0) as never);
    const p = await svc.getProfile('rvce', 'x', 'CS501');
    expect(p.earnedCount).toBe(0);
    expect(p.points).toBe(0);
  });

  it('leaderboard ranks by points and flags the current user', async () => {
    const svc = new GamificationService(ext(12, 30) as never); // me: 12*10+30*5=270 → top
    const board = await svc.getLeaderboard('rvce', '1RV21CS001', 'CS501');
    expect(board[0].rank).toBe(1);
    expect(board[0].isMe).toBe(true);
    // ranks strictly increasing, points non-increasing
    for (let i = 1; i < board.length; i++) {
      expect(board[i].rank).toBe(i + 1);
      expect(board[i].points).toBeLessThanOrEqual(board[i - 1].points);
    }
  });

  it('tolerates an absent LmsExtensionsService', async () => {
    const svc = new GamificationService(undefined);
    const p = await svc.getProfile('rvce', 'x', 'CS501');
    expect(p.streak).toBe(0);
    expect(p.learningHours).toBe(0);
    expect(p.earnedCount).toBe(0);
  });
});
