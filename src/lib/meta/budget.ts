/**
 * Time budgets for every Meta call, in one place.
 *
 * Each model call (all retries + schema-repair rounds) runs inside an absolute
 * deadline; each HTTP attempt is capped at REQUEST_TIMEOUT_MS and aborted via
 * AbortSignal. A route's worst case is therefore the sum of the budgets of the
 * calls it makes in sequence (parallel calls share one budget), independent of
 * retry counts. Routes declare maxDuration = 300 s; every worst case below
 * stays under ROUTE_CEILING_MS (~240 s) to leave headroom.
 */
export const REQUEST_TIMEOUT_MS = 60_000;
export const MIN_ATTEMPT_MS = 3_000;
export const ROUTE_CEILING_MS = 240_000;

export const BUDGET_MS = {
  build: 180_000,
  scenarios: 150_000,
  fix: 150_000,
  explain: 45_000,
  transcribe: 60_000,
  segment: 60_000, // SAM: three noun phrases run in parallel under one budget
  vision: 150_000,
} as const;

/** Sequential model calls per route; worst case = sum of their budgets. */
export const ROUTE_CALLS: Record<string, (keyof typeof BUDGET_MS)[]> = {
  "/api/build": ["build"],
  "/api/stress": ["scenarios"],
  "/api/fix": ["fix"],
  "/api/explain": ["explain"],
  "/api/transcribe": ["transcribe"],
  "/api/segment": ["segment", "vision"],
};

/** Slack for work outside model calls (engine runs, JSON, network to client). */
export const ROUTE_OVERHEAD_MS = 10_000;

export function routeWorstCaseMs(route: string): number {
  return (ROUTE_CALLS[route] ?? []).reduce((s, k) => s + BUDGET_MS[k], 0) + ROUTE_OVERHEAD_MS;
}
