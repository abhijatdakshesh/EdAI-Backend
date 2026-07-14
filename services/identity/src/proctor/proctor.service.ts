import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type FlagType = 'TAB_SWITCH' | 'FOCUS_LOSS' | 'FULLSCREEN_EXIT' | 'COPY_PASTE' | 'MULTIPLE_FACES' | 'NO_FACE';

export interface Question { id: string; q: string; options: string[]; correctIndex: number; }
export interface Assessment { id: string; courseId: string; title: string; durationSec: number; questions: Question[]; }
export interface AttemptFlag { type: FlagType; ts: string; }
export interface Attempt {
  id: string; assessmentId: string; usn: string; startedAt: string;
  flags: AttemptFlag[]; submittedAt?: string; score?: number; integrityScore?: number; flagged?: boolean;
}

const PENALTY: Record<FlagType, number> = {
  TAB_SWITCH: 10, FOCUS_LOSS: 5, FULLSCREEN_EXIT: 8, COPY_PASTE: 15, MULTIPLE_FACES: 20, NO_FACE: 10,
};
const INTEGRITY_FLAG_THRESHOLD = 70;

/** Student-facing question (no answer key). */
export type PublicQuestion = Omit<Question, 'correctIndex'>;

@Injectable()
export class ProctorService {
  private assessments: Assessment[] = [];
  private attempts: Attempt[] = [];

  constructor() { this.seedDemo(); }

  private seedDemo(): void {
    this.assessments.push({
      id: 'as-cs501-1', courseId: 'CS501', title: 'OS Quiz 1 — Process Scheduling', durationSec: 600,
      questions: [
        { id: 'q1', q: 'Which scheduling algorithm can cause starvation?', options: ['FCFS', 'Round Robin', 'Priority (non-aging)', 'SJF preemptive'], correctIndex: 2 },
        { id: 'q2', q: 'Round Robin is governed by which parameter?', options: ['Burst time', 'Time quantum', 'Arrival time', 'Priority'], correctIndex: 1 },
        { id: 'q3', q: 'A deadlock requires which condition?', options: ['Preemption', 'Mutual exclusion', 'Unlimited resources', 'Single process'], correctIndex: 1 },
      ],
    });
  }

  getForStudent(id: string): { id: string; courseId: string; title: string; durationSec: number; questions: PublicQuestion[] } {
    const a = this.assessments.find((x) => x.id === id);
    if (!a) throw new NotFoundException('Assessment not found');
    return {
      id: a.id, courseId: a.courseId, title: a.title, durationSec: a.durationSec,
      questions: a.questions.map(({ correctIndex: _c, ...q }) => q),
    };
  }

  startAttempt(assessmentId: string, usn: string): Attempt {
    if (!this.assessments.find((x) => x.id === assessmentId)) throw new NotFoundException('Assessment not found');
    const attempt: Attempt = { id: randomUUID(), assessmentId, usn, startedAt: new Date().toISOString(), flags: [] };
    this.attempts.push(attempt);
    return attempt;
  }

  flag(attemptId: string, type: FlagType): { ok: true; flagCount: number } {
    const a = this.getAttempt(attemptId);
    if (!a.submittedAt) a.flags.push({ type, ts: new Date().toISOString() });
    return { ok: true, flagCount: a.flags.length };
  }

  /** Auto-grade + compute integrity score from accumulated flags. */
  submit(attemptId: string, answers: Record<string, number>): Attempt {
    const a = this.getAttempt(attemptId);
    const assessment = this.assessments.find((x) => x.id === a.assessmentId);
    if (!assessment) throw new NotFoundException('Assessment not found');

    const correct = assessment.questions.reduce((n, q) => n + (answers[q.id] === q.correctIndex ? 1 : 0), 0);
    a.score = Math.round((correct / assessment.questions.length) * 100);

    const penalty = a.flags.reduce((sum, f) => sum + (PENALTY[f.type] ?? 0), 0);
    a.integrityScore = Math.max(0, 100 - penalty);
    a.flagged = a.integrityScore < INTEGRITY_FLAG_THRESHOLD;
    a.submittedAt = new Date().toISOString();
    return a;
  }

  getAttempt(attemptId: string): Attempt {
    const a = this.attempts.find((x) => x.id === attemptId);
    if (!a) throw new NotFoundException('Attempt not found');
    return a;
  }

  /** Staff: attempts for an assessment (with integrity). */
  listAttempts(assessmentId: string): Attempt[] {
    return this.attempts.filter((x) => x.assessmentId === assessmentId);
  }
}
