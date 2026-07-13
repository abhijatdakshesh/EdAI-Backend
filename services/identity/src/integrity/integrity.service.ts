import { Injectable } from '@nestjs/common';

export interface SubmissionInput { id: string; usn: string; text: string; }
export interface IntegrityResult {
  id: string; usn: string;
  plagiarismScore: number;   // 0..100 — max similarity to another submission
  matchedWith?: string;      // usn of the closest match
  aiScore: number;           // 0..100 — heuristic likelihood of AI-generated text
  flagged: boolean;          // plagiarism ≥ 60 or aiScore ≥ 70
}

const PLAGIARISM_FLAG = 60;
const AI_FLAG = 70;
const AI_CONNECTIVES = [
  'furthermore', 'moreover', 'in conclusion', 'it is important to note', 'overall',
  'additionally', 'in summary', 'as a result', 'consequently', 'in essence', 'delve',
];

/** Normalize → lowercase word tokens (punctuation stripped). */
function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/** k-word shingles as a set. */
function shingles(text: string, k = 3): Set<string> {
  const t = tokens(text);
  const s = new Set<string>();
  if (t.length < k) { if (t.length) s.add(t.join(' ')); return s; }
  for (let i = 0; i <= t.length - k; i++) s.add(t.slice(i, i + k).join(' '));
  return s;
}

export function jaccard(a: string, b: string): number {
  const sa = shingles(a), sb = shingles(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Heuristic AI-likelihood: uniform sentence lengths (low burstiness) + AI connectives. */
export function aiHeuristic(text: string): number {
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (sentences.length < 2) return 0;
  const lens = sentences.map((s) => tokens(s).length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
  const std = Math.sqrt(variance);
  // Low burstiness (uniform lengths) → AI-like. cv = std/mean; small cv → high score.
  const cv = mean > 0 ? std / mean : 1;
  const burstinessScore = Math.max(0, 1 - cv); // 1 = perfectly uniform
  // AI connective density.
  const lower = text.toLowerCase();
  const hits = AI_CONNECTIVES.reduce((n, p) => n + (lower.includes(p) ? 1 : 0), 0);
  const connectiveScore = Math.min(1, hits / 4);
  const score = 0.6 * burstinessScore + 0.4 * connectiveScore;
  return Math.round(score * 100);
}

@Injectable()
export class IntegrityService {
  /** Pairwise plagiarism + per-text AI score across a batch of submissions. */
  checkBatch(subs: SubmissionInput[]): IntegrityResult[] {
    return subs.map((s) => {
      let best = 0;
      let matchedWith: string | undefined;
      for (const other of subs) {
        if (other.id === s.id) continue;
        const sim = jaccard(s.text, other.text);
        if (sim > best) { best = sim; matchedWith = other.usn; }
      }
      const plagiarismScore = Math.round(best * 100);
      const aiScore = aiHeuristic(s.text);
      return {
        id: s.id, usn: s.usn, plagiarismScore,
        matchedWith: plagiarismScore > 0 ? matchedWith : undefined,
        aiScore,
        flagged: plagiarismScore >= PLAGIARISM_FLAG || aiScore >= AI_FLAG,
      };
    });
  }
}
