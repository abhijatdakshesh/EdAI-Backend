import { Injectable, Optional } from '@nestjs/common';
import { LmsExtensionsService } from '../lms/lms-extensions.service';

export interface Badge { code: string; title: string; icon: string; description: string; earned: boolean; }
export interface GamificationProfile {
  usn: string; courseId: string;
  streak: number; learningHours: number; points: number;
  badges: Badge[]; earnedCount: number;
}
export interface LeaderboardRow { rank: number; usn: string; name: string; points: number; streak: number; isMe: boolean; }

// points = streak·10 + learningHours·5 (+ badge bonuses)
function pointsFor(streak: number, learningHours: number): number {
  return Math.round(streak * 10 + learningHours * 5);
}

const BADGE_CATALOG: Array<{ code: string; title: string; icon: string; description: string; test: (s: { streak: number; learningHours: number }) => boolean }> = [
  { code: 'FIRST_STEP', title: 'First Step', icon: '👣', description: 'Started learning', test: (s) => s.learningHours > 0 || s.streak > 0 },
  { code: 'STREAK_3', title: '3-Day Streak', icon: '🔥', description: 'Learned 3 days in a row', test: (s) => s.streak >= 3 },
  { code: 'STREAK_7', title: 'Week Warrior', icon: '⚡', description: '7-day learning streak', test: (s) => s.streak >= 7 },
  { code: 'HOURS_5', title: 'Getting Serious', icon: '📚', description: '5+ learning hours', test: (s) => s.learningHours >= 5 },
  { code: 'HOURS_20', title: 'Scholar', icon: '🎓', description: '20+ learning hours', test: (s) => s.learningHours >= 20 },
];

// Seeded peers so the leaderboard renders meaningfully in the demo.
const DEMO_PEERS: Array<{ usn: string; name: string; streak: number; learningHours: number }> = [
  { usn: '1RV21CS002', name: 'Priya Sharma', streak: 9, learningHours: 24 },
  { usn: '1RV21CS003', name: 'Arjun Kumar', streak: 6, learningHours: 18 },
  { usn: '1RV21CS006', name: 'Sneha Reddy', streak: 4, learningHours: 12 },
  { usn: '1RV21CS007', name: 'Mohammed Irfan', streak: 2, learningHours: 7 },
];

@Injectable()
export class GamificationService {
  constructor(@Optional() private readonly ext?: LmsExtensionsService) {}

  private stats(collegeId: string, usn: string, courseId: string): { streak: number; learningHours: number } {
    const streak = this.ext?.getStreak(collegeId, usn)?.currentStreak ?? 0;
    const learningHours = this.ext?.getLearningHours(usn, courseId) ?? 0;
    return { streak, learningHours };
  }

  getProfile(collegeId: string, usn: string, courseId: string): GamificationProfile {
    const s = this.stats(collegeId, usn, courseId);
    const badges: Badge[] = BADGE_CATALOG.map((b) => ({
      code: b.code, title: b.title, icon: b.icon, description: b.description, earned: b.test(s),
    }));
    const earnedCount = badges.filter((b) => b.earned).length;
    return {
      usn, courseId, streak: s.streak, learningHours: s.learningHours,
      points: pointsFor(s.streak, s.learningHours) + earnedCount * 25,
      badges, earnedCount,
    };
  }

  getLeaderboard(collegeId: string, usn: string, courseId: string): LeaderboardRow[] {
    const me = this.stats(collegeId, usn, courseId);
    const rows = [
      ...DEMO_PEERS.map((p) => ({ usn: p.usn, name: p.name, points: pointsFor(p.streak, p.learningHours), streak: p.streak, isMe: false })),
      { usn: usn || 'me', name: 'You', points: pointsFor(me.streak, me.learningHours), streak: me.streak, isMe: true },
    ];
    return rows
      .sort((a, b) => b.points - a.points)
      .map((r, i) => ({ rank: i + 1, ...r }));
  }
}
