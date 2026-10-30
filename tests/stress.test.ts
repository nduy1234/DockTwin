import { describe, expect, it } from "vitest";
import { heuristicFix } from "@/engine/heuristics";
import { boundaryProbe, focusContainers, generateScenarios } from "@/engine/scenarios";
import { Scenario, TwinSpec, type RuleDiff } from "@/engine/schema";
import { runScenario } from "@/engine/sim";
import { applyDiff, diffLines, topBugs, verifyFix } from "@/engine/verify";
import { mockPortTwin } from "@/templates/port";
import { reeferTwin, rule } from "./fixtures";

const spec = () => mockPortTwin("Reefer box MSCU1234565 at Lane 4, plug at 4°C, customs hold possible.");

describe("generateScenarios", () => {
  it("is deterministic per seed and schema-valid", () => {
    const a = generateScenarios(spec(), 7);
    expect(JSON.stringify(generateScenarios(spec(), 7))).toBe(JSON.stringify(a));
    expect(a.map((s) => s.id)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
    for (const s of a) expect(Scenario.safeParse(s).success).toBe(true);
    const ids = new Set(spec().objects.map((o) => o.id));
    for (const s of a) for (const e of [...s.signals, ...s.stateChanges]) expect(ids.has(e.target)).toBe(true);
  });

  it("prioritizes reefers and boxes named in rules", () => {
    const s = TwinSpec.parse(spec());
    s.objects.push({ id: "PLAIN1", kind: "container", label: "", props: [], attachedTo: null });
    expect(focusContainers(s, 1)).toEqual(["MSCU1234565"]);
  });

  it("boundary probe walks thresholds below, onto, and past", () => {
    const s = reeferTwin([
      rule({
        id: "R1",
        when: { all: [{ of: "self", fact: "signal.reefer_sensor.temp_c", op: "gt", value: 8 }], any: [] },
        then: [{ type: "recommend", level: "inspect", reason: "" }],
      }),
    ]);
    const p = boundaryProbe(s)!;
    const box1 = p.signals.filter((e) => e.target === "BOX1").map((e) => e.value);
    expect(box1).toEqual([7.5, 8, 8.5]);
  });
});

describe("stress test on the mock twin", () => {
  const s = spec();
  const scenarios = generateScenarios(s, 1);
  const results = scenarios.map((sc) => runScenario(s, sc));
  const bugs = topBugs(results);

  it("finds the planted bugs: R4/R5 route conflict and the trust-the-carrier reefer gap", () => {
    expect(bugs.find((b) => b.kind === "conflict")).toMatchObject({ ruleIds: ["R4", "R5"], subject: "MSCU1234565" });
    expect(bugs.find((b) => b.kind === "invariant_violation")).toMatchObject({ invariantId: "INV2", scenarioId: "S3" });
  });

  it("heuristic fixes are verified by re-simulation", () => {
    for (const bug of bugs) {
      const diff = heuristicFix(s, bug);
      expect(diff, bug.key).not.toBeNull();
      const v = verifyFix(s, scenarios, results, diff!, bug.key);
      expect(v.targetFixed, bug.key).toBe(true);
      expect(v.verdict, bug.key).not.toBe("rejected");
    }
  });

  it("rejects a 'fix' that just deletes the safety rule and flags weakening", () => {
    const conflict = bugs.find((b) => b.kind === "conflict")!;
    const bad: RuleDiff = { rationale: "remove it", ops: [{ op: "remove", ruleId: "R2", rule: null }] };
    const v = verifyFix(s, scenarios, results, bad, conflict.key);
    expect(v.targetFixed).toBe(false);
    expect(v.verdict).toBe("rejected");
    expect(v.introduced.some((b) => b.invariantId === "INV1")).toBe(true); // customs hold now under-handled
  });

  it("applyDiff validates ops and renders a readable diff", () => {
    expect(applyDiff(s, { rationale: "", ops: [{ op: "remove", ruleId: "R99", rule: null }] }).errors).toEqual([
      "op 0: no rule R99 to remove",
    ]);
    const dup = applyDiff(s, { rationale: "", ops: [{ op: "add", ruleId: null, rule: s.rules[0]! }] });
    expect(dup.errors[0]).toContain("already exists");
    const diff = heuristicFix(s, bugs.find((b) => b.kind === "conflict")!)!;
    const lines = diffLines(s, diff);
    expect(lines.some((l) => l.sign === "-" && l.text.startsWith("R5"))).toBe(true);
    expect(lines.some((l) => l.sign === "+" && l.text.includes("(p10)"))).toBe(true);
  });
});

describe("stateAt", () => {
  it("rebuilds state at a tick from the trace", async () => {
    const { stateAt } = await import("@/engine/replay");
    const s = spec();
    const sc = generateScenarios(s, 1).find((x) => x.id === "S2")!;
    const r = runScenario(s, sc);
    expect(stateAt(s, r, 0)["LANE-4"]?.status).toBe("up");
    expect(stateAt(s, r, 3)["LANE-4"]?.status).toBe("down"); // t=30
    expect(stateAt(s, r, 10)["LANE-4"]?.status).toBe("up"); // t=100
  });
});
