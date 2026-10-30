/** Response shapes shared by API routes and the client. */
import type { TaggedScenario } from "@/engine/scenarios";
import type { RuleDiff, TwinSpec } from "@/engine/schema";
import type { Bug, SimResult } from "@/engine/sim";
import type { DiffLine, Verification } from "@/engine/verify";
import type { ModelCall } from "./meta/callLog";

export type StressResponse = {
  seed: number;
  scenarios: TaggedScenario[];
  results: SimResult[];
  bugs: (Bug & { scenarioId: string })[];
  calls: ModelCall[];
  agentError: string | null;
};

export type FixResponse = {
  bugKey: string;
  source: "muse-spark" | "engine-fallback" | "mock";
  diff: RuleDiff;
  lines: DiffLine[];
  verification: Omit<Verification, "after">;
  patched: TwinSpec;
  calls: ModelCall[];
};

export type FixState = { status: "loading" } | { status: "error"; error: string } | ({ status: "done" } & FixResponse);
