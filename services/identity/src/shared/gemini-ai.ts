import { GoogleGenAI } from '@google/genai';

/**
 * Model IDs, overridable per environment.
 *
 * Not gemini-2.5-*: on a freshly created API project Google returns
 *   404 "This model models/gemini-2.5-flash is no longer available to new users"
 * and gemini-2.5-pro / gemini-2.0-flash report a free-tier `limit: 0` — no
 * allowance at all, not a limit that clears. gemini-3.5-flash is the current
 * generally-available flash model and is what new keys can actually call.
 */
export const GEMINI_FAST = process.env['GEMINI_FAST_MODEL'] ?? 'gemini-3.5-flash';
export const GEMINI_SMART = process.env['GEMINI_SMART_MODEL'] ?? 'gemini-3.5-flash';

/** Tried in order when the preferred model is unavailable on this key. */
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

/** Bounded retry for transient 429/503. Free-tier keys rate-limit aggressively. */
const MAX_ATTEMPTS_PER_MODEL = 3;
const MAX_BACKOFF_MS = 8_000;

let _client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!_client) {
    const key = process.env['GEMINI_API_KEY'];
    if (!key) throw new Error('GEMINI_API_KEY environment variable is required');
    _client = new GoogleGenAI({ apiKey: key });
  }
  return _client;
}

/** Reset the memoised client. Only needed when the key changes at runtime (tests). */
export function resetGeminiClient(): void {
  _client = null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? '');
}

/**
 * Transient: the same model may succeed shortly. 429 is per-minute throttling,
 * 503 is Google shedding load. Both carry a retryDelay we honour when present.
 */
export function isRetryableError(err: unknown): boolean {
  const m = errText(err);
  return m.includes('429') || m.includes('RESOURCE_EXHAUSTED') ||
         m.includes('503') || m.includes('UNAVAILABLE');
}

/**
 * Permanent for this model but possibly fine on another: the model does not
 * exist for this key, or has a hard zero free-tier allowance. Retrying the same
 * model cannot help; a different model can.
 */
export function isModelUnavailableError(err: unknown): boolean {
  const m = errText(err);
  return m.includes('NOT_FOUND') || m.includes('404') ||
         m.includes('is not found for API version') ||
         m.includes('no longer available') ||
         m.includes('limit: 0');
}

/** Google's suggested retryDelay ("13.02s") when present, else exponential. */
export function backoffMs(err: unknown, attempt: number): number {
  const m = /"?retryDelay"?:\s*"?(\d+(?:\.\d+)?)s/.exec(errText(err));
  const suggested = m ? Math.ceil(parseFloat(m[1]!) * 1000) : 0;
  const exponential = 500 * 2 ** attempt;
  return Math.min(Math.max(suggested, exponential), MAX_BACKOFF_MS);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Models to attempt, preferred first, deduplicated. */
export function modelChain(preferred: string): string[] {
  return [...new Set([preferred, ...FALLBACK_MODELS])];
}

/**
 * Run `attempt` against each model in the chain, retrying transient failures
 * with backoff before moving on. Shared by streaming and non-streaming callers
 * so both degrade identically.
 */
export async function withGeminiRetry<T>(
  preferred: string,
  attempt: (model: string) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;

  for (const model of modelChain(preferred)) {
    for (let i = 0; i < MAX_ATTEMPTS_PER_MODEL; i++) {
      try {
        return await attempt(model);
      } catch (err) {
        lastErr = err;
        if (isRetryableError(err) && i < MAX_ATTEMPTS_PER_MODEL - 1) {
          await sleep(backoffMs(err, i));
          continue;
        }
        // Not retryable on this model: try the next one if the failure is
        // model-specific, otherwise give up — a malformed prompt or a genuine
        // outage fails identically everywhere.
        if (isModelUnavailableError(err) || isRetryableError(err)) break;
        throw err;
      }
    }
  }

  throw lastErr;
}

export async function geminiGenerate(
  prompt: string,
  model: string = GEMINI_SMART,
  maxTokens = 2048,
): Promise<string> {
  return withGeminiRetry(model, async (candidate) => {
    const res = await getGeminiClient().models.generateContent({
      model: candidate,
      contents: prompt,
      // Gemini charges "thinking" tokens against maxOutputTokens, and the amount
      // is unpredictable — 702 thinking tokens for a 7-token answer was observed.
      // Callers here pass small budgets (voice turns use 80), so a single long
      // think returns an empty string and the caller silently degrades: dead air
      // on a call, or a blank AI reply.
      config: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: maxTokens },
    });
    return res.text ?? '';
  });
}
