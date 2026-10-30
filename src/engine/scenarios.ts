/**
 * Seeded, deterministic scenario generator. Two families:
 *
 *  1. Conflict stories: the classic terminal mess (paper says empty / scale
 *     says heavy, customs hold mid-outage, reefer drift, free time running out)
 *     aimed at the twin's most at-risk containers.
 *  2. Boundary probe: reads every numeric/boolean threshold in the twin's own
 *     rules and invariants, then drives each fact below, onto, and past it.
 *
 * Same spec + seed -> byte-identical scenarios. Muse Spark adds adversarial
 * scenarios on top (lib/meta/agents.ts); these guarantee a repeatable floor.
 */
import { subjectsOf } from "./dsl";
import { rng } from "./rng";
import type { Predicate, Scalar, Scenario, SignalEvent, SignalSource, StateChange, TwinSpec } from "./schema";
import { SIGNAL_SOURCES } from "./schema";

export type TaggedScenario = Scenario & { origin: "seeded" | "muse-spark" };

const DURATION = 120;
const TICK = 10;

const prop = (spec: TwinSpec, id: string, key: string) =>
  spec.objects.find((o) => o.id === id)?.props.find((p) => p.key === key)?.value;

/** Containers worth stress-testing first: reefers, holds, ones named in rules. */
export function focusContainers(spec: TwinSpec, limit = 3): string[] {
  const named = new Set(spec.rules.flatMap((r) => r.appliesTo.ids));
  const score = (id: string) =>
    (named.has(id) ? 4 : 0) +
    (prop(spec, id, "reefer") === true ? 2 : 0) +
    (prop(spec, id, "customs_hold") !== undefined ? 1 : 0) +
    (spec.objects.find((o) => o.id === id)?.attachedTo ? 1 : 0);
  return spec.objects
    .filter((o) => o.kind === "container")
    .map((o, i) => ({ id: o.id, s: score(o.id), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.id);
}

export function generateScenarios(spec: TwinSpec, seed: number): TaggedScenario[] {
  if (spec.domain === "creator") return interactionScenarios(spec);
  const r = rng(seed);
  const jitter = (n: number) => Math.round(n * (0.9 + r() * 0.2));
  const boxes = focusContainers(spec);
  const lanes = spec.objects.filter((o) => o.kind === "gate_lane").map((o) => o.id);
  const out: TaggedScenario[] = [];
  if (boxes.length === 0) {
    const probe = boundaryProbe(spec);
    return probe ? [probe] : [];
  }
  const box = boxes[0]!;
  const lane = spec.objects.find((o) => o.id === box)?.attachedTo ?? lanes[0];
  const sp = Number(prop(spec, box, "setpoint_c") ?? 4);
  const sig = (t: number, source: SignalSource, target: string, key: string, value: Scalar): SignalEvent => ({
    t,
    source,
    target,
    key,
    value,
  });
  const chg = (t: number, target: string, key: string, value: Scalar): StateChange => ({ t, target, key, value });

  const paperVsScale = {
    signals: [
      sig(0, "carrier", box, "declared_status", "empty"),
      sig(0, "carrier", box, "declared_weight_kg", 2300),
      sig(10, "scale", box, "weight_kg", jitter(24000)),
    ],
    changes: [chg(10, box, "measured_weight_kg", jitter(24000))],
  };
  out.push({
    id: "S1",
    origin: "seeded",
    name: "Paper says empty, scale says heavy",
    description: `Carrier declares ${box} empty (2.3 t tare); the gate scale reads ~24 t.`,
    durationMin: DURATION,
    tickMin: TICK,
    signals: paperVsScale.signals,
    stateChanges: paperVsScale.changes,
  });

  const holdDuringOutage = {
    signals: [
      sig(20, "customs", box, "hold", true),
      ...(lane ? [sig(30, "gate_ops", lane, "lane_status", "down")] : []),
      sig(90, "customs", box, "hold", false),
    ],
    changes: lane ? [chg(30, lane, "status", "down"), chg(100, lane, "status", "up")] : [],
  };
  out.push({
    id: "S2",
    origin: "seeded",
    name: "Customs hold lands during a lane outage",
    description: `Customs holds ${box} at t=20; its lane ${lane ?? "?"} fails at t=30; hold lifts at t=90.`,
    durationMin: DURATION,
    tickMin: TICK,
    signals: holdDuringOutage.signals,
    stateChanges: holdDuringOutage.changes,
  });

  const reefer = boxes.find((b) => prop(spec, b, "reefer") === true);
  const drift = reefer
    ? (() => {
        const s = Number(prop(spec, reefer, "setpoint_c") ?? sp);
        const steps = [0.5, 2.5, 3.5, 5, 6.5];
        return {
          signals: [
            ...steps.map((d, i) => sig(i * 20, "reefer_sensor", reefer, "temp_c", +(s + d).toFixed(1))),
            sig(30, "carrier", reefer, "temp_ok", true),
          ],
          changes: steps.map((d, i) => chg(i * 20, reefer, "temp_c", +(s + d).toFixed(1))),
        };
      })()
    : null;
  if (reefer && drift) {
    out.push({
      id: "S3",
      origin: "seeded",
      name: "Reefer creeping warm while carrier says OK",
      description: `${reefer} drifts from setpoint +0.5°C to +6.5°C over 80 min; carrier keeps reporting temp OK.`,
      durationMin: DURATION,
      tickMin: TICK,
      signals: drift.signals,
      stateChanges: drift.changes,
    });
  }

  const half = lanes.slice(0, Math.max(1, Math.floor(lanes.length / 2)));
  const clock = {
    signals: [
      ...[0, 30, 60, 90, 120].map((t) => sig(t, "billing", box, "free_minutes_left", Math.max(0, 90 - t))),
      ...half.map((l) => sig(15, "gate_ops", l, "lane_status", "down")),
    ],
    changes: [
      ...[0, 30, 60, 90, 120].map((t) => chg(t, box, "free_minutes_left", Math.max(0, 90 - t))),
      ...half.map((l) => chg(15, l, "status", "down")),
    ],
  };
  out.push({
    id: "S4",
    origin: "seeded",
    name: "Half the lanes down, clock on charges running",
    description: `${half.join(", ") || "lanes"} go down at t=15 while ${box}'s free time runs 90 → 0 min.`,
    durationMin: DURATION,
    tickMin: TICK,
    signals: clock.signals,
    stateChanges: clock.changes,
  });

  // Perfect storm: everything at once, compressed into the first hour.
  const squash = <T extends { t: number }>(xs: T[]) => xs.map((x) => ({ ...x, t: Math.min(60, Math.round(x.t / 2 / TICK) * TICK) }));
  out.push({
    id: "S5",
    origin: "seeded",
    name: "Perfect storm",
    description: "All of the above at once: conflicting paperwork, customs hold, lane outage, reefer drift, free time expiring.",
    durationMin: DURATION,
    tickMin: TICK,
    signals: squash([...paperVsScale.signals, ...holdDuringOutage.signals.slice(0, 2), ...(drift?.signals ?? []), ...clock.signals]),
    stateChanges: squash([...paperVsScale.changes, ...holdDuringOutage.changes.slice(0, 1), ...(drift?.changes ?? []), ...clock.changes]),
  });

  const probe = boundaryProbe(spec);
  if (probe) out.push(probe);
  return out;
}

/**
 * For each predicate with a concrete threshold, walk the fact below -> onto ->
 * past it (numbers), or set then flip it (booleans/strings), on up to two
 * subjects of the rule. Each fact gets its own time window so probes don't
 * mask each other.
 */
export function boundaryProbe(spec: TwinSpec): TaggedScenario | null {
  type Probe = { target: string; fact: string; values: Scalar[] };
  const probes = new Map<string, Probe>();
  const scoped = [...spec.rules, ...spec.invariants];
  for (const s of scoped) {
    const subjects = subjectsOf(spec, s.appliesTo).slice(0, 2);
    for (const p of [...s.when.all, ...s.when.any]) {
      for (const self of subjects) {
        const target = p.of === "self" ? self : p.of === "attached" ? spec.objects.find((o) => o.id === self)?.attachedTo : p.of;
        if (!target || p.fact === "clock.minutes") continue;
        const values = probeValues(p);
        if (!values) continue;
        const k = `${target}|${p.fact}`;
        const prev = probes.get(k);
        // Merge thresholds on the same fact into one ascending walk.
        const merged = prev ? [...new Set([...prev.values, ...values])] : values;
        if (merged.every((v) => typeof v === "number")) (merged as number[]).sort((a, b) => a - b);
        probes.set(k, { target, fact: p.fact, values: merged.slice(0, 6) });
      }
    }
  }
  if (probes.size === 0) return null;

  const signals: SignalEvent[] = [];
  const stateChanges: StateChange[] = [];
  let t = 0;
  for (const pr of [...probes.values()].slice(0, 12)) {
    for (const v of pr.values) {
      if (pr.fact.startsWith("signal.")) {
        const [, source, ...rest] = pr.fact.split(".");
        if (!SIGNAL_SOURCES.includes(source as SignalSource)) continue;
        signals.push({ t, source: source as SignalSource, target: pr.target, key: rest.join("."), value: v });
      } else {
        stateChanges.push({ t, target: pr.target, key: pr.fact, value: v });
      }
      t += TICK;
    }
  }
  return {
    id: "S6",
    origin: "seeded",
    name: "Boundary probe",
    description: `Drives ${probes.size} rule thresholds below, onto, and past their trigger values.`,
    durationMin: Math.max(TICK, t),
    tickMin: TICK,
    signals,
    stateChanges,
  };
}

function probeValues(p: Predicate): Scalar[] | null {
  const v = p.value;
  if (typeof v === "number") {
    const eps = Math.max(0.5, Math.abs(v) * 0.05);
    return [+(v - eps).toFixed(2), v, +(v + eps).toFixed(2)];
  }
  if (typeof v === "boolean") return [!v, v];
  if (typeof v === "string") return [`not_${v}`, v];
  if (Array.isArray(v) && v.length) return ["__none__", v[0]!];
  return null;
}

type Trigger = { target: string; source: SignalSource; key: string; on: Scalar; off: Scalar };

/** The value that makes a predicate true (on) and one that makes it false (off). */
export function onOff(p: Predicate): { on: Scalar; off: Scalar } | null {
  const v = p.value;
  const eps = typeof v === "number" ? Math.max(0.5, Math.abs(v) * 0.05) : 0;
  const opposite = (x: Scalar): Scalar => (typeof x === "boolean" ? !x : typeof x === "number" ? x + eps : `not_${x}`);
  switch (p.op) {
    case "gt":
    case "gte":
      return typeof v === "number" ? { on: v + eps, off: v - eps } : null;
    case "lt":
    case "lte":
      return typeof v === "number" ? { on: v - eps, off: v + eps } : null;
    case "eq":
      return v === null || Array.isArray(v) ? null : { on: v, off: opposite(v) };
    case "neq":
      return v === null || Array.isArray(v) ? null : { on: opposite(v), off: v };
    case "in":
      return Array.isArray(v) && v.length ? { on: v[0]!, off: "__none__" } : null;
    default:
      return null;
  }
}

/** Every external reading the rules/invariants react to, with a triggering and a resting value. */
export function triggers(spec: TwinSpec): Trigger[] {
  const out = new Map<string, Trigger>();
  for (const s of [...spec.rules, ...spec.invariants]) {
    for (const p of [...s.when.all, ...s.when.any]) {
      if (!p.fact.startsWith("signal.")) continue;
      const [, source, ...rest] = p.fact.split(".");
      if (!SIGNAL_SOURCES.includes(source as SignalSource)) continue;
      const v = onOff(p);
      if (!v) continue;
      const targets =
        p.of === "self" || p.of === "attached"
          ? subjectsOf(spec, s.appliesTo)
              .slice(0, 2)
              .map((id) => (p.of === "self" ? id : spec.objects.find((o) => o.id === id)?.attachedTo))
          : [p.of];
      for (const target of targets) {
        if (!target) continue;
        const k = `${target}|${p.fact}`;
        if (out.has(k)) continue;
        out.set(k, { target, source: source as SignalSource, key: rest.join("."), ...v });
      }
    }
  }
  return [...out.values()];
}

/**
 * Creator mode: generic interaction stress for any object (doors, grippers,
 * NPCs). Built only from the readings the twin's own rules react to.
 */
export function interactionScenarios(spec: TwinSpec): TaggedScenario[] {
  const ts = triggers(spec);
  const out: TaggedScenario[] = [];
  const sig = (t: number, x: Trigger, value: Scalar): SignalEvent => ({ t, source: x.source, target: x.target, key: x.key, value });
  const label = (x: Trigger) => `${x.target}.${x.key}`;
  if (ts.length === 0) {
    const probe = boundaryProbe(spec);
    return probe ? [probe] : [];
  }
  const power = ts.filter((x) => /power/.test(x.key));
  const inputs = ts.filter((x) => !power.includes(x));

  out.push({
    id: "C1",
    origin: "seeded",
    name: "Everything at once, then let go one by one",
    description: `All ${ts.length} inputs trigger together, then release in order (${inputs.map(label).join(" → ")}): finds rules that fight or get stuck.`,
    durationMin: 20 * (inputs.length + 1),
    tickMin: TICK,
    stateChanges: [],
    signals: [...inputs.map((x) => sig(0, x, x.on)), ...inputs.map((x, i) => sig(20 * (i + 1), x, x.off))],
  });
  if (inputs.length > 1) {
    out.push({
      id: "C2",
      origin: "seeded",
      name: "Let go in reverse order",
      description: `Same as C1, released backwards (${[...inputs].reverse().map(label).join(" → ")}): e.g. someone stops moving while still in the doorway.`,
      durationMin: 20 * (inputs.length + 1),
      tickMin: TICK,
      stateChanges: [],
      signals: [...inputs.map((x) => sig(0, x, x.on)), ...[...inputs].reverse().map((x, i) => sig(20 * (i + 1), x, x.off))],
    });
  }
  out.push({
    id: "C3",
    origin: "seeded",
    name: "Flickering sensors",
    description: "Every input flips on/off each tick, out of phase with each other: noisy hardware, bouncing buttons, frame jitter.",
    durationMin: 80,
    tickMin: TICK,
    stateChanges: [],
    signals: Array.from({ length: 9 }, (_, k) => inputs.map((x, i) => sig(k * TICK, x, (k + i) % 2 === 0 ? x.on : x.off))).flat(),
  });
  const motors = spec.objects.filter((o) => o.kind === "motor").map((o) => o.id);
  const powerTriggers: Trigger[] = power.length
    ? power
    : motors.map((id) => ({ target: id, source: "sensor", key: "power_ok", on: false, off: true }));
  if (powerTriggers.length) {
    out.push({
      id: "C4",
      origin: "seeded",
      name: "Power loss mid-motion",
      description: `Inputs trigger motion at t=0; ${powerTriggers.map(label).join(", ")} drops at t=20 and returns at t=50.`,
      durationMin: 80,
      tickMin: TICK,
      stateChanges: powerTriggers.flatMap((x) => [
        { t: 20, target: x.target, key: x.key, value: x.on },
        { t: 50, target: x.target, key: x.key, value: x.off },
      ]),
      signals: [...inputs.slice(0, 1).map((x) => sig(0, x, x.on)), ...powerTriggers.flatMap((x) => [sig(20, x, x.on), sig(50, x, x.off)])],
    });
  }
  const probe = boundaryProbe(spec);
  if (probe) out.push({ ...probe, id: "C5" });
  return out;
}
