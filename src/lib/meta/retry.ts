/**
 * Exponential backoff with full jitter. Per Meta's error-handling guidance,
 * client errors are not retried (a 400 will fail the same way again), except
 * 408 timeouts and 429 rate limits.
 */
export function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === undefined) return true; // network / timeout
  return status === 408 || status === 429 || status >= 500;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries?: number; baseMs?: number; onAttempt?: (n: number) => void } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseMs ?? 500;
  let last: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    opts.onAttempt?.(attempt);
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      if (attempt > retries || !isRetryable(err)) break;
      const delay = Math.random() * base * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw last;
}
