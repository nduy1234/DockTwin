import { NextResponse } from "next/server";
import { z } from "zod";
import { generateScenarios, type TaggedScenario } from "@/engine/scenarios";
import { checkTwin, TwinSpec } from "@/engine/schema";
import { runScenario } from "@/engine/sim";
import { topBugs } from "@/engine/verify";
import { sparkScenarios } from "@/lib/meta/agents";
import type { ModelCall } from "@/lib/meta/callLog";
import { MetaConfigError } from "@/lib/meta/client";
import { SparkError } from "@/lib/meta/spark";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ spec: TwinSpec, seed: z.number().int().default(20261104) });

/**
 * Stress test: seeded scenarios (repeatable floor) + Muse Spark adversarial
 * scenarios, all run through the deterministic engine.
 */
export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Expected { spec: TwinSpec, seed?: number }" }, { status: 400 });
  const { spec, seed } = body.data;
  const issues = checkTwin(spec);
  if (issues.length) return NextResponse.json({ error: `Invalid twin: ${issues.join("; ")}` }, { status: 400 });

  const seeded = generateScenarios(spec, seed);
  const calls: ModelCall[] = [];
  let agent: TaggedScenario[] = [];
  let agentError: string | null = null;
  try {
    const r = await sparkScenarios(spec, seeded);
    agent = r.scenarios;
    calls.push(r.call);
  } catch (err) {
    if (err instanceof MetaConfigError) return NextResponse.json({ error: err.message, calls }, { status: 503 });
    if (!(err instanceof SparkError)) throw err;
    // Degrade gracefully: the seeded scenarios still give a full, repeatable test.
    calls.push(err.call);
    agentError = err.message;
  }

  const scenarios = [...seeded, ...agent];
  const results = scenarios.map((s) => runScenario(spec, s));
  return NextResponse.json({ seed, scenarios, results, bugs: topBugs(results, 4), calls, agentError });
}
