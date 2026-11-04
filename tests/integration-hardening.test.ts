// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { POST as fixRoute } from "@/app/api/fix/route";
import { POST as stressRoute } from "@/app/api/stress/route";
import { DecisionPanel } from "@/components/DecisionPanel";
import { decideAt, displayLevels } from "@/engine/decide";
import { DEMO_SEED, demoTerminal, PROBLEM_BOX } from "@/engine/demo";
import { generateScenarios } from "@/engine/scenarios";
import { checkTwin, TwinSpec, type Rule, type Scenario } from "@/engine/schema";
import { runScenario, type Bug, type SimResult } from "@/engine/sim";
import { topBugs } from "@/engine/verify";
import { mockCreatorTwin } from "@/templates/creator";
import { reeferTwin, scenario } from "./fixtures";

vi.mock("server-only", () => ({}));

const post = (body: unknown) => new Request("http://test/api", { method: "POST", body: JSON.stringify(body) });
const demo = () => TwinSpec.parse(demoTerminal());
const creator = () => TwinSpec.parse(mockCreatorTwin("door"));
const stress = async (spec: TwinSpec) => {
  const res = await stressRoute(post({ spec }));
  return { status: res.status, json: await res.json() };
};
const door = (extra: Partial<Rule>): Rule => ({
  id: "RX",
  name: "x",
  appliesTo: { kind: "door", ids: [] },
  priority: 1,
  when: { all: [{ of: "self", fact: "state", op: "eq", value: "open" }], any: [] },
  then: [{ type: "flag", code: "x", severity: "info" }],
  ...extra,
});

const relabelled: [string, () => TwinSpec][] = [
  ["the whole demo terminal", () => ({ ...demo(), domain: "creator" })],
  ...(["container", "reefer_plug", "gate_lane", "crane", "scale", "yard_block"] as const).map((kind): [string, () => TwinSpec] => [
    `a ${kind} object`,
    () => {
      const s = creator();
      s.objects.push({ id: "X1", kind, label: "", props: [], attachedTo: null });
      return s;
    },
  ]),
  ...["customs_hold", "reefer", "setpoint_c", "declared_status", "declared_weight_kg", "measured_weight_kg", "Customs_Hold"].map((key): [string, () => TwinSpec] => [
    `a door with fact ${key}`,
    () => {
      const s = creator();
      s.objects[0]!.props.push({ key, value: true });
      return s;
    },
  ]),
  ...["customs", "carrier", "scale", "reefer_sensor", "gate_ops", "billing"].map((source): [string, () => TwinSpec] => [
    `a rule reading signal.${source}`,
    () => {
      const s = creator();
      s.rules.push(door({ when: { all: [{ of: "self", fact: `signal.${source}.x`, op: "exists", value: null }], any: [] } }));
      return s;
    },
  ]),
  [
    "an invariant reading customs_hold",
    () => {
      const s = creator();
      s.invariants[0]!.when.all.push({ of: "self", fact: "customs_hold", op: "eq", value: true });
      return s;
    },
  ],
  [
    "a rule writing customs_hold",
    () => {
      const s = creator();
      s.rules.push(door({ then: [{ type: "set", key: "customs_hold", value: false }] }));
      return s;
    },
  ],
];

describe("server trust boundary", () => {
  beforeAll(() => {
    process.env.MOCK_META = "1";
  });

  it.each(relabelled)("checkTwin rejects a creator twin containing %s", (_, build) => {
    expect(checkTwin(build()).join()).toContain("creator twin contains port content");
  });

  it.each(relabelled)("/api/stress refuses a creator twin containing %s", async (_, build) => {
    const { status, json } = await stress(build());
    expect(status).toBe(400);
    expect(json.error).toContain("port content");
  });

  it("/api/fix refuses a relabelled twin", async () => {
    const spec = { ...demo(), domain: "creator" as const };
    const scenarios = generateScenarios(demo(), DEMO_SEED).map((s) => ({ ...s }));
    const res = await fixRoute(post({ spec, scenarios, bugKey: "anything" }));
    expect(res.status).toBe(400);
  });

  it("the engine applies the policy to port objects even if validation is skipped", () => {
    const spec = { ...reeferTwin(), domain: "creator" as const };
    const s = scenario({ signals: [{ t: 0, source: "customs", target: "BOX1", key: "hold", value: true }] });
    const r = runScenario(spec, s);
    expect(decideAt(spec, s, r, 1).find((d) => d.subject === "BOX1")?.level).toBe("hold");
  });

  it("a port twin keeps its fact protection when labelled creator", () => {
    const spec = { ...reeferTwin([{ ...door({}), appliesTo: { kind: "container", ids: [] }, then: [{ type: "set", key: "reefer", value: false }] }]), domain: "creator" as const };
    expect(checkTwin(spec).join()).toContain('may not set safety fact "reefer"');
  });

  it("creator mode keeps working, including power_ok and temp_c rules", async () => {
    const spec = creator();
    spec.objects[0]!.props.push({ key: "temp_c", value: 21 });
    spec.rules.push(door({ then: [{ type: "set", key: "power_ok", value: true }] }));
    expect(checkTwin(spec)).toEqual([]);
    const { status, json } = await stress(spec);
    expect(status).toBe(200);
    expect(json.scenarios.map((s: Scenario) => s.id)).toEqual(["C1", "C2", "C3", "C4", "C5"]);
    const fix = await fixRoute(post({ spec, scenarios: json.scenarios, bugKey: json.bugs[0].key }));
    expect(fix.status).toBe(200);
  });

  it("keeps the /api/stress response contract", async () => {
    const { status, json } = await stress(demo());
    expect(status).toBe(200);
    expect(Object.keys(json).sort()).toEqual(["agentError", "bugs", "calls", "results", "scenarios", "seed"]);
    expect(Object.keys(json.results[0]).sort()).toEqual(["bugs", "finalState", "firedRules", "outcomes", "scenarioId", "ticks"]);
  });
});

describe("displayLevels", () => {
  const at = (spec: TwinSpec, s: Scenario, t: number) => {
    const r = runScenario(spec, s);
    const i = r.ticks.findIndex((x) => x.t === t);
    return { tick: r.ticks[i]!, decisions: decideAt(spec, s, r, i) };
  };

  it("shows a policy-only hold that no rule recommended", () => {
    const spec = reeferTwin();
    const { tick, decisions } = at(spec, scenario({ signals: [{ t: 0, source: "customs", target: "BOX1", key: "hold", value: true }] }), 10);
    expect(tick.levels.BOX1).toBeUndefined();
    expect(displayLevels(spec, tick, decisions).BOX1).toBe("hold");
  });

  it("shows the demo reefer rising at S3@40, before any fix", () => {
    const spec = demo();
    const s = generateScenarios(spec, DEMO_SEED).find((x) => x.id === "S3")!;
    const { tick, decisions } = at(spec, s, 40);
    expect(tick.levels[PROBLEM_BOX]).toBeUndefined();
    expect(displayLevels(spec, tick, decisions)[PROBLEM_BOX]).toBe("inspect");
  });

  it("matches the decision for every subject across every demo scenario and tick", () => {
    const spec = demo();
    for (const s of generateScenarios(spec, DEMO_SEED)) {
      const r = runScenario(spec, s);
      r.ticks.forEach((tick, i) => {
        const decisions = decideAt(spec, s, r, i);
        const levels = displayLevels(spec, tick, decisions);
        for (const d of decisions) expect(levels[d.subject]).toBe(d.level);
        expect(Object.keys(levels).sort()).toEqual(decisions.map((d) => d.subject).sort());
      });
    }
  });

  it("leaves creator visuals on raw rule levels", () => {
    const spec = creator();
    const s = generateScenarios(spec, 1)[0]!;
    const r = runScenario(spec, s);
    const tick = r.ticks[0]!;
    expect(displayLevels(spec, tick, decideAt(spec, s, r, 0))).toEqual(tick.levels);
  });
});

describe("decision panel", () => {
  const render = (spec: TwinSpec, s: Scenario, t: number) => {
    const r = runScenario(spec, s);
    const decisions = decideAt(spec, s, r, r.ticks.findIndex((x) => x.t === t));
    return renderToStaticMarkup(createElement(DecisionPanel, { decisions, rulings: {}, explanations: {}, onRule() {}, onExplain() {}, onAutoApprove() {}, onSelect() {} }));
  };
  const heldBox = scenario({ signals: [{ t: 0, source: "customs", target: "BOX1", key: "hold", value: true }] });

  it("replaces an empty override menu with an explanation and keeps escalation", () => {
    const html = render(reeferTwin(), heldBox, 10);
    expect(html).not.toContain("Override action");
    expect(html).toContain("Safety policy sets the minimum at hold");
    expect(html).toContain("Hand to supervisor");
    expect(html).toContain("Approve hold");
  });

  it("offers only levels at or above the policy minimum", () => {
    const html = render(reeferTwin(), scenario({ signals: [{ t: 0, source: "reefer_sensor", target: "BOX1", key: "temp_c", value: 12 }] }), 10);
    expect(html).toContain("Override action");
    expect(html).toContain('<option value="hold">');
    for (const level of ["watch", "ask", "slow", "reroute"]) expect(html).not.toContain(`<option value="${level}">`);
  });

  it("shows approval, policy evidence, and that it is advisory", () => {
    const html = render(reeferTwin(), heldBox, 10);
    expect(html).toContain("NEEDS HUMAN APPROVAL");
    expect(html).toContain("safety policy SAFETY-CUSTOMS is active");
    expect(html).toContain("advisory, prototype threshold");
    expect(html).toContain("customs BOX1.signal.customs.hold=true at t=0m");
  });
});

describe("root-cause grouping with safety policies", () => {
  const policyBug = (policyId: string, subject: string): Bug => ({
    kind: "policy_violation",
    severity: "critical",
    message: `${policyId} not met for ${subject}`,
    ruleIds: [],
    subject,
    policyId,
    firstT: 10,
    count: 1,
    key: `policy:${policyId}:${subject}`,
  });
  const result = (bugs: Bug[]) => ({ scenarioId: "S1", bugs }) as unknown as SimResult;

  it("keeps different policies as separate root causes", () => {
    const bugs = topBugs([result([policyBug("SAFETY-CUSTOMS", "BOX1"), policyBug("SAFETY-REEFER-TEMP", "BOX2")])]);
    expect(bugs.map((b) => b.policyId)).toEqual(["SAFETY-CUSTOMS", "SAFETY-REEFER-TEMP"]);
  });

  it("still groups one policy across boxes", () => {
    const bugs = topBugs([result([policyBug("SAFETY-CUSTOMS", "BOX1"), policyBug("SAFETY-CUSTOMS", "BOX2")])]);
    expect(bugs).toHaveLength(1);
    expect(bugs[0]!.alsoAffects).toEqual(["BOX2"]);
  });
});
