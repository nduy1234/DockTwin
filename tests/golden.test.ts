import { describe, expect, it } from "vitest";
import { decideAt } from "@/engine/decide";
import { DEMO_SEED, demoTerminal, PROBLEM_BOX } from "@/engine/demo";
import { heuristicFix } from "@/engine/heuristics";
import { focusContainers, generateScenarios } from "@/engine/scenarios";
import { checkTwin, TwinSpec } from "@/engine/schema";
import { runScenario } from "@/engine/sim";
import { topBugs, verifyFix } from "@/engine/verify";

/**
 * Golden test for the demo: the seeded terminal, its seeded scenarios, the
 * bugs found, the verified fixes, and the problem box's decisions must not
 * drift. If a change is intended, review the diff and update with `vitest -u`.
 */
describe("demo golden", () => {
  const spec = TwinSpec.parse(demoTerminal());
  const scenarios = generateScenarios(spec, DEMO_SEED);
  const results = scenarios.map((s) => runScenario(spec, s));

  it("builds a valid 100-box terminal with one problem box in focus", () => {
    expect(checkTwin(spec)).toEqual([]);
    expect(spec.objects.filter((o) => o.kind === "container")).toHaveLength(100);
    expect(focusContainers(spec, 1)).toEqual([PROBLEM_BOX]);
    expect(JSON.stringify(demoTerminal())).toBe(JSON.stringify(spec));
  });

  it("matches the golden summary", async () => {
    const bugs = topBugs(results, 6);
    const decisionAt = (scenarioId: string, t: number) => {
      const i = scenarios.findIndex((s) => s.id === scenarioId);
      const r = results[i]!;
      const d = decideAt(spec, scenarios[i]!, r, r.ticks.findIndex((x) => x.t === t)).find((x) => x.subject === PROBLEM_BOX);
      return d && { level: d.level, ruleLevel: d.ruleLevel, floor: d.floor?.invariantId ?? null, confidence: d.confidence, approval: d.approval.reasons, costUsd: d.cost.actionUsd };
    };
    const summary = {
      objects: spec.objects.length,
      scenarios: scenarios.map((s) => `${s.id} ${s.name}`),
      bugs: bugs.map((b) => ({ key: b.key, scenario: b.scenarioId, firstT: b.firstT, count: b.count })),
      fixes: bugs.map((b) => {
        const v = verifyFix(spec, scenarios, results, heuristicFix(spec, b)!, b.key);
        return { bug: b.key, verdict: v.verdict, resolved: v.resolved.length, introduced: v.introduced.map((x) => x.key) };
      }),
      problemBoxPeaks: Object.fromEntries(results.map((r) => [r.scenarioId, r.outcomes[PROBLEM_BOX]?.peak ?? null])),
      decisions: {
        "S1@20": decisionAt("S1", 20),
        "S2@30": decisionAt("S2", 30),
        "S3@60": decisionAt("S3", 60),
        "S5@30": decisionAt("S5", 30),
      },
    };
    await expect(JSON.stringify(summary, null, 2)).toMatchFileSnapshot("./golden/demo.json");
  });
});
