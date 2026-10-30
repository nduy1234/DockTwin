import { NextResponse } from "next/server";
import { z } from "zod";
import { heuristicFix } from "@/engine/heuristics";
import { checkTwin, Scenario, TwinSpec, type RuleDiff } from "@/engine/schema";
import { runScenario } from "@/engine/sim";
import { diffLines, verifyFix } from "@/engine/verify";
import { sparkFix } from "@/lib/meta/agents";
import type { ModelCall } from "@/lib/meta/callLog";
import { MetaConfigError } from "@/lib/meta/client";
import { SparkError } from "@/lib/meta/spark";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  spec: TwinSpec,
  scenarios: z.array(Scenario.extend({ origin: z.enum(["seeded", "muse-spark"]) })).min(1).max(12),
  bugKey: z.string().min(1),
});

/**
 * Muse Spark proposes a rule diff for one bug; the engine applies it to a copy
 * and re-runs every scenario to accept, flag, or reject it.
 */
export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Expected { spec, scenarios, bugKey }" }, { status: 400 });
  const { spec, scenarios, bugKey } = body.data;
  if (checkTwin(spec).length) return NextResponse.json({ error: "Invalid twin" }, { status: 400 });

  // Recompute the baseline server-side; never trust client-supplied results.
  const before = scenarios.map((s) => runScenario(spec, s));
  const found = before.flatMap((r, i) => r.bugs.map((b) => ({ b, s: scenarios[i]! }))).find((x) => x.b.key === bugKey);
  if (!found) return NextResponse.json({ error: `Bug ${bugKey} does not reproduce` }, { status: 409 });

  const calls: ModelCall[] = [];
  let diff: RuleDiff | null = null;
  let source: "muse-spark" | "engine-fallback" | "mock" = "muse-spark";
  try {
    const r = await sparkFix(spec, found.b, found.s);
    diff = r.data;
    calls.push(r.call);
    if (r.call.mock) source = "mock";
  } catch (err) {
    if (err instanceof MetaConfigError) return NextResponse.json({ error: err.message, calls }, { status: 503 });
    if (!(err instanceof SparkError)) throw err;
    calls.push(err.call);
    diff = heuristicFix(spec, found.b);
    source = "engine-fallback";
  }
  if (!diff) return NextResponse.json({ error: "No fix could be proposed", calls }, { status: 422 });

  const v = verifyFix(spec, scenarios, before, diff, bugKey);
  return NextResponse.json({
    bugKey,
    source,
    diff,
    lines: diffLines(spec, diff),
    verification: {
      verdict: v.verdict,
      targetFixed: v.targetFixed,
      applyErrors: v.applyErrors,
      resolved: v.resolved,
      introduced: v.introduced,
      weakened: v.weakened,
      scenariosRun: v.scenariosRun,
    },
    patched: v.spec,
    calls,
  });
}
