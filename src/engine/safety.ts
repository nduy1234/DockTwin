/**
 * Port-domain safety policy. Independent of TwinSpec rules and invariants: it
 * is evaluated even for a twin with neither, and it reads a WorldView that rule
 * `set` actions never reach, so rewriting a fact cannot switch it off.
 *
 * It only sets advisory floors. Every finding asks for human review; nothing
 * here acts on a box.
 */
import type { SignalStore } from "./dsl";
import type { Condition, LadderLevel, Rule, Scalar, SignalSource, TwinSpec } from "./schema";

/**
 * Prototype assumptions, not validated operational standards. A terminal would
 * replace them with its own procedures. Deliberately not readable from a
 * TwinSpec, so model output cannot loosen them.
 */
export const SAFETY_ASSUMPTIONS = {
  reeferExcursionC: 3, // degrees above the box's own setpoint
  reeferTelemetryStaleMin: 60, // silence after a reading before it is surfaced
  emptyMaxKg: 5000, // heavier than this is not credibly an empty box
};
export type SafetyAssumptions = typeof SAFETY_ASSUMPTIONS;

export const SAFETY_POLICIES = {
  "SAFETY-CUSTOMS": { minLevel: "hold", description: "A customs hold stays in force until customs releases it" },
  "SAFETY-REEFER-TEMP": { minLevel: "inspect", description: "A reefer above its own setpoint by more than the excursion limit needs inspection" },
  "SAFETY-REEFER-SETPOINT": { minLevel: "ask", description: "A reefer reporting temperature has no setpoint to compare against" },
  "SAFETY-REEFER-POWER": { minLevel: "ask", description: "A reefer's plug is disconnected or has lost power" },
  "SAFETY-REEFER-TELEMETRY": { minLevel: "ask", description: "A reefer's temperature readings have gone quiet" },
  "SAFETY-DECLARED-EMPTY": { minLevel: "inspect", description: "A box declared empty weighs too much to be empty" },
} as const satisfies Record<string, { minLevel: LadderLevel; description: string }>;
export type SafetyPolicyId = keyof typeof SAFETY_POLICIES;

/** Where a safety input came from, so a floor can always be traced to its evidence. */
export type SafetyObservation = {
  target: string;
  fact: string;
  value: Scalar;
  /** "scenario" = ground-truth change; "twin_spec" = initial value written in the twin. */
  source: SignalSource | "scenario" | "twin_spec";
  /** Null for a twin_spec value, which has no observation time. */
  t: number | null;
  ageMin: number | null;
};

export type SafetyFinding = {
  policyId: SafetyPolicyId;
  minLevel: LadderLevel;
  description: string;
  observations: SafetyObservation[];
};

type Observed = { value: Scalar; t: number | null; origin: "twin_spec" | "scenario" };
/** Object facts as observed from the twin's initial values and the scenario. Rules never write here. */
export type WorldView = Record<string, Record<string, Observed>>;

export function initialWorld(spec: TwinSpec): WorldView {
  const world: WorldView = {};
  for (const o of spec.objects) {
    world[o.id] = Object.fromEntries(o.props.map((p) => [p.key, { value: p.value, t: null, origin: "twin_spec" as const }]));
  }
  return world;
}

const isHeld = (v: Scalar) => v !== false; // fail closed: only an explicit false means "no hold"

export function observeWorld(world: WorldView, target: string, key: string, value: Scalar, t: number) {
  const slot = (world[target] ??= {});
  // A state change is not a customs release; only a customs signal is.
  if (key === "customs_hold" && !isHeld(value) && slot[key] && isHeld(slot[key].value)) return;
  slot[key] = { value, t, origin: "scenario" };
}

/** Rules may raise a customs hold but never write any other safety input. */
export const PROTECTED_FACTS = [
  "customs_hold",
  "reefer",
  "setpoint_c",
  "temp_c",
  "plugged",
  "power_ok",
  "declared_status",
  "declared_weight_kg",
  "measured_weight_kg",
];

export const PORT_KINDS = ["container", "reefer_plug", "gate_lane", "crane", "scale", "yard_block"] as const;

/** Facts and signal sources that only mean something at a port. Shared words like power_ok and temp_c are not here. */
const PORT_FACTS = ["customs_hold", "reefer", "setpoint_c", "declared_status", "declared_weight_kg", "measured_weight_kg"];
const PORT_SOURCES = ["customs", "carrier", "scale", "reefer_sensor", "gate_ops", "billing"];

const isPortFact = (fact: string) => {
  const f = fact.toLowerCase();
  return PORT_FACTS.includes(f) || PORT_SOURCES.includes(f.split(".")[1] ?? "");
};

/** What in this twin is port-specific, whatever its domain label says. */
export function portContent(spec: TwinSpec): string[] {
  const conditions = [...spec.rules, ...spec.invariants].flatMap((r) => [...r.when.all, ...r.when.any]);
  return [
    ...spec.objects.filter((o) => (PORT_KINDS as readonly string[]).includes(o.kind)).map((o) => `object "${o.id}" of kind ${o.kind}`),
    ...spec.objects.flatMap((o) => o.props.filter((p) => isPortFact(p.key)).map((p) => `fact "${p.key}" on "${o.id}"`)),
    ...conditions.filter((p) => isPortFact(p.fact)).map((p) => `condition on "${p.fact}"`),
    ...spec.rules.flatMap((r) => r.then.flatMap((a) => (a.type === "set" && isPortFact(a.key) ? [`rule ${r.id} writing "${a.key}"`] : []))),
  ];
}

/** The domain label comes from the client, so port content is what decides. */
export const isPortGoverned = (spec: TwinSpec) => spec.domain === "port" || portContent(spec).length > 0;

/** Returned strings are fed back to the model verbatim during schema repair. */
export function checkProtectedFacts(spec: TwinSpec): string[] {
  if (!isPortGoverned(spec)) return [];
  const issues: string[] = [];
  if (spec.domain !== "port") issues.push(`creator twin contains port content (${portContent(spec).slice(0, 5).join("; ")}); use domain "port" or remove it`);
  for (const r of spec.rules) {
    for (const a of r.then) {
      if (a.type !== "set" || !PROTECTED_FACTS.includes(a.key.toLowerCase())) continue;
      if (a.key.toLowerCase() === "customs_hold" && a.value === true) continue;
      issues.push(`rule ${r.id} may not set safety fact "${a.key}"; it comes only from observations`);
    }
  }
  return issues;
}

const fromSignal = (signals: SignalStore, target: string, source: SignalSource, key: string, t: number): SafetyObservation | null => {
  const s = signals[target]?.[`${source}.${key}`];
  return s ? { target, fact: `signal.${source}.${key}`, value: s.value, source, t: s.t, ageMin: t - s.t } : null;
};

const fromWorld = (world: WorldView, target: string, key: string, t: number): SafetyObservation | null => {
  const o = world[target]?.[key];
  if (!o) return null;
  return { target, fact: key, value: o.value, source: o.origin, t: o.t, ageMin: o.t === null ? null : t - o.t };
};

const present = (xs: (SafetyObservation | null)[]) => xs.filter((x): x is SafetyObservation => x !== null);
const when = (o: SafetyObservation) => o.t ?? -1;
const numeric = (o: SafetyObservation): o is SafetyObservation & { value: number } => typeof o.value === "number" && Number.isFinite(o.value);

/** Newest observation; on a tie the numerically highest, which is the cautious reading. */
const freshest = <T extends SafetyObservation>(xs: T[]): T | undefined =>
  [...xs].sort((a, b) => when(b) - when(a) || Number(b.value) - Number(a.value))[0];

const finding = (policyId: SafetyPolicyId, observations: SafetyObservation[]): SafetyFinding => ({
  policyId,
  minLevel: SAFETY_POLICIES[policyId].minLevel,
  description: SAFETY_POLICIES[policyId].description,
  observations,
});

function customsFinding(world: WorldView, signals: SignalStore, id: string, t: number): SafetyFinding | null {
  const claims = present([fromSignal(signals, id, "customs", "hold", t), fromSignal(signals, id, "customs", "customs_hold", t)]);
  const latest = [...claims].sort((a, b) => when(b) - when(a) || Number(isHeld(b.value)) - Number(isHeld(a.value)))[0];
  const state = fromWorld(world, id, "customs_hold", t);
  const stateHeld = state && isHeld(state.value) && !(latest && !isHeld(latest.value) && when(latest) > when(state));
  const evidence = present([latest && isHeld(latest.value) ? latest : null, stateHeld ? state : null]);
  return evidence.length ? finding("SAFETY-CUSTOMS", evidence) : null;
}

function reeferFindings(spec: TwinSpec, world: WorldView, signals: SignalStore, id: string, t: number, a: SafetyAssumptions): SafetyFinding[] {
  const measured = [
    fromSignal(signals, id, "reefer_sensor", "temp_c", t),
    fromSignal(signals, id, "sensor", "temp_c", t),
    fromWorld(world, id, "temp_c", t),
  ];
  const readings = present(measured).filter(numeric);
  const setpoint = fromWorld(world, id, "setpoint_c", t);
  const declared = world[id]?.reefer?.value;
  const reefer = declared === true || (setpoint !== null && numeric(setpoint)) || (declared === undefined && readings.some((r) => r.t !== null));
  if (!reefer) return [];

  const out: SafetyFinding[] = [];
  const latest = freshest(readings);
  if (setpoint && numeric(setpoint)) {
    if (latest && latest.value - setpoint.value > a.reeferExcursionC) out.push(finding("SAFETY-REEFER-TEMP", [latest, setpoint]));
  } else if (latest) {
    out.push(finding("SAFETY-REEFER-SETPOINT", [latest]));
  }

  const live = readings.filter((r) => r.t !== null);
  const newest = freshest(live);
  if (newest && newest.ageMin! > a.reeferTelemetryStaleMin) out.push(finding("SAFETY-REEFER-TELEMETRY", [newest]));

  for (const plug of spec.objects.filter((o) => o.kind === "reefer_plug" && o.attachedTo === id)) {
    const down = present([fromWorld(world, plug.id, "plugged", t), fromWorld(world, plug.id, "power_ok", t)]).filter((o) => o.value === false);
    if (down.length) out.push(finding("SAFETY-REEFER-POWER", down));
  }
  return out;
}

function declaredEmptyFinding(world: WorldView, signals: SignalStore, id: string, t: number, a: SafetyAssumptions): SafetyFinding | null {
  const declared = freshest(present([fromSignal(signals, id, "carrier", "declared_status", t), fromWorld(world, id, "status", t)]));
  const weight = freshest(present([fromSignal(signals, id, "scale", "weight_kg", t), fromWorld(world, id, "measured_weight_kg", t)]).filter(numeric));
  return declared?.value === "empty" && weight && weight.value > a.emptyMaxKg ? finding("SAFETY-DECLARED-EMPTY", [declared, weight]) : null;
}

/** Active findings per container. Pure: same world + signals + t, same findings. */
export function evaluatePortSafety(
  spec: TwinSpec,
  world: WorldView,
  signals: SignalStore,
  t: number,
  assumptions: SafetyAssumptions = SAFETY_ASSUMPTIONS,
): Record<string, SafetyFinding[]> {
  const out: Record<string, SafetyFinding[]> = {};
  if (!isPortGoverned(spec)) return out;
  for (const o of spec.objects) {
    if (o.kind !== "container") continue;
    const findings = [
      customsFinding(world, signals, o.id, t),
      ...reeferFindings(spec, world, signals, o.id, t, assumptions),
      declaredEmptyFinding(world, signals, o.id, t, assumptions),
    ].filter((f): f is SafetyFinding => f !== null);
    if (findings.length) out[o.id] = findings;
  }
  return out;
}

/** A rule shape that satisfies a policy, for fixes proposed without a model. */
export function policyRepair(spec: TwinSpec, policyId: string, subject: string): { appliesTo: Rule["appliesTo"]; when: Condition } | null {
  const all = { kind: "container", ids: [] } as Rule["appliesTo"];
  if (policyId === "SAFETY-CUSTOMS") {
    return { appliesTo: all, when: { all: [{ of: "self", fact: "signal.customs.hold", op: "eq", value: true }], any: [] } };
  }
  if (policyId === "SAFETY-DECLARED-EMPTY") {
    return {
      appliesTo: all,
      when: {
        all: [
          { of: "self", fact: "signal.carrier.declared_status", op: "eq", value: "empty" },
          { of: "self", fact: "signal.scale.weight_kg", op: "gt", value: SAFETY_ASSUMPTIONS.emptyMaxKg },
        ],
        any: [],
      },
    };
  }
  if (policyId === "SAFETY-REEFER-TEMP") {
    // The DSL compares against literals, so a setpoint-relative limit is per box.
    const setpoint = spec.objects.find((o) => o.id === subject)?.props.find((p) => p.key === "setpoint_c")?.value;
    if (typeof setpoint !== "number") return null;
    return {
      appliesTo: { kind: null, ids: [subject] },
      when: { all: [{ of: "self", fact: "signal.reefer_sensor.temp_c", op: "gt", value: setpoint + SAFETY_ASSUMPTIONS.reeferExcursionC }], any: [] },
    };
  }
  return null;
}
