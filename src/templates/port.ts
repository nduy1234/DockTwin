import type { TwinSpec } from "@/engine/schema";

export const PORT_SYSTEM = `You are DockTwin's twin builder. Turn a terminal planner's plain-English description into a programmable digital twin of a port terminal, as JSON matching the provided schema.

OBJECTS (kind -> conventional props, snake_case, include only what is stated or clearly implied):
- container: status ("empty"|"full"), declared_weight_kg, measured_weight_kg, reefer (bool), setpoint_c, temp_c, customs_hold (bool), free_minutes_left, lane (number)
- reefer_plug: plugged (bool), power_ok (bool). attachedTo = the container it powers
- gate_lane: status ("up"|"down"), trucks_per_hour
- crane: status ("up"|"down"), moves_per_hour
- scale: status ("up"|"down"), tolerance_pct
- yard_block: capacity, used
Use real ids when given (container codes like MSCU1234565, "LANE-4"). Containers at a lane set attachedTo to that lane id. Create the lane/plug/scale objects a description implies even if not named.

RULES are deterministic when -> then logic interpreted by an engine (never code).
- appliesTo: {kind, ids}; ids empty means every object of that kind.
- when: {all:[...], any:[...]} of flat predicates {of, fact, op, value}. "of" is "self", "attached", or an object id.
- fact paths: a prop name ("temp_c"), a raw external signal "signal.<source>.<key>", or "clock.minutes".
  Signal sources: carrier, scale, customs, reefer_sensor, gate_ops, billing, sensor, user.
  Typical signals: signal.carrier.declared_status, signal.scale.weight_kg, signal.customs.hold, signal.reefer_sensor.temp_c, signal.gate_ops.lane_status, signal.billing.free_minutes_left.
- ops: eq neq gt gte lt lte in exists missing. value is null only for exists/missing; "in" takes a string array.
- then: actions {type:"set",key,value} | {type:"flag",code,severity} | {type:"recommend",level,reason}.
- Recommendation ladder, gentlest first: watch, ask, slow, reroute, inspect, hold, human. Pick the gentlest level that is effective.
- priority: integer, higher wins on conflicting sets.

Write 4-8 rules a careful terminal planner would actually use for the described situation (temperature excursions, weight mismatches between carrier and scale, customs holds, lane outages, free-time running out). Write them faithfully to the description; do not try to make them perfect - a separate stress-test agent will hunt for bugs.

INVARIANTS are safety expectations the stress-tester checks: when "when" holds, the rules must have produced at least minLevel. Write 2-4, e.g. a customs hold must reach at least "hold"; a reefer more than 3 C above setpoint must reach at least "inspect".

Keep ids short and stable (R1.., INV1..). Return JSON only.`;

/** Offline mock (MOCK_META=1, local dev only). Deterministic from the text. */
export function mockPortTwin(text: string): TwinSpec {
  const code = text.match(/\b[A-Z]{4}\d{6,7}\b/)?.[0] ?? "MSCU1234565";
  const lane = Number(text.match(/lane\s*(\d+)/i)?.[1] ?? 4);
  const setpoint = Number(text.match(/(-?\d+(?:\.\d+)?)\s*°?\s*C\b/i)?.[1] ?? 4);
  const laneId = `LANE-${lane}`;
  const reefer = /reefer/i.test(text);
  return {
    name: `[MOCK] ${code} at ${laneId}`,
    domain: "port",
    summary: `[MOCK] Reefer ${code} at ${laneId}, setpoint ${setpoint}°C, possible customs hold.`,
    objects: [
      {
        id: code,
        kind: "container",
        label: `${code} (reefer)`,
        props: [
          { key: "status", value: "full" },
          { key: "reefer", value: reefer },
          { key: "setpoint_c", value: setpoint },
          { key: "temp_c", value: setpoint },
          { key: "customs_hold", value: false },
          { key: "lane", value: lane },
        ],
        attachedTo: laneId,
      },
      {
        id: `PLUG-${code}`,
        kind: "reefer_plug",
        label: "Reefer plug",
        props: [
          { key: "plugged", value: true },
          { key: "power_ok", value: true },
        ],
        attachedTo: code,
      },
      { id: laneId, kind: "gate_lane", label: `Gate lane ${lane}`, props: [{ key: "status", value: "up" }], attachedTo: null },
      { id: "SCALE-1", kind: "scale", label: "Gate scale", props: [{ key: "status", value: "up" }], attachedTo: laneId },
    ],
    rules: [
      {
        id: "R1",
        name: "Reefer temp drift",
        appliesTo: { kind: "container", ids: [] },
        priority: 5,
        when: {
          all: [
            { of: "self", fact: "reefer", op: "eq", value: true },
            { of: "self", fact: "signal.reefer_sensor.temp_c", op: "gt", value: setpoint + 2 },
          ],
          any: [],
        },
        then: [{ type: "recommend", level: "inspect", reason: "Reefer temperature above setpoint +2°C" }],
      },
      {
        id: "R2",
        name: "Customs hold",
        appliesTo: { kind: "container", ids: [] },
        priority: 9,
        when: { all: [{ of: "self", fact: "signal.customs.hold", op: "eq", value: true }], any: [] },
        then: [
          { type: "set", key: "customs_hold", value: true },
          { type: "recommend", level: "hold", reason: "Customs placed a hold" },
        ],
      },
      {
        id: "R3",
        name: "Lane down: reroute",
        appliesTo: { kind: "container", ids: [] },
        priority: 3,
        when: { all: [{ of: "attached", fact: "status", op: "eq", value: "down" }], any: [] },
        then: [{ type: "recommend", level: "reroute", reason: "Assigned gate lane is down" }],
      },
    ],
    invariants: [
      {
        id: "INV1",
        description: "A customs hold must reach at least hold",
        appliesTo: { kind: "container", ids: [] },
        when: { all: [{ of: "self", fact: "signal.customs.hold", op: "eq", value: true }], any: [] },
        minLevel: "hold",
      },
    ],
  };
}
