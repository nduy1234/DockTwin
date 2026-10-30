/**
 * Deterministic simulation: replays a scenario's ground-truth state changes and
 * external signals against a twin, tick by tick, and reports behavior bugs.
 *
 * Within a tick, rules are re-evaluated until state stops changing (fixpoint).
 * Recommendations are recomputed every tick from the fixpoint firings.
 */
import { fire, initialState, makeCtx, readFact, subjectsOf, evalCondition, type SignalStore, type State } from "./dsl";
import { LADDER, type LadderLevel, type Scalar, type Scenario, type TwinSpec } from "./schema";

export const MAX_FIXPOINT_ITERATIONS = 10;

export type BugKind = "conflict" | "oscillation" | "invariant_violation" | "dead_rule" | "unknown_fact";

export type Bug = {
  kind: BugKind;
  severity: "info" | "warn" | "critical";
  message: string;
  ruleIds: string[];
  subject?: string;
  invariantId?: string;
  firstT?: number;
  count: number;
};

export type Recommendation = { ruleId: string; level: LadderLevel; reason: string };

export type TickRecord = {
  t: number;
  fired: { ruleId: string; subject: string }[];
  /** Effective (most severe) recommendation per subject this tick. */
  levels: Record<string, LadderLevel>;
  changed: { target: string; key: string; value: Scalar; by: string }[];
};

export type SubjectOutcome = {
  subject: string;
  level: LadderLevel | null; // at final tick
  peak: LadderLevel | null; // most severe at any tick
  peakT: number | null;
  reasons: Recommendation[]; // at peak tick
  flags: { code: string; severity: string; ruleId: string }[];
};

export type SimResult = {
  scenarioId: string;
  ticks: TickRecord[];
  finalState: State;
  outcomes: Record<string, SubjectOutcome>;
  bugs: Bug[];
  firedRules: string[];
};

export const levelIndex = (l: LadderLevel | null | undefined) => (l ? LADDER.indexOf(l) : -1);
const maxLevel = (a: LadderLevel | null, b: LadderLevel | null) => (levelIndex(a) >= levelIndex(b) ? a : b);

function cloneState(s: State): State {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v }]));
}

export function runScenario(spec: TwinSpec, scenario: Scenario): SimResult {
  const state = initialState(spec);
  const signals: SignalStore = {};
  const bugs = new Map<string, Bug>();
  const fired = new Set<string>();
  const ticks: TickRecord[] = [];
  const outcomes: Record<string, SubjectOutcome> = {};

  const addBug = (key: string, bug: Omit<Bug, "count">) => {
    const prev = bugs.get(key);
    if (prev) prev.count++;
    else bugs.set(key, { ...bug, count: 1 });
  };

  const changes = [...scenario.stateChanges].sort((a, b) => a.t - b.t);
  const sigs = [...scenario.signals].sort((a, b) => a.t - b.t);
  let ci = 0;
  let si = 0;

  for (let t = 0; t <= scenario.durationMin; t += scenario.tickMin) {
    const changed: TickRecord["changed"] = [];
    for (; ci < changes.length && changes[ci]!.t <= t; ci++) {
      const c = changes[ci]!;
      (state[c.target] ??= {})[c.key] = c.value;
      changed.push({ target: c.target, key: c.key, value: c.value, by: "world" });
    }
    for (; si < sigs.length && sigs[si]!.t <= t; si++) {
      const s = sigs[si]!;
      (signals[s.target] ??= {})[`${s.source}.${s.key}`] = { value: s.value, t: s.t };
    }

    const ctx = makeCtx(spec, state, signals, t);
    let firings = fire(ctx);
    const seen = new Set<string>([JSON.stringify(state)]);
    const writers = new Set<string>(); // every rule that changed state this tick

    for (let iter = 0; iter < MAX_FIXPOINT_ITERATIONS; iter++) {
      // Collect set-writes per (subject, key); highest priority wins.
      const writes = new Map<string, { value: Scalar; priority: number; ruleId: string }[]>();
      for (const f of firings) {
        for (const a of f.actions) {
          if (a.type !== "set") continue;
          const k = `${f.subject}\u0000${a.key}`;
          const list = writes.get(k) ?? [];
          list.push({ value: a.value, priority: f.priority, ruleId: f.ruleId });
          writes.set(k, list);
        }
      }

      let dirty = false;
      for (const [k, list] of writes) {
        const [subject, key] = k.split("\u0000") as [string, string];
        list.sort((a, b) => b.priority - a.priority || a.ruleId.localeCompare(b.ruleId));
        const top = list[0]!;
        const tied = list.filter((w) => w.priority === top.priority && w.value !== top.value);
        if (tied.length > 0) {
          const ids = [top.ruleId, ...tied.map((w) => w.ruleId)].sort();
          addBug(`conflict:${ids.join(",")}:${subject}:${key}`, {
            kind: "conflict",
            severity: "critical",
            message: `Rules ${ids.join(" and ")} set ${subject}.${key} to different values at equal priority (${list
              .filter((w) => w.priority === top.priority)
              .map((w) => `${w.ruleId}→${JSON.stringify(w.value)}`)
              .join(", ")}). Outcome depends on rule order.`,
            ruleIds: ids,
            subject,
            firstT: t,
          });
        }
        if (state[subject]?.[key] !== top.value) {
          (state[subject] ??= {})[key] = top.value;
          changed.push({ target: subject, key, value: top.value, by: top.ruleId });
          writers.add(top.ruleId);
          dirty = true;
        }
      }
      if (!dirty) break;

      const snapshot = JSON.stringify(state);
      if (seen.has(snapshot) || iter === MAX_FIXPOINT_ITERATIONS - 1) {
        const ids = [...writers].sort();
        addBug(`oscillation:${ids.join(",")}`, {
          kind: "oscillation",
          severity: "critical",
          message: `Rules ${ids.join(", ")} keep rewriting each other's state and never settle within one tick.`,
          ruleIds: ids,
          firstT: t,
        });
        break;
      }
      seen.add(snapshot);
      firings = fire(ctx);
    }

    // Recommendations + flags from the settled firings.
    const levels: Record<string, LadderLevel> = {};
    const reasons: Record<string, Recommendation[]> = {};
    for (const f of firings) {
      fired.add(f.ruleId);
      for (const a of f.actions) {
        if (a.type === "recommend") {
          levels[f.subject] = maxLevel(levels[f.subject] ?? null, a.level)!;
          (reasons[f.subject] ??= []).push({ ruleId: f.ruleId, level: a.level, reason: a.reason });
        } else if (a.type === "flag") {
          const o = (outcomes[f.subject] ??= emptyOutcome(f.subject));
          if (!o.flags.some((x) => x.code === a.code && x.ruleId === f.ruleId)) {
            o.flags.push({ code: a.code, severity: a.severity, ruleId: f.ruleId });
          }
        }
      }
    }

    for (const inv of spec.invariants) {
      for (const subject of subjectsOf(spec, inv.appliesTo)) {
        if (!evalCondition(ctx, inv.when, subject)) continue;
        const got = levels[subject] ?? null;
        if (levelIndex(got) < levelIndex(inv.minLevel)) {
          addBug(`inv:${inv.id}:${subject}`, {
            kind: "invariant_violation",
            severity: "critical",
            message: `${inv.id} violated for ${subject}: "${inv.description}" — rules produced ${
              got ?? "no action"
            }, need at least ${inv.minLevel}.`,
            ruleIds: (reasons[subject] ?? []).map((r) => r.ruleId),
            subject,
            invariantId: inv.id,
            firstT: t,
          });
        }
      }
    }

    for (const [subject, level] of Object.entries(levels)) {
      const o = (outcomes[subject] ??= emptyOutcome(subject));
      if (levelIndex(level) > levelIndex(o.peak)) {
        o.peak = level;
        o.peakT = t;
        o.reasons = reasons[subject] ?? [];
      }
    }
    for (const o of Object.values(outcomes)) o.level = levels[o.subject] ?? null;

    ticks.push({
      t,
      fired: firings.map((f) => ({ ruleId: f.ruleId, subject: f.subject })),
      levels,
      changed,
    });
  }

  for (const r of spec.rules) {
    if (!fired.has(r.id)) {
      addBug(`dead:${r.id}`, {
        kind: "dead_rule",
        severity: "info",
        message: `${r.id} "${r.name}" never fired in this scenario.`,
        ruleIds: [r.id],
      });
    }
  }
  for (const b of unknownFacts(spec, state)) addBug(`unknown:${b.ruleIds[0]}:${b.message}`, b);

  return {
    scenarioId: scenario.id,
    ticks,
    finalState: cloneState(state),
    outcomes,
    bugs: [...bugs.values()].sort(
      (a, b) => sevRank(b.severity) - sevRank(a.severity) || (a.firstT ?? 0) - (b.firstT ?? 0),
    ),
    firedRules: [...fired].sort(),
  };
}

const sevRank = (s: Bug["severity"]) => ({ info: 0, warn: 1, critical: 2 })[s];

function emptyOutcome(subject: string): SubjectOutcome {
  return { subject, level: null, peak: null, peakT: null, reasons: [], flags: [] };
}

/** State facts no object ever has and no rule ever sets: almost always a typo. */
function unknownFacts(spec: TwinSpec, finalState: State): Omit<Bug, "count">[] {
  const known = new Set<string>();
  for (const props of Object.values(finalState)) for (const k of Object.keys(props)) known.add(k);
  for (const r of spec.rules) for (const a of r.then) if (a.type === "set") known.add(a.key);
  const out: Omit<Bug, "count">[] = [];
  for (const r of spec.rules) {
    for (const p of [...r.when.all, ...r.when.any]) {
      if (p.fact === "clock.minutes" || p.fact.startsWith("signal.")) continue;
      if (!known.has(p.fact) && p.op !== "missing") {
        out.push({
          kind: "unknown_fact",
          severity: "warn",
          message: `${r.id} reads "${p.fact}", which no object has and no rule sets, so this predicate can never be true.`,
          ruleIds: [r.id],
        });
      }
    }
  }
  return out;
}

/** Read a fact in a final state (used by explanations and tests). */
export function finalFact(spec: TwinSpec, result: SimResult, subject: string, fact: string) {
  return readFact(makeCtx(spec, result.finalState), subject, fact);
}
