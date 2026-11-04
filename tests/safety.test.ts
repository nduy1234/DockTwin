import { describe, expect, it } from "vitest";
import { decideAt, overrideOptions } from "@/engine/decide";
import { DEMO_SEED, demoTerminal, PROBLEM_BOX } from "@/engine/demo";
import { heuristicFix } from "@/engine/heuristics";
import { rng } from "@/engine/rng";
import { evaluatePortSafety, initialWorld, observeWorld, PROTECTED_FACTS, SAFETY_ASSUMPTIONS, SAFETY_POLICIES, type SafetyPolicyId } from "@/engine/safety";
import { generateScenarios } from "@/engine/scenarios";
import { checkTwin, TwinSpec, type LadderLevel, type Rule, type RuleDiff, type Scalar, type Scenario, type SignalEvent } from "@/engine/schema";
import { levelIndex, runScenario } from "@/engine/sim";
import { applyDiff, verifyFix } from "@/engine/verify";
import { mockCreatorTwin } from "@/templates/creator";
import { reeferTwin, rule, scenario } from "./fixtures";

const BOX = "BOX1";
const decide = (spec: TwinSpec, s: Scenario, t: number) => {
  const r = runScenario(spec, s);
  return decideAt(spec, s, r, r.ticks.findIndex((x) => x.t === t));
};
const of = (spec: TwinSpec, s: Scenario, t: number, subject = BOX) => decide(spec, s, t).find((d) => d.subject === subject);
const policies = (spec: TwinSpec, s: Scenario, t: number, subject = BOX) => of(spec, s, t, subject)?.evidence.safety.map((f) => f.policyId) ?? [];
const sig = (source: SignalEvent["source"], key: string, value: Scalar, t = 0, target = BOX): SignalEvent => ({ t, source, target, key, value });
const change = (key: string, value: Scalar, t = 0, target = BOX) => ({ t, target, key, value });
const withSetpoint = (setpoint: number) => {
  const spec = reeferTwin();
  spec.objects[0]!.props.find((p) => p.key === "setpoint_c")!.value = setpoint;
  return spec;
};
const held = (spec: TwinSpec) => {
  const box = spec.objects.find((o) => o.id === BOX)!;
  box.props.push({ key: "customs_hold", value: true });
  return spec;
};
const setRule = (key: string, value: Scalar): Rule =>
  rule({ id: "RX", priority: 99, when: { all: [{ of: "self", fact: "reefer", op: "exists", value: null }], any: [] }, then: [{ type: "set", key, value }] });

describe("reefer temperature is relative to each box's own setpoint", () => {
  const excursion = SAFETY_ASSUMPTIONS.reeferExcursionC;

  describe.each([-25, -18, 0, 2, 4, 13, 25])("setpoint %d°C", (setpoint) => {
    it.each([
      [excursion - 0.5, false],
      [excursion, false],
      [excursion + 0.1, true],
      [excursion + 15, true],
    ])("reading +%d°C fires: %s", (delta, fires) => {
      const s = scenario({ signals: [sig("reefer_sensor", "temp_c", setpoint + delta)] });
      expect(policies(withSetpoint(setpoint), s, 10).includes("SAFETY-REEFER-TEMP")).toBe(fires);
    });
  });

  it("treats the same reading differently for different setpoints", () => {
    const s = scenario({ signals: [sig("reefer_sensor", "temp_c", 0)] });
    expect(policies(withSetpoint(-18), s, 10)).toContain("SAFETY-REEFER-TEMP");
    expect(policies(withSetpoint(4), s, 10)).toEqual([]);
  });

  it("uses the assumptions it is given, without any TwinSpec input", () => {
    const spec = withSetpoint(4);
    const signals = { [BOX]: { "reefer_sensor.temp_c": { value: 6, t: 0 } } };
    expect(evaluatePortSafety(spec, initialWorld(spec), signals, 0)[BOX]).toBeUndefined();
    const strict = evaluatePortSafety(spec, initialWorld(spec), signals, 0, { ...SAFETY_ASSUMPTIONS, reeferExcursionC: 1 });
    expect(strict[BOX]?.map((f) => f.policyId)).toEqual(["SAFETY-REEFER-TEMP"]);
  });

  it("ignores carrier temperature claims in either direction", () => {
    const spec = withSetpoint(4);
    expect(policies(spec, scenario({ signals: [sig("carrier", "temp_c", 40)] }), 10)).toEqual([]);
    const hot = scenario({ signals: [sig("reefer_sensor", "temp_c", 12), sig("carrier", "temp_ok", true, 10), sig("carrier", "temp_c", 4, 10)] });
    expect(policies(spec, hot, 20)).toContain("SAFETY-REEFER-TEMP");
  });

  it("a newer reading supersedes an older one, and on a tie the hotter wins", () => {
    const spec = withSetpoint(4);
    const cooled = scenario({ stateChanges: [change("temp_c", 12, 0)], signals: [sig("reefer_sensor", "temp_c", 5, 20)] });
    expect(policies(spec, cooled, 30)).toEqual([]);
    const tied = scenario({ stateChanges: [change("temp_c", 12, 20)], signals: [sig("reefer_sensor", "temp_c", 5, 20)] });
    expect(policies(spec, tied, 30)).toContain("SAFETY-REEFER-TEMP");
  });

  it("asks when a reporting reefer has no setpoint to compare against", () => {
    const spec = reeferTwin();
    spec.objects[0]!.props = spec.objects[0]!.props.filter((p) => p.key !== "setpoint_c");
    expect(policies(spec, scenario({ signals: [sig("reefer_sensor", "temp_c", 9)] }), 10)).toEqual(["SAFETY-REEFER-SETPOINT"]);
  });

  it("surfaces telemetry that stops, without flagging reefers that never reported", () => {
    const spec = withSetpoint(4);
    const s = scenario({ durationMin: 120, signals: [sig("reefer_sensor", "temp_c", 4)] });
    expect(policies(spec, s, 60)).toEqual([]);
    expect(policies(spec, s, 70)).toEqual(["SAFETY-REEFER-TELEMETRY"]);
    const d = demoTerminal();
    const quiet = decide(TwinSpec.parse(d), scenario({ durationMin: 120 }), 120);
    expect(quiet).toEqual([]);
  });
});

describe("customs holds", () => {
  const release = sig("customs", "hold", false, 20);

  it.each([
    ["no rules, no invariants", (s: TwinSpec) => s],
    ["an invariant that never applies", (s: TwinSpec) => ({ ...s, invariants: [{ id: "INV", description: "x", appliesTo: { kind: "crane" as const, ids: [] }, when: { all: [{ of: "self", fact: "x", op: "exists" as const, value: null }], any: [] }, minLevel: "watch" as const }] })],
    ["a rule that recommends watch", (s: TwinSpec) => ({ ...s, rules: [rule({ id: "R1", when: { all: [{ of: "self", fact: "signal.customs.hold", op: "eq", value: true }], any: [] }, then: [{ type: "recommend", level: "watch", reason: "fine" }] })] })],
  ])("reach hold with %s", (_, shape) => {
    expect(of(shape(reeferTwin()), scenario({ signals: [sig("customs", "hold", true)] }), 30)?.level).toBe("hold");
  });

  it.each([["hold"], ["customs_hold"]])("reads the customs key %s", (key) => {
    expect(of(reeferTwin(), scenario({ signals: [sig("customs", key, true)] }), 10)?.level).toBe("hold");
  });

  it.each([["yes"], [1], ["true"]] as [Scalar][])("fails closed on the ambiguous value %s", (value) => {
    expect(of(reeferTwin(), scenario({ signals: [sig("customs", "hold", value)] }), 10)?.level).toBe("hold");
  });

  it("a customs release clears both a signal hold and a state hold", () => {
    expect(of(reeferTwin(), scenario({ signals: [sig("customs", "hold", true), release] }), 30)).toBeUndefined();
    expect(of(held(reeferTwin()), scenario({ signals: [release] }), 30)).toBeUndefined();
  });

  it.each([
    ["a carrier claim", { signals: [sig("carrier", "hold", false, 20)] }],
    ["a billing claim", { signals: [sig("billing", "customs_hold", false, 20)] }],
    ["a scenario state change", { stateChanges: [change("customs_hold", false, 20)] }],
  ])("%s does not release a hold", (_, events) => {
    expect(of(held(reeferTwin()), scenario(events), 30)?.level).toBe("hold");
  });

  it("a new hold after a release is honored, and on a tie the hold wins", () => {
    const again = scenario({ signals: [sig("customs", "hold", false, 10)], stateChanges: [change("customs_hold", true, 20)] });
    expect(of(reeferTwin(), again, 30)?.level).toBe("hold");
    const tied = scenario({ signals: [sig("customs", "hold", false, 20)], stateChanges: [change("customs_hold", true, 20)] });
    expect(of(reeferTwin(), tied, 30)?.level).toBe("hold");
  });

  it("removing every rule still leaves the hold in force", () => {
    const spec = TwinSpec.parse(demoTerminal());
    const s = generateScenarios(spec, DEMO_SEED).find((x) => x.id === "S2")!;
    expect(of({ ...spec, rules: [], invariants: [] }, s, 30, PROBLEM_BOX)?.level).toBe("hold");
  });
});

describe("protected facts", () => {
  const forbidden: [string, Scalar][] = [
    ["customs_hold", false],
    ["reefer", false],
    ["setpoint_c", 99],
    ["temp_c", 0],
    ["plugged", true],
    ["power_ok", true],
    ["declared_status", "full"],
    ["declared_weight_kg", 25000],
    ["measured_weight_kg", 2000],
    ["Customs_Hold", false],
  ];

  it("covers every protected fact", () => {
    expect(new Set(forbidden.map(([k]) => k.toLowerCase()))).toEqual(new Set(PROTECTED_FACTS));
  });

  it.each(forbidden)("checkTwin rejects a rule setting %s", (key, value) => {
    expect(checkTwin(reeferTwin([setRule(key, value)])).join()).toContain(`may not set safety fact "${key}"`);
  });

  it.each(forbidden)("a fix setting %s is rejected", (key, value) => {
    const spec = reeferTwin();
    const diff: RuleDiff = { rationale: "", ops: [{ op: "add", ruleId: null, rule: setRule(key, value) }] };
    expect(applyDiff(spec, diff).errors.join()).toContain("may not set safety fact");
    expect(verifyFix(spec, [scenario()], [runScenario(spec, scenario())], diff, "any").verdict).toBe("rejected");
  });

  it("rules may still raise a customs hold", () => {
    expect(checkTwin(reeferTwin([setRule("customs_hold", true)]))).toEqual([]);
  });

  it.each(forbidden)("a spec that skips validation still cannot move the policy by setting %s", (key, value) => {
    const spec = held(reeferTwin([setRule(key, value)]));
    const s = scenario({ signals: [sig("reefer_sensor", "temp_c", 12)] });
    expect(policies(spec, s, 20)).toEqual(expect.arrayContaining(["SAFETY-CUSTOMS", "SAFETY-REEFER-TEMP"]));
    expect(of(spec, s, 20)?.level).toBe("hold");
  });

  it("creator twins are outside the port policy", () => {
    const spec = TwinSpec.parse(mockCreatorTwin("door"));
    const motorRule = { ...setRule("power_ok", true), when: { all: [{ of: "self", fact: "state", op: "eq" as const, value: "open" }], any: [] } };
    expect(checkTwin({ ...spec, rules: [...spec.rules, motorRule] })).toEqual([]);
    expect(generateScenarios(spec, 1).flatMap((s) => runScenario(spec, s).ticks).every((t) => Object.keys(t.safety).length === 0)).toBe(true);
  });
});

describe("adversarial fixes", () => {
  const demo = () => TwinSpec.parse(demoTerminal());
  const setup = (spec: TwinSpec) => {
    const scenarios = generateScenarios(spec, DEMO_SEED);
    return { scenarios, results: scenarios.map((s) => runScenario(spec, s)) };
  };

  it("rejects a fix that writes a fact a custom invariant reads", () => {
    const inv = { id: "INV", description: "x", appliesTo: { kind: "container" as const, ids: [] }, when: { all: [{ of: "self", fact: "danger_class", op: "eq" as const, value: 1 }], any: [] }, minLevel: "hold" as const };
    const spec = reeferTwin([], [inv]);
    const diff: RuleDiff = { rationale: "", ops: [{ op: "add", ruleId: null, rule: setRule("danger_class", 0) }] };
    expect(applyDiff(spec, diff).errors.join()).toContain("which a safety invariant reads");
  });

  it("lets a rule keep writing an invariant fact it already wrote", () => {
    const inv = { id: "INV", description: "x", appliesTo: { kind: "container" as const, ids: [] }, when: { all: [{ of: "self", fact: "danger_class", op: "eq" as const, value: 1 }], any: [] }, minLevel: "hold" as const };
    const original = setRule("danger_class", 1);
    const spec = reeferTwin([original], [inv]);
    const diff: RuleDiff = { rationale: "", ops: [{ op: "replace", ruleId: "RX", rule: { ...original, priority: 5 } }] };
    expect(applyDiff(spec, diff).errors).toEqual([]);
  });

  it("rejects a fix whose removal leaves the rules short of a policy, with no invariant to catch it", () => {
    const spec = { ...demo(), invariants: [] };
    const { scenarios, results } = setup(spec);
    const conflict = results.flatMap((r) => r.bugs).find((b) => b.kind === "conflict")!;
    const diff: RuleDiff = { rationale: "", ops: [{ op: "remove", ruleId: "R2", rule: null }, { op: "remove", ruleId: "R4", rule: null }] };
    const v = verifyFix(spec, scenarios, results, diff, conflict.key);
    expect(v.introduced.some((b) => b.key.startsWith("policy:SAFETY-CUSTOMS"))).toBe(true);
    expect(v.verdict).toBe("rejected");
  });

  it.each(["SAFETY-CUSTOMS", "SAFETY-REEFER-TEMP", "SAFETY-DECLARED-EMPTY"] as SafetyPolicyId[])("reports %s when rules miss it, with a verified engine fix", (policyId) => {
    const spec = { ...demo(), rules: [], invariants: [] };
    const { scenarios, results } = setup(spec);
    const bug = results.flatMap((r) => r.bugs).find((b) => b.policyId === policyId)!;
    expect(bug).toMatchObject({ kind: "policy_violation", severity: "critical", key: `policy:${policyId}:${PROBLEM_BOX}` });
    const v = verifyFix(spec, scenarios, results, heuristicFix(spec, bug)!, bug.key);
    expect(v.verdict).not.toBe("rejected");
    expect(v.targetFixed).toBe(true);
  });
});

describe("provenance", () => {
  it("records source, time, and age for a signal and a setpoint", () => {
    const spec = withSetpoint(4);
    const d = of(spec, scenario({ signals: [sig("reefer_sensor", "temp_c", 9, 10)] }), 30)!;
    expect(d.evidence.safety).toEqual([
      {
        policyId: "SAFETY-REEFER-TEMP",
        minLevel: "inspect",
        description: SAFETY_POLICIES["SAFETY-REEFER-TEMP"].description,
        observations: [
          { target: BOX, fact: "signal.reefer_sensor.temp_c", value: 9, source: "reefer_sensor", t: 10, ageMin: 20 },
          { target: BOX, fact: "setpoint_c", value: 4, source: "twin_spec", t: null, ageMin: null },
        ],
      },
    ]);
  });

  it("tells a scenario observation from a twin_spec value", () => {
    const viaSpec = of(held(reeferTwin()), scenario(), 10)!.evidence.safety[0]!.observations[0]!;
    const viaWorld = of(reeferTwin(), scenario({ stateChanges: [change("customs_hold", true, 10)] }), 20)!.evidence.safety[0]!.observations[0]!;
    expect(viaSpec).toMatchObject({ source: "twin_spec", t: null });
    expect(viaWorld).toMatchObject({ source: "scenario", t: 10, ageMin: 10 });
  });

  it("names the plug behind a power finding", () => {
    const spec = TwinSpec.parse(demoTerminal());
    const plug = `PLUG-${PROBLEM_BOX}`;
    const d = of(spec, scenario({ stateChanges: [change("plugged", false, 0, plug)] }), 10, PROBLEM_BOX)!;
    expect(d.evidence.safety[0]!.observations[0]).toMatchObject({ target: plug, fact: "plugged", value: false, source: "scenario" });
  });

  it("evidence survives JSON, as the audit log and API need", () => {
    const d = of(held(reeferTwin()), scenario(), 10)!;
    expect(JSON.parse(JSON.stringify(d.evidence.safety))).toEqual(d.evidence.safety);
  });

  it("a state change does not overwrite a held world view", () => {
    const spec = held(reeferTwin());
    const world = initialWorld(spec);
    observeWorld(world, BOX, "customs_hold", false, 10);
    expect(world[BOX]?.customs_hold).toEqual({ value: true, t: null, origin: "twin_spec" });
  });
});

describe("human review", () => {
  it.each([
    ["customs", scenario({ signals: [sig("customs", "hold", true, 0, PROBLEM_BOX)] })],
    ["reefer power", scenario({ stateChanges: [change("power_ok", false, 0, `PLUG-${PROBLEM_BOX}`)] })],
  ])("an active %s policy always needs a human", (_, s) => {
    const d = of(TwinSpec.parse(demoTerminal()), s, 10, PROBLEM_BOX)!;
    expect(d.approval.required).toBe(true);
    expect(d.approval.reasons.some((r) => r.startsWith("safety policy"))).toBe(true);
  });

  it.each(["reroute", "inspect", "hold", "human"] as LadderLevel[])("%s needs a human with no policy active", (level) => {
    const spec = reeferTwin([rule({ id: "R1", when: { all: [{ of: "self", fact: "status", op: "eq", value: "full" }], any: [] }, then: [{ type: "recommend", level, reason: "x" }] })]);
    expect(of(spec, scenario(), 10)?.approval.required).toBe(true);
  });

  it("a plain low-impact action stays eligible for policy approval", () => {
    const spec = reeferTwin([rule({ id: "R1", when: { all: [{ of: "self", fact: "status", op: "eq", value: "full" }], any: [] }, then: [{ type: "recommend", level: "ask", reason: "x" }] })]);
    expect(of(spec, scenario(), 20)?.approval.required).toBe(false);
  });

  it("override options never go below an active policy", () => {
    expect(overrideOptions(of(reeferTwin(), scenario({ signals: [sig("customs", "hold", true)] }), 10)!)).toEqual([]);
    const reeferHot = of(withSetpoint(4), scenario({ signals: [sig("reefer_sensor", "temp_c", 12)] }), 10)!;
    expect(overrideOptions(reeferHot)).toEqual(["hold"]);
  });

  it("override options are unrestricted when no policy is active", () => {
    const spec = reeferTwin([rule({ id: "R1", when: { all: [{ of: "self", fact: "status", op: "eq", value: "full" }], any: [] }, then: [{ type: "recommend", level: "ask", reason: "x" }] })]);
    expect(overrideOptions(of(spec, scenario(), 10)!)).toEqual(["watch", "slow", "reroute", "inspect", "hold"]);
  });
});

describe("properties over random twins and adversarial rules", () => {
  const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
  const LEVELS: LadderLevel[] = ["watch", "ask", "slow", "reroute", "inspect", "hold", "human"];

  function randomCase(seed: number) {
    const r = rng(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
    const setpoint = pick([-25, -18, 0, 2, 4, 13]);
    const spec = withSetpoint(setpoint);
    const rules: Rule[] = [];
    const facts = [...PROTECTED_FACTS, "gate_route", "note"];
    for (let i = 0, n = Math.floor(r() * 5); i < n; i++) {
      rules.push(
        rule({
          id: `R${i + 1}`,
          priority: Math.floor(r() * 10),
          when: { all: [{ of: "self", fact: pick(["reefer", "signal.customs.hold", "signal.reefer_sensor.temp_c", "status"]), op: "exists", value: null }], any: [] },
          then: [{ type: "set", key: pick(facts), value: pick([true, false, 0, 99, "empty"]) }, { type: "recommend", level: pick(LEVELS), reason: "r" }],
        }),
      );
    }
    const hold = r() < 0.5;
    const temp = setpoint + Math.round(r() * 200) / 10 - 5;
    const s = scenario({
      signals: [...(hold ? [sig("customs", "hold", true, 10)] : []), sig("reefer_sensor", "temp_c", temp, 10), sig("carrier", "temp_ok", true, 20), sig("carrier", "hold", false, 20)],
    });
    return { spec: { ...spec, rules, invariants: [] }, s, hold, hot: temp - setpoint > SAFETY_ASSUMPTIONS.reeferExcursionC };
  }

  it.each(SEEDS)("seed %d: the floor holds, evidence is present, and a human reviews it", (seed) => {
    const { spec, s, hold, hot } = randomCase(seed);
    const d = of(spec, s, 30);
    const ids = d?.evidence.safety.map((f) => f.policyId) ?? [];
    expect(ids.includes("SAFETY-CUSTOMS")).toBe(hold);
    expect(ids.includes("SAFETY-REEFER-TEMP")).toBe(hot);
    if (hold) expect(levelIndex(d!.level)).toBeGreaterThanOrEqual(levelIndex("hold"));
    if (hot) expect(levelIndex(d!.level)).toBeGreaterThanOrEqual(levelIndex("inspect"));
    for (const f of d?.evidence.safety ?? []) expect(f.observations.length).toBeGreaterThan(0);
    if (hold || hot) expect(d!.approval.required).toBe(true);
  });

  it.each(SEEDS.slice(0, 25))("seed %d: results are byte-identical", (seed) => {
    const { spec, s } = randomCase(seed);
    expect(JSON.stringify(decide(spec, s, 30))).toBe(JSON.stringify(decide(spec, s, 30)));
  });
});
