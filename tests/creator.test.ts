import { describe, expect, it } from "vitest";
import { heuristicFix } from "@/engine/heuristics";
import { layoutTwin } from "@/engine/layout";
import { generateScenarios, onOff, triggers } from "@/engine/scenarios";
import { checkTwin, Scenario, TwinSpec } from "@/engine/schema";
import { runScenario } from "@/engine/sim";
import { topBugs, verifyFix } from "@/engine/verify";
import { mockCreatorTwin } from "@/templates/creator";

const spec = TwinSpec.parse(mockCreatorTwin("automatic door"));

describe("creator template", () => {
  it("mock door twin is valid", () => {
    expect(checkTwin(spec)).toEqual([]);
    expect(spec.domain).toBe("creator");
  });

  it("derives on/off values per operator", () => {
    const p = (op: "gt" | "lt" | "eq" | "neq", value: number | boolean) => ({ of: "self", fact: "signal.sensor.x", op, value });
    expect(onOff(p("gt", 10))).toEqual({ on: 10.5, off: 9.5 });
    expect(onOff(p("lt", 10))).toEqual({ on: 9.5, off: 10.5 });
    expect(onOff(p("eq", 40))).toEqual({ on: 40, off: 42 });
    expect(onOff(p("eq", true))).toEqual({ on: true, off: false });
    expect(onOff(p("neq", true))).toEqual({ on: false, off: true });
  });

  it("finds the readings the rules react to", () => {
    expect(triggers(spec).map((t) => `${t.target}.${t.key}:${String(t.on)}`)).toEqual([
      "SENSOR-1.motion:true",
      "BEAM-1.beam_blocked:true",
      "MOTOR-1.power_ok:false",
    ]);
  });
});

describe("creator stress test", () => {
  const scenarios = generateScenarios(spec, 1);
  const results = scenarios.map((s) => runScenario(spec, s));
  const bugs = topBugs(results, 6);

  it("generates generic interaction scenarios", () => {
    expect(scenarios.map((s) => s.id)).toEqual(["C1", "C2", "C3", "C4", "C5"]);
    for (const s of scenarios) expect(Scenario.safeParse(s).success).toBe(true);
  });

  it("finds the chattering door and the unhandled power loss", () => {
    expect(bugs.find((b) => b.kind === "oscillation")?.ruleIds).toEqual(["R2", "R3"]);
    expect(bugs.some((b) => b.kind === "invariant_violation" && b.invariantId === "INV2")).toBe(true);
  });

  it("every heuristic fix is proven by re-simulation", () => {
    for (const bug of bugs) {
      const diff = heuristicFix(spec, bug);
      expect(diff, bug.key).not.toBeNull();
      const v = verifyFix(spec, scenarios, results, diff!, bug.key);
      expect(v.targetFixed, bug.key).toBe(true);
      expect(v.verdict, bug.key).not.toBe("rejected");
    }
  });
});

describe("creator layout", () => {
  it("places the door and its parts around it, deterministically", () => {
    const placed = layoutTwin(spec);
    expect(placed.map((p) => p.id).sort()).toEqual(spec.objects.map((o) => o.id).sort());
    const door = placed.find((p) => p.id === "DOOR-1")!;
    for (const id of ["SENSOR-1", "BEAM-1", "MOTOR-1"]) {
      const p = placed.find((x) => x.id === id)!;
      expect(Math.abs(p.pos[0] - door.pos[0])).toBeLessThan(4);
    }
    expect(JSON.stringify(layoutTwin(spec))).toBe(JSON.stringify(placed));
  });
});
