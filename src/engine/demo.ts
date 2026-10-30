/**
 * Demo mode: a seeded, Long Beach-style terminal under a fictional name.
 * 100 containers, 4 gate lanes, 2 scales, 3 cranes, reefer plugs, and one
 * problem box. Rules are a planner's realistic first draft (with the bugs a
 * first draft has). Fully deterministic: same seed -> identical terminal.
 */
import { rng } from "./rng";
import type { TwinObject, TwinSpec } from "./schema";
import { mockPortTwin } from "@/templates/port";

export const DEMO_SEED = 20261104;
export const DEMO_TERMINAL = "Pacific Gate Container Terminal";
export const PROBLEM_BOX = "MSCU7154023";
export const DEMO_DESCRIPTION = `${DEMO_TERMINAL} (fictional), 06:00 Tuesday. 100 boxes in the yard and at the gate. Reefer ${PROBLEM_BOX} at Lane 3, plug at 4°C, customs hold possible, free time running out.`;

const PREFIXES = ["MAEU", "CMAU", "HLXU", "OOLU", "EGHU", "TGHU", "CSNU", "MSCU"];

export function demoTerminal(seed = DEMO_SEED): TwinSpec {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const objects: TwinObject[] = [];

  for (let i = 1; i <= 4; i++) {
    objects.push({ id: `LANE-${i}`, kind: "gate_lane", label: `Gate lane ${i}`, props: [{ key: "status", value: "up" }, { key: "trucks_per_hour", value: 40 }], attachedTo: null });
  }
  objects.push(
    { id: "SCALE-1", kind: "scale", label: "Gate scale A", props: [{ key: "status", value: "up" }, { key: "tolerance_pct", value: 2 }], attachedTo: "LANE-2" },
    { id: "SCALE-2", kind: "scale", label: "Gate scale B", props: [{ key: "status", value: "up" }, { key: "tolerance_pct", value: 2 }], attachedTo: "LANE-3" },
  );
  for (let i = 1; i <= 3; i++) {
    objects.push({ id: `STS-${i}`, kind: "crane", label: `Ship-to-shore crane ${i}`, props: [{ key: "status", value: "up" }, { key: "moves_per_hour", value: 28 }], attachedTo: null });
  }
  objects.push({ id: "BLOCK-A", kind: "yard_block", label: "Yard block A", props: [{ key: "capacity", value: 120 }, { key: "used", value: 97 }], attachedTo: null });

  const box = (id: string, attachedTo: string | null, reefer: boolean, extra: TwinObject["props"] = []): TwinObject => {
    const full = r() < 0.7;
    const props: TwinObject["props"] = [
      { key: "status", value: full ? "full" : "empty" },
      { key: "declared_weight_kg", value: full ? 8000 + Math.round(r() * 20000) : 2300 },
      { key: "reefer", value: reefer },
      { key: "customs_hold", value: false },
      { key: "free_minutes_left", value: 240 + Math.round(r() * 2600) },
      ...(reefer ? [{ key: "setpoint_c", value: pick([-18, 2, 4, 13]) }] : []),
      ...extra,
    ];
    return { id, kind: "container", label: reefer ? `${id} (reefer)` : id, props, attachedTo };
  };

  // The problem box: reefer at Lane 3, at the scale, free time nearly gone.
  const problem: TwinObject = {
    id: PROBLEM_BOX,
    kind: "container",
    label: `${PROBLEM_BOX} (reefer, problem box)`,
    props: [
      { key: "status", value: "full" },
      { key: "declared_weight_kg", value: 21500 },
      { key: "reefer", value: true },
      { key: "setpoint_c", value: 4 },
      { key: "temp_c", value: 4 },
      { key: "customs_hold", value: false },
      { key: "free_minutes_left", value: 75 },
      { key: "cargo_value_usd", value: 85_000 },
      { key: "lane", value: 3 },
    ],
    attachedTo: "LANE-3",
  };
  objects.push(problem, { id: `PLUG-${PROBLEM_BOX}`, kind: "reefer_plug", label: "Reefer plug", props: [{ key: "plugged", value: true }, { key: "power_ok", value: true }], attachedTo: PROBLEM_BOX });

  const used = new Set([PROBLEM_BOX]);
  const code = () => {
    for (;;) {
      const id = `${pick(PREFIXES)}${String(Math.floor(r() * 1e7)).padStart(7, "0")}`;
      if (!used.has(id)) return used.add(id), id;
    }
  };
  // Two more trucks at the gate, then 97 boxes in the yard (~10% reefers).
  objects.push(box(code(), "LANE-1", false), box(code(), "LANE-2", false));
  for (let i = 0; i < 97; i++) {
    const reefer = r() < 0.1;
    const b = box(code(), null, reefer);
    objects.push(b);
    if (reefer) objects.push({ id: `PLUG-${b.id}`, kind: "reefer_plug", label: "Reefer plug", props: [{ key: "plugged", value: true }, { key: "power_ok", value: true }], attachedTo: b.id });
  }

  // A planner's first-draft rules (shared with the port mock) plus a free-time rule.
  const draft = mockPortTwin(`Reefer ${PROBLEM_BOX} at Lane 3, plug at 4°C`);
  return {
    name: `${DEMO_TERMINAL} (fictional)`,
    domain: "port",
    summary: `Demo: ${objects.filter((o) => o.kind === "container").length} boxes, 4 gate lanes, 3 cranes; problem box ${PROBLEM_BOX} at Lane 3.`,
    objects,
    rules: [
      ...draft.rules,
      {
        id: "R6",
        name: "Free time expiring: ask for pickup",
        appliesTo: { kind: "container", ids: [] },
        priority: 2,
        when: { all: [{ of: "self", fact: "signal.billing.free_minutes_left", op: "lt", value: 60 }], any: [] },
        then: [{ type: "recommend", level: "ask", reason: "Free time almost gone; ask the trucker to book pickup" }],
      },
    ],
    invariants: draft.invariants,
  };
}
