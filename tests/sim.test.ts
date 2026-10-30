import { describe, expect, it } from "vitest";
import { layoutTwin } from "@/engine/layout";
import { rng } from "@/engine/rng";
import { runScenario } from "@/engine/sim";
import { mockPortTwin } from "@/templates/port";
import { reeferTwin, rule, scenario } from "./fixtures";

const hold = { of: "self", fact: "signal.customs.hold", op: "eq" as const, value: true };
const hot = { of: "self", fact: "signal.reefer_sensor.temp_c", op: "gt" as const, value: 7 };

describe("runScenario", () => {
  it("applies signals at their time and records peak recommendation", () => {
    const spec = reeferTwin([
      rule({ id: "R1", when: { all: [hot], any: [] }, then: [{ type: "recommend", level: "inspect", reason: "hot" }] }),
    ]);
    const res = runScenario(
      spec,
      scenario({
        signals: [
          { t: 0, source: "reefer_sensor", target: "BOX1", key: "temp_c", value: 5 },
          { t: 20, source: "reefer_sensor", target: "BOX1", key: "temp_c", value: 9 },
          { t: 40, source: "reefer_sensor", target: "BOX1", key: "temp_c", value: 5 },
        ],
      }),
    );
    expect(res.ticks.map((t) => t.levels.BOX1 ?? "-")).toEqual(["-", "-", "inspect", "inspect", "-", "-", "-"]);
    expect(res.outcomes.BOX1).toMatchObject({ peak: "inspect", peakT: 20, level: null });
    expect(res.bugs.filter((b) => b.kind !== "dead_rule")).toEqual([]);
  });

  it("detects equal-priority conflicting writes", () => {
    const spec = reeferTwin([
      rule({ id: "R1", when: { all: [hold], any: [] }, then: [{ type: "set", key: "release", value: false }] }),
      rule({ id: "R2", when: { all: [hold], any: [] }, then: [{ type: "set", key: "release", value: true }] }),
    ]);
    const res = runScenario(spec, scenario({ signals: [{ t: 0, source: "customs", target: "BOX1", key: "hold", value: true }] }));
    const bug = res.bugs.find((b) => b.kind === "conflict");
    expect(bug).toMatchObject({ ruleIds: ["R1", "R2"], subject: "BOX1", firstT: 0, severity: "critical" });
    expect(res.finalState.BOX1?.release).toBe(false); // deterministic tie-break: lowest rule id
  });

  it("higher priority wins silently", () => {
    const spec = reeferTwin([
      rule({ id: "R1", priority: 9, when: { all: [hold], any: [] }, then: [{ type: "set", key: "release", value: false }] }),
      rule({ id: "R2", priority: 1, when: { all: [hold], any: [] }, then: [{ type: "set", key: "release", value: true }] }),
    ]);
    const res = runScenario(spec, scenario({ signals: [{ t: 0, source: "customs", target: "BOX1", key: "hold", value: true }] }));
    expect(res.bugs.some((b) => b.kind === "conflict")).toBe(false);
    expect(res.finalState.BOX1?.release).toBe(false);
  });

  it("detects oscillating rules", () => {
    const spec = reeferTwin([
      rule({
        id: "R1",
        when: { all: [{ of: "self", fact: "gate_ok", op: "eq", value: false }], any: [] },
        then: [{ type: "set", key: "gate_ok", value: true }],
      }),
      rule({
        id: "R2",
        when: { all: [{ of: "self", fact: "gate_ok", op: "eq", value: true }], any: [] },
        then: [{ type: "set", key: "gate_ok", value: false }],
      }),
    ]);
    const res = runScenario(spec, scenario({ stateChanges: [{ t: 10, target: "BOX1", key: "gate_ok", value: false }] }));
    expect(res.bugs.find((b) => b.kind === "oscillation")).toMatchObject({ ruleIds: ["R1", "R2"], firstT: 10 });
  });

  it("cascades sets to a fixpoint within one tick", () => {
    const spec = reeferTwin([
      rule({ id: "R1", when: { all: [hold], any: [] }, then: [{ type: "set", key: "customs_hold", value: true }] }),
      rule({
        id: "R2",
        when: { all: [{ of: "self", fact: "customs_hold", op: "eq", value: true }], any: [] },
        then: [{ type: "recommend", level: "hold", reason: "held" }],
      }),
    ]);
    const res = runScenario(spec, scenario({ signals: [{ t: 30, source: "customs", target: "BOX1", key: "hold", value: true }] }));
    expect(res.ticks[3]!.levels.BOX1).toBe("hold");
  });

  it("flags invariant violations when rules under-react", () => {
    const spec = reeferTwin(
      [rule({ id: "R1", when: { all: [hold], any: [] }, then: [{ type: "recommend", level: "ask", reason: "check" }] })],
      [{ id: "INV1", description: "hold must hold", appliesTo: { kind: "container", ids: [] }, when: { all: [hold], any: [] }, minLevel: "hold" }],
    );
    const res = runScenario(spec, scenario({ signals: [{ t: 20, source: "customs", target: "BOX1", key: "hold", value: true }] }));
    const bug = res.bugs.find((b) => b.kind === "invariant_violation");
    expect(bug).toMatchObject({ invariantId: "INV1", subject: "BOX1", firstT: 20, ruleIds: ["R1"] });
    expect(bug!.count).toBe(5); // t = 20..60
  });

  it("reports dead rules and facts nothing provides", () => {
    const spec = reeferTwin([
      rule({
        id: "R1",
        when: { all: [{ of: "self", fact: "temprature_c", op: "gt", value: 8 }], any: [] },
        then: [{ type: "recommend", level: "inspect", reason: "typo" }],
      }),
    ]);
    const kinds = runScenario(spec, scenario()).bugs.map((b) => b.kind);
    expect(kinds).toContain("dead_rule");
    expect(kinds).toContain("unknown_fact");
  });

  it("is deterministic", () => {
    const spec = mockPortTwin("Reefer box MSCU1234565 at Lane 4, plug at 4°C, customs hold possible.");
    const sc = scenario({
      stateChanges: [{ t: 10, target: "LANE-4", key: "status", value: "down" }],
      signals: [
        { t: 0, source: "customs", target: "MSCU1234565", key: "hold", value: true },
        { t: 20, source: "reefer_sensor", target: "MSCU1234565", key: "temp_c", value: 9 },
      ],
    });
    expect(JSON.stringify(runScenario(spec, sc))).toBe(JSON.stringify(runScenario(spec, sc)));
  });
});

describe("rng", () => {
  it("is seeded and repeatable", () => {
    const a = rng(42);
    const b = rng(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(rng(43)()).not.toBe(xs[0]);
  });
});

describe("layoutTwin", () => {
  it("places every object exactly once, deterministically, with no overlapping containers", () => {
    const spec = mockPortTwin("Reefer box MSCU1234565 at Lane 4");
    for (let i = 0; i < 130; i++) {
      spec.objects.push({ id: `YARD${i}`, kind: "container", label: "", props: [], attachedTo: null });
    }
    const a = layoutTwin(spec);
    expect(a.map((p) => p.id).sort()).toEqual(spec.objects.map((o) => o.id).sort());
    expect(JSON.stringify(layoutTwin(spec))).toBe(JSON.stringify(a));
    const boxes = a.filter((p) => p.kind === "container");
    const overlap = (p: (typeof boxes)[0], q: (typeof boxes)[0]) =>
      [0, 1, 2].every((k) => Math.abs(p.pos[k]! - q.pos[k]!) < (p.size[k]! + q.size[k]!) / 2 - 0.01);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false);
  });
});
