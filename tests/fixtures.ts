import type { Rule, Scenario, TwinSpec } from "@/engine/schema";

export function reeferTwin(rules: Rule[] = [], invariants: TwinSpec["invariants"] = []): TwinSpec {
  return {
    name: "test",
    domain: "port",
    summary: "test twin",
    objects: [
      {
        id: "BOX1",
        kind: "container",
        label: "Box 1",
        props: [
          { key: "reefer", value: true },
          { key: "setpoint_c", value: 4 },
          { key: "status", value: "full" },
        ],
        attachedTo: "LANE-4",
      },
      { id: "BOX2", kind: "container", label: "Box 2", props: [{ key: "reefer", value: false }], attachedTo: null },
      { id: "LANE-4", kind: "gate_lane", label: "Lane 4", props: [{ key: "status", value: "up" }], attachedTo: null },
    ],
    rules,
    invariants,
  };
}

export const rule = (r: Partial<Rule> & Pick<Rule, "id" | "when" | "then">): Rule => ({
  name: r.id,
  appliesTo: { kind: "container", ids: [] },
  priority: 1,
  ...r,
});

export const scenario = (s: Partial<Scenario> = {}): Scenario => ({
  id: "S1",
  name: "test",
  description: "",
  durationMin: 60,
  tickMin: 10,
  stateChanges: [],
  signals: [],
  ...s,
});
