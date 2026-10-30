import type { TwinSpec } from "@/engine/schema";

/**
 * "Ordinary Tuesday" creator mode: the same twin maker and test agent, aimed at
 * interactive objects for games and robotics instead of a port terminal.
 */
export const CREATOR_SYSTEM = `You are DockTwin's twin builder in creator mode. Turn a plain-English description of an interactive object for a game or robot into a programmable digital twin, as JSON matching the provided schema. domain must be "creator".

OBJECTS (kind -> conventional props, snake_case, include only what is stated or implied):
- door: state ("closed"|"opening"|"open"|"closing"), open_pct (0-100), max_speed
- gripper: state ("open"|"closing"|"holding"|"released"), grip_force_n, max_force_n
- motor: power_ok (bool), running (bool). attachedTo = what it drives
- sensor: one reading per sensor, e.g. motion (bool), beam_blocked (bool), force_n, slip (bool), contact (bool). attachedTo = what it watches
- button: pressed (bool)
- actor: a person, player, NPC, or object that interacts, e.g. position_m, holding (bool)
Every sensor/motor/button attaches to the object it serves.

RULES are deterministic when -> then logic interpreted by an engine (never code).
- appliesTo: {kind, ids}; ids empty means every object of that kind.
- when: {all:[...], any:[...]} of flat predicates {of, fact, op, value}. "of" is "self", "attached", or an explicit object id (use explicit ids to read a sensor from the door's rules).
- fact paths: a prop ("state"), a live reading "signal.sensor.<key>" (sensors report with source "sensor"), "signal.user.<key>" for player/operator input, or "clock.minutes".
  Conventional readings: signal.sensor.motion, signal.sensor.beam_blocked, signal.sensor.power_ok, signal.sensor.force_n, signal.sensor.slip, signal.user.command.
- ops: eq neq gt gte lt lte in exists missing. value null only for exists/missing.
- then: {type:"set",key,value} | {type:"flag",code,severity} | {type:"recommend",level,reason}.
- Ladder, gentlest first, read for a physical object: watch (nothing to do), ask (prompt the player/operator), slow (reduce speed), reroute (alternate path or behavior), inspect (self-test), hold (stop all motion now), human (hand to a person / safe shutdown).
- priority: integer, higher wins on conflicting sets.

Write 4-7 rules the way a game designer or robotics engineer would on a first pass: faithful to the description, not perfect. A stress-test agent will hunt for interaction bugs.

INVARIANTS: 2-3 safety expectations, e.g. "a blocked safety beam must stop the door (at least hold)", "loss of motor power must reach human", "grip force above max must reach hold".

Keep ids short and stable (DOOR-1, SENSOR-1, R1.., INV1..). Return JSON only.`;

/** Offline mock (MOCK_META=1): an automatic door with two classic interaction bugs. */
export function mockCreatorTwin(text: string): TwinSpec {
  void text;
  const sensorFact = (id: string, key: string, value: boolean) => ({ of: id, fact: `signal.sensor.${key}`, op: "eq" as const, value });
  return {
    name: "[MOCK] Automatic sliding door",
    domain: "creator",
    summary: "[MOCK] Sliding door with a motion sensor, a safety beam, and a motor.",
    objects: [
      {
        id: "DOOR-1",
        kind: "door",
        label: "Sliding door",
        props: [
          { key: "state", value: "closed" },
          { key: "open_pct", value: 0 },
        ],
        attachedTo: null,
      },
      { id: "SENSOR-1", kind: "sensor", label: "Motion sensor", props: [{ key: "motion", value: false }], attachedTo: "DOOR-1" },
      { id: "BEAM-1", kind: "sensor", label: "Safety beam", props: [{ key: "beam_blocked", value: false }], attachedTo: "DOOR-1" },
      { id: "MOTOR-1", kind: "motor", label: "Door motor", props: [{ key: "power_ok", value: true }], attachedTo: "DOOR-1" },
      { id: "ACTOR-1", kind: "actor", label: "Visitor", props: [{ key: "position_m", value: 4 }], attachedTo: null },
    ],
    rules: [
      {
        id: "R1",
        name: "Open on motion",
        appliesTo: { kind: "door", ids: [] },
        priority: 5,
        when: { all: [sensorFact("SENSOR-1", "motion", true)], any: [] },
        then: [
          { type: "set", key: "state", value: "open" },
          { type: "set", key: "open_pct", value: 100 },
        ],
      },
      {
        id: "R2",
        name: "Close when idle",
        appliesTo: { kind: "door", ids: [] },
        priority: 5,
        when: { all: [{ of: "self", fact: "state", op: "eq", value: "open" }, sensorFact("SENSOR-1", "motion", false)], any: [] },
        then: [
          { type: "set", key: "state", value: "closed" },
          { type: "set", key: "open_pct", value: 0 },
        ],
      },
      {
        id: "R3",
        name: "Safety beam reopens",
        appliesTo: { kind: "door", ids: [] },
        priority: 5,
        when: { all: [{ of: "self", fact: "state", op: "eq", value: "closed" }, sensorFact("BEAM-1", "beam_blocked", true)], any: [] },
        then: [
          { type: "set", key: "state", value: "open" },
          { type: "set", key: "open_pct", value: 100 },
          { type: "recommend", level: "hold", reason: "Something is in the doorway" },
        ],
      },
    ],
    invariants: [
      {
        id: "INV1",
        description: "A blocked safety beam must stop the door",
        appliesTo: { kind: "door", ids: [] },
        when: { all: [sensorFact("BEAM-1", "beam_blocked", true)], any: [] },
        minLevel: "hold",
      },
      {
        id: "INV2",
        description: "Losing motor power must hand control to a person",
        appliesTo: { kind: "door", ids: [] },
        when: { all: [sensorFact("MOTOR-1", "power_ok", false)], any: [] },
        minLevel: "human",
      },
    ],
  };
}

export const CREATOR_SAMPLES = [
  "Automatic sliding door: opens when the motion sensor sees someone, closes when there is no motion, a safety beam must stop it closing on a person, and the motor can lose power.",
  "Robot gripper: closes on an object when the contact sensor fires, holds with force under 40 N, releases on the operator's command, and must stop if the slip sensor detects the object sliding.",
];
