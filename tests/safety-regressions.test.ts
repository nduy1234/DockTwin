import { describe, expect, it } from "vitest";
import { decideAt } from "@/engine/decide";
import { DEMO_SEED, demoTerminal, PROBLEM_BOX } from "@/engine/demo";
import { heuristicFix } from "@/engine/heuristics";
import { generateScenarios } from "@/engine/scenarios";
import { LADDER, TwinSpec, type LadderLevel, type RuleDiff, type Scenario } from "@/engine/schema";
import { levelIndex, runScenario } from "@/engine/sim";
import { topBugs, verifyFix } from "@/engine/verify";
import { reeferTwin, scenario } from "./fixtures";

/**
 * Regressions for the confirmed safety bypasses, written against the engine's
 * existing API so each one failed before the safety policy existed.
 */
const demo = () => TwinSpec.parse(demoTerminal());
const decisionFor = (spec: TwinSpec, s: Scenario, t: number, subject: string) => {
  const r = runScenario(spec, s);
  return decideAt(spec, s, r, r.ticks.findIndex((x) => x.t === t)).find((d) => d.subject === subject);
};
const atLeast = (got: LadderLevel | undefined, want: LadderLevel) => levelIndex(got) >= LADDER.indexOf(want);
const hold = (t = 0, value = true) => ({ t, source: "customs" as const, target: "BOX1", key: "hold", value });
const reading = (target: string, value: number, t = 0) => ({ t, source: "reefer_sensor" as const, target, key: "temp_c", value });

describe("confirmed safety bypasses", () => {
  it("#1 rejects a fix that reclassifies a warm reefer to switch off an invariant", () => {
    const spec = demo();
    const scenarios = generateScenarios(spec, DEMO_SEED);
    const results = scenarios.map((s) => runScenario(spec, s));
    const bug = topBugs(results, 9).find((b) => b.kind === "invariant_violation")!;
    const diff: RuleDiff = {
      rationale: "reclassify",
      ops: [
        {
          op: "add",
          ruleId: null,
          rule: {
            id: "R7",
            name: "Warm box is not a reefer",
            appliesTo: { kind: "container", ids: [] },
            priority: 9,
            when: { all: [{ of: "self", fact: "signal.reefer_sensor.temp_c", op: "gt", value: 7 }], any: [] },
            then: [{ type: "set", key: "reefer", value: false }],
          },
        },
      ],
    };
    expect(verifyFix(spec, scenarios, results, diff, bug.key).verdict).toBe("rejected");
  });

  it("#2 still needs human approval at S3@40 after the reefer fix is applied", () => {
    const spec = demo();
    const scenarios = generateScenarios(spec, DEMO_SEED);
    const results = scenarios.map((s) => runScenario(spec, s));
    const bug = topBugs(results, 9).find((b) => b.kind === "invariant_violation")!;
    const fixed = verifyFix(spec, scenarios, results, heuristicFix(spec, bug)!, bug.key).spec;
    const d = decisionFor(fixed, scenarios.find((s) => s.id === "S3")!, 40, PROBLEM_BOX)!;
    expect(d.approval.required).toBe(true);
  });

  it("#3 holds a box whose customs hold exists only in twin state", () => {
    const spec = demo();
    spec.objects.find((o) => o.id === PROBLEM_BOX)!.props.find((p) => p.key === "customs_hold")!.value = true;
    expect(decisionFor(spec, scenario(), 30, PROBLEM_BOX)?.level).toBe("hold");
  });

  it("#4 holds a box on a customs signal when the twin has no rules or invariants", () => {
    const spec = reeferTwin();
    expect(decisionFor(spec, scenario({ signals: [hold()] }), 30, "BOX1")?.level).toBe("hold");
  });

  it("#5 reads a frozen reefer against its own setpoint", () => {
    const spec = reeferTwin();
    spec.objects[0]!.props.find((p) => p.key === "setpoint_c")!.value = -18;
    const d = decisionFor(spec, scenario({ signals: [reading("BOX1", 0)] }), 10, "BOX1");
    expect(atLeast(d?.level, "inspect")).toBe(true);
  });

  it("#7 requires review when an inspect decision sits on a box the rules fast-laned", () => {
    const spec = demo();
    const s = generateScenarios(spec, DEMO_SEED).find((x) => x.id === "S1")!;
    expect(decisionFor(spec, s, 20, PROBLEM_BOX)?.approval.required).toBe(true);
  });

  it("#8 a self-clearing customs rule cannot hide the hold", () => {
    const spec = reeferTwin([
      {
        id: "R1",
        name: "Latch",
        appliesTo: { kind: "container", ids: [] },
        priority: 1,
        when: {
          all: [
            { of: "self", fact: "signal.customs.hold", op: "eq", value: true },
            { of: "self", fact: "customs_hold", op: "missing", value: null },
          ],
          any: [],
        },
        then: [
          { type: "set", key: "customs_hold", value: true },
          { type: "recommend", level: "hold", reason: "held" },
        ],
      },
    ]);
    expect(decisionFor(spec, scenario({ signals: [hold()] }), 30, "BOX1")?.level).toBe("hold");
  });

  it("#10 surfaces an unplugged reefer instead of reading silence as safe", () => {
    const spec = demo();
    const plug = `PLUG-${PROBLEM_BOX}`;
    const s = scenario({ stateChanges: [{ t: 0, target: plug, key: "power_ok", value: false }] });
    expect(atLeast(decisionFor(spec, s, 30, PROBLEM_BOX)?.level, "ask")).toBe(true);
  });

  it("flags a rule that rewrites a customs hold to false", () => {
    const spec = reeferTwin(
      [
        {
          id: "R1",
          name: "Clear hold",
          appliesTo: { kind: "container", ids: [] },
          priority: 9,
          when: { all: [{ of: "self", fact: "signal.customs.hold", op: "eq", value: true }], any: [] },
          then: [{ type: "set", key: "customs_hold", value: false }],
        },
      ],
    );
    expect(decisionFor(spec, scenario({ signals: [hold()] }), 30, "BOX1")?.level).toBe("hold");
  });

  it("only customs can release a hold, and a carrier claim cannot", () => {
    const spec = reeferTwin();
    const carrier = { t: 10, source: "carrier" as const, target: "BOX1", key: "hold", value: false };
    expect(decisionFor(spec, scenario({ signals: [hold(), carrier] }), 30, "BOX1")?.level).toBe("hold");
    expect(decisionFor(spec, scenario({ signals: [hold(), hold(20, false)] }), 30, "BOX1")).toBeUndefined();
  });
});
