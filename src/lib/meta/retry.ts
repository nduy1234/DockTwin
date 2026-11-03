/**
 * Exponential backoff with full jitter, bounded by an absolute deadline.
 * Per Meta's error-handling guidance, client errors are not retried (a 400
 * will fail the same way again), except 408 timeouts and 429 rate limits.
 *
 * Every attempt gets timeoutMs = min(requestTimeoutMs, time left), and
 * backoff never sleeps past the deadline, so a call can never run longer than
 * its budget regardless of how many retries remain.
 */
export function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === undefined) return true; // network / timeout / abort
  return status === 408 || status === 429 || status >= 500;
}

export class DeadlineError extends Error {
  constructor(readonly last?: unknown) {
    super(`deadline exceeded${last instanceof Error ? ` (last error: ${last.message})` : ""}`);
  }
}

export type RetryOptions = {
  retries?: number;
  baseMs?: number;
  /** Absolute epoch ms after which no new attempt starts. */
  deadline?: number;
  /** Cap for a single attempt. */
  requestTimeoutMs?: number;
  /** Don't start an attempt with less time than this left. */
  minAttemptMs?: number;
  onAttempt?: (n: number) => void;
};

export async function withRetry<T>(fn: (attempt: number, timeoutMs: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseMs ?? 500;
  const deadline = opts.deadline ?? Infinity;
  const cap = opts.requestTimeoutMs ?? Infinity;
  const minAttempt = opts.minAttemptMs ?? 0;
  let last: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const left = deadline - Date.now();
    if (left < Math.max(1, minAttempt)) throw new DeadlineError(last);
    opts.onAttempt?.(attempt);
    try {
      return await fn(attempt, Math.min(cap, left));
    } catch (err) {
      last = err;
      if (attempt > retries || !isRetryable(err)) break;
      const delay = Math.min(Math.random() * base * 2 ** (attempt - 1), Math.max(0, deadline - Date.now() - minAttempt));
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw last;
}
