/**
 * Deterministic interpreter for the rule DSL. Pure functions only: no I/O, no
 * clocks, no randomness, and never eval(). Given the same spec + state +
 * signals it always yields the same firings, in the same order.
 */
import type { Action, Condition, Predicate, Rule, Scalar, TwinObject, TwinSpec } from "./schema";

/** Current state per object id. */
export type State = Record<string, Record<string, Scalar>>;
/** Latest signal per object id, keyed "<source>.<key>". */
export type SignalStore = Record<string, Record<string, { value: Scalar; t: number }>>;

export type Ctx = {
  spec: TwinSpec;
  byId: Map<string, TwinObject>;
  state: State;
  signals: SignalStore;
  t: number;
};

export type Firing = { ruleId: string; subject: string; priority: number; actions: Action[] };

export function initialState(spec: TwinSpec): State {
  const state: State = {};
  for (const o of spec.objects) state[o.id] = Object.fromEntries(o.props.map((p) => [p.key, p.value]));
  return state;
}

export function makeCtx(spec: TwinSpec, state: State, signals: SignalStore = {}, t = 0): Ctx {
  return { spec, byId: new Map(spec.objects.map((o) => [o.id, o])), state, signals, t };
}

export function resolveSubject(ctx: Ctx, of: string, selfId: string): string | undefined {
  if (of === "self") return selfId;
  if (of === "attached") return ctx.byId.get(selfId)?.attachedTo ?? undefined;
  return ctx.byId.has(of) ? of : undefined;
}

export function readFact(ctx: Ctx, subjectId: string, fact: string): Scalar | undefined {
  if (fact === "clock.minutes") return ctx.t;
  if (fact.startsWith("signal.")) {
    const key = fact.slice("signal.".length); // "<source>.<key>"
    return ctx.signals[subjectId]?.[key]?.value;
  }
  return ctx.state[subjectId]?.[fact];
}

function compare(op: "gt" | "gte" | "lt" | "lte", a: Scalar | undefined, b: unknown): boolean {
  if (typeof a !== "number" || typeof b !== "number") return false;
  switch (op) {
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
  }
}

export function evalPredicate(ctx: Ctx, p: Predicate, selfId: string): boolean {
  const subject = resolveSubject(ctx, p.of, selfId);
  const v = subject === undefined ? undefined : readFact(ctx, subject, p.fact);
  switch (p.op) {
    case "exists":
      return v !== undefined;
    case "missing":
      return v === undefined;
    case "eq":
      return v !== undefined && v === p.value;
    case "neq":
      // An unknown value is not "different": absent data never satisfies neq.
      return v !== undefined && v !== p.value;
    case "in":
      return v !== undefined && Array.isArray(p.value) && p.value.includes(String(v));
    default:
      return compare(p.op, v, p.value);
  }
}

export function evalCondition(ctx: Ctx, c: Condition, selfId: string): boolean {
  if (c.all.length === 0 && c.any.length === 0) return false;
  if (!c.all.every((p) => evalPredicate(ctx, p, selfId))) return false;
  return c.any.length === 0 || c.any.some((p) => evalPredicate(ctx, p, selfId));
}

/** Objects a rule/invariant is scoped to, in spec order. */
export function subjectsOf(spec: TwinSpec, appliesTo: Rule["appliesTo"]): string[] {
  if (appliesTo.ids.length > 0) {
    const want = new Set(appliesTo.ids);
    return spec.objects.filter((o) => want.has(o.id)).map((o) => o.id);
  }
  return spec.objects.filter((o) => o.kind === appliesTo.kind).map((o) => o.id);
}

/** Evaluate every rule against every subject. Order: rule order, then subject order. */
export function fire(ctx: Ctx): Firing[] {
  const out: Firing[] = [];
  for (const rule of ctx.spec.rules) {
    for (const subject of subjectsOf(ctx.spec, rule.appliesTo)) {
      if (evalCondition(ctx, rule.when, subject)) {
        out.push({ ruleId: rule.id, subject, priority: rule.priority, actions: rule.then });
      }
    }
  }
  return out;
}

/** Rules whose scope includes this object (for the inspector). */
export function rulesFor(spec: TwinSpec, objectId: string): Rule[] {
  return spec.rules.filter((r) => subjectsOf(spec, r.appliesTo).includes(objectId));
}
