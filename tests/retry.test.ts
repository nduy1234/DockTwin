import { describe, expect, it } from "vitest";
import { isRetryable, withRetry } from "@/lib/meta/retry";

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("withRetry", () => {
  it("retries 429/5xx then succeeds", async () => {
    let n = 0;
    const out = await withRetry(
      async () => {
        n++;
        if (n < 3) throw httpError(n === 1 ? 429 : 503);
        return "ok";
      },
      { baseMs: 1 },
    );
    expect(out).toBe("ok");
    expect(n).toBe(3);
  });

  it("never retries a 400", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw httpError(400);
        },
        { baseMs: 1 },
      ),
    ).rejects.toThrow("HTTP 400");
    expect(n).toBe(1);
  });

  it("gives up after the retry budget", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw httpError(500);
        },
        { retries: 2, baseMs: 1 },
      ),
    ).rejects.toThrow();
    expect(n).toBe(3);
  });

  it("classifies errors", () => {
    expect(isRetryable(new Error("socket hang up"))).toBe(true);
    expect(isRetryable(httpError(408))).toBe(true);
    expect(isRetryable(httpError(401))).toBe(false);
  });
});
