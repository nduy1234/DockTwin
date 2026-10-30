/**
 * Source trust: how much the engine believes each external claim, and why.
 *
 * trust = base(source) - staleness, then halved if a more trustworthy source
 * contradicts it. Everything here is deterministic and explainable: each
 * score carries the notes that produced it.
 */
import type { Scalar, Scenario, SignalSource, TwinSpec } from "./schema";

export const SOURCE_TRUST: Record<SignalSource, { base: number; why: string }> = {
  customs: { base: 0.98, why: "legal authority; its holds are binding" },
  scale: { base: 0.93, why: "calibrated physical measurement at the gate" },
  reefer_sensor: { base: 0.9, why: "direct telemetry from the reefer unit" },
  billing: { base: 0.9, why: "terminal's own system of record" },
  gate_ops: { base: 0.85, why: "terminal operations, usually current" },
  sensor: { base: 0.8, why: "generic sensor feed" },
  user: { base: 0.7, why: "manual entry" },
  carrier: { base: 0.6, why: "self-reported paperwork, often stale or wrong" },
};

/** Trust lost per hour of signal age, capped. */
export const STALENESS_PER_HOUR = 0.05;
export const MAX_STALENESS = 0.3;

export type SignalView = {
  source: SignalSource;
  key: string;
  value: Scalar;
  t: number;
  target: string;
  trust: number;
  notes: string[];
};

export type Conflict = {
  about: string;
  winner: { source: SignalSource; key: string; value: Scalar };
  loser: { source: SignalSource; key: string; value: Scalar };
  why: string;
};

type Claims = Map<string, SignalView>; // "<source>.<key>" -> latest

/**
 * Port-domain contradictions between claims about the same box. Each returns a
 * reason string when the pair disagrees. The more trusted source wins.
 */
const CONTRADICTIONS: {
  a: [SignalSource, string];
  b: [SignalSource, string];
  check: (a: Scalar, b: Scalar, props: Record<string, Scalar>) => string | null;
}[] = [
  {
    a: ["carrier", "declared_status"],
    b: ["scale", "weight_kg"],
    check: (a, b) => (a === "empty" && typeof b === "number" && b > 5000 ? `declared empty but scale reads ${(b / 1000).toFixed(1)} t` : null),
  },
  {
    a: ["carrier", "declared_weight_kg"],
    b: ["scale", "weight_kg"],
    check: (a, b) =>
      typeof a === "number" && typeof b === "number" && Math.abs(a - b) / Math.max(a, b, 1) > 0.2
        ? `declared ${(a / 1000).toFixed(1)} t vs scale ${(b / 1000).toFixed(1)} t (>20% apart)`
        : null,
  },
  {
    a: ["carrier", "temp_ok"],
    b: ["reefer_sensor", "temp_c"],
    check: (a, b, props) => {
      const sp = typeof props.setpoint_c === "number" ? props.setpoint_c : null;
      return a === true && sp !== null && typeof b === "number" && b > sp + 2
        ? `carrier says temperature OK, sensor reads ${b}°C vs setpoint ${sp}°C`
        : null;
    },
  },
];

/** Latest claims about `subject` (and its attached object) up to time t, scored. */
export function trustedSignals(
  spec: TwinSpec,
  scenario: Scenario,
  subject: string,
  t: number,
  props: Record<string, Scalar> = {},
): { signals: SignalView[]; conflicts: Conflict[] } {
  const attached = spec.objects.find((o) => o.id === subject)?.attachedTo;
  const latest: Claims = new Map();
  for (const s of scenario.signals) {
    if (s.t > t || (s.target !== subject && s.target !== attached)) continue;
    const k = `${s.target}|${s.source}.${s.key}`;
    const prev = latest.get(k);
    if (prev && prev.t > s.t) continue;
    const { base, why } = SOURCE_TRUST[s.source];
    const age = t - s.t;
    const stale = Math.min(MAX_STALENESS, (age / 60) * STALENESS_PER_HOUR);
    const notes = [`${s.source}: ${why} (base ${base.toFixed(2)})`];
    if (stale >= 0.01) notes.push(`${age} min old (−${stale.toFixed(2)})`);
    latest.set(k, { source: s.source, key: s.key, value: s.value, t: s.t, target: s.target, trust: base - stale, notes });
  }

  const mine = new Map([...latest.values()].filter((v) => v.target === subject).map((v) => [`${v.source}.${v.key}`, v]));
  const conflicts: Conflict[] = [];
  for (const c of CONTRADICTIONS) {
    const a = mine.get(c.a.join("."));
    const b = mine.get(c.b.join("."));
    if (!a || !b) continue;
    const why = c.check(a.value, b.value, props);
    if (!why) continue;
    const [win, lose] = a.trust >= b.trust ? [a, b] : [b, a];
    lose.trust = +(lose.trust * 0.5).toFixed(3);
    lose.notes.push(`contradicted by ${win.source} (${why}); trust halved`);
    win.notes.push(`overrides ${lose.source}.${lose.key}`);
    conflicts.push({
      about: subject,
      winner: { source: win.source, key: win.key, value: win.value },
      loser: { source: lose.source, key: lose.key, value: lose.value },
      why,
    });
  }

  const signals = [...latest.values()]
    .map((v) => ({ ...v, trust: +v.trust.toFixed(3) }))
    .sort((x, y) => y.trust - x.trust || x.source.localeCompare(y.source));
  return { signals, conflicts };
}
