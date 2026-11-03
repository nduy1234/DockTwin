import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BUDGET_MS, REQUEST_TIMEOUT_MS, ROUTE_CALLS, ROUTE_CEILING_MS, routeWorstCaseMs } from "@/lib/meta/budget";
import { DeadlineError, isRetryable, withRetry } from "@/lib/meta/retry";

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

describe("time budget", () => {
  it("never runs past its deadline, whatever the retry count", async () => {
    const started = Date.now();
    const timeouts: number[] = [];
    const leftAtStart: number[] = [];
    const err = await withRetry(
      async (_, timeoutMs) => {
        timeouts.push(timeoutMs);
        leftAtStart.push(started + 300 - Date.now());
        // Simulate a request that hangs until its per-attempt timeout aborts it.
        await new Promise((r) => setTimeout(r, timeoutMs));
        throw new Error("aborted");
      },
      { retries: 50, baseMs: 1, deadline: started + 300, requestTimeoutMs: 120, minAttemptMs: 20 },
    ).catch((e: unknown) => e);
    const elapsed = Date.now() - started;
    expect(err).toBeInstanceOf(DeadlineError);
    expect(elapsed).toBeLessThan(300 + 60); // timer slack only
    expect(timeouts.length).toBeLessThanOrEqual(3);
    expect(timeouts.every((t) => t <= 120)).toBe(true);
    // Each attempt is capped by the time left when it starts.
    timeouts.forEach((t, i) => expect(t).toBeLessThanOrEqual(leftAtStart[i]! + 2));
  });

  it("does not start an attempt with less than minAttemptMs left", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => void calls++, { deadline: Date.now() + 5, minAttemptMs: 50 }),
    ).rejects.toBeInstanceOf(DeadlineError);
    expect(calls).toBe(0);
  });

  it("every route's worst case fits under the ceiling and its maxDuration", () => {
    const routesDir = path.resolve(__dirname, "../src/app/api");
    const routes = fs.readdirSync(routesDir).filter((d) => fs.existsSync(path.join(routesDir, d, "route.ts")));
    expect(routes.sort()).toEqual(Object.keys(ROUTE_CALLS).map((r) => r.replace("/api/", "")).sort());
    for (const r of routes) {
      const src = fs.readFileSync(path.join(routesDir, r, "route.ts"), "utf8");
      const maxDuration = Number(src.match(/export const maxDuration = (\d+);/)?.[1]) * 1000;
      const worst = routeWorstCaseMs(`/api/${r}`);
      expect(maxDuration, r).toBe(300_000);
      expect(worst, r).toBeLessThanOrEqual(ROUTE_CEILING_MS);
      expect(worst, r).toBeLessThan(maxDuration);
    }
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(Math.min(...Object.values(BUDGET_MS)) + 15_000);
  });
});
