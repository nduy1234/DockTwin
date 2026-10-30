/**
 * DockTwin twin spec + rule DSL.
 *
 * One zod source of truth: it validates model output AND generates the JSON
 * Schema sent to Muse Spark's constrained decoder. Meta's structured output
 * rejects recursive schemas, so conditions are fixed-depth (all/any of flat
 * predicates) by design. Nothing here is ever executed as code; the engine
 * interprets it.
 */
import { z } from "zod";

export const Scalar = z.union([z.string(), z.number(), z.boolean()]);
export type Scalar = z.infer<typeof Scalar>;

/** Gentlest-first action ladder. Order matters: index = severity. */
export const LADDER = ["watch", "ask", "slow", "reroute", "inspect", "hold", "human"] as const;
export const LadderLevel = z.enum(LADDER);
export type LadderLevel = z.infer<typeof LadderLevel>;

export const PORT_KINDS = ["container", "reefer_plug", "gate_lane", "crane", "scale", "yard_block"] as const;
export const CREATOR_KINDS = ["door", "sensor", "motor", "gripper", "actor", "button"] as const;
export const ObjectKind = z.enum([...PORT_KINDS, ...CREATOR_KINDS]);
export type ObjectKind = z.infer<typeof ObjectKind>;

/** External signal sources. Each gets a trust score in engine/trust.ts. */
export const SIGNAL_SOURCES = [
  "carrier",
  "scale",
  "customs",
  "reefer_sensor",
  "gate_ops",
  "billing",
  "sensor",
  "user",
] as const;
export const SignalSource = z.enum(SIGNAL_SOURCES);
export type SignalSource = z.infer<typeof SignalSource>;

export const Prop = z.object({
  key: z.string().min(1).describe("snake_case property name, e.g. temp_c, declared_weight_kg"),
  value: Scalar,
});

export const TwinObject = z.object({
  id: z.string().min(1).describe("Stable id. Use the real code when given, e.g. MSCU1234565 or LANE-4"),
  kind: ObjectKind,
  label: z.string(),
  props: z.array(Prop).describe("Initial state of the object"),
  attachedTo: z
    .string()
    .nullable()
    .describe("id of the object this one sits at / plugs into / belongs to, else null"),
});
export type TwinObject = z.infer<typeof TwinObject>;

export const Op = z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "exists", "missing"]);
export type Op = z.infer<typeof Op>;

/**
 * A fact path is one of:
 *   "<prop>"                   current state of the subject, e.g. "temp_c"
 *   "signal.<source>.<key>"    latest raw signal, e.g. "signal.customs.hold"
 *   "clock.minutes"            simulation time
 */
export const Predicate = z.object({
  of: z
    .string()
    .describe('"self", "attached" (the object self.attachedTo points at), or an explicit object id'),
  fact: z.string().min(1),
  op: Op,
  value: z.union([Scalar, z.array(z.string())]).nullable().describe("null for exists/missing"),
});
export type Predicate = z.infer<typeof Predicate>;

export const Condition = z.object({
  all: z.array(Predicate).describe("every predicate must hold"),
  any: z.array(Predicate).describe("at least one must hold; empty list = ignored"),
});
export type Condition = z.infer<typeof Condition>;

export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set"), key: z.string().min(1), value: Scalar }),
  z.object({
    type: z.literal("flag"),
    code: z.string().min(1),
    severity: z.enum(["info", "warn", "critical"]),
  }),
  z.object({ type: z.literal("recommend"), level: LadderLevel, reason: z.string() }),
]);
export type Action = z.infer<typeof Action>;

export const Rule = z.object({
  id: z.string().min(1).describe("R1, R2, ..."),
  name: z.string(),
  appliesTo: z.object({
    kind: ObjectKind.nullable(),
    ids: z.array(z.string()).describe("empty = every object of `kind`"),
  }),
  priority: z.number().int().describe("higher wins when two rules set the same key"),
  when: Condition,
  then: z.array(Action).min(1),
});
export type Rule = z.infer<typeof Rule>;

/**
 * Invariants are safety expectations the stress-tester checks: whenever `when`
 * holds for a subject, the rules must have produced at least `minLevel`.
 */
export const Invariant = z.object({
  id: z.string().min(1),
  description: z.string(),
  appliesTo: Rule.shape.appliesTo,
  when: Condition,
  minLevel: LadderLevel,
});
export type Invariant = z.infer<typeof Invariant>;

export const Domain = z.enum(["port", "creator"]);
export type Domain = z.infer<typeof Domain>;

export const TwinSpec = z.object({
  name: z.string(),
  domain: Domain,
  summary: z.string().describe("one sentence describing the twin"),
  objects: z.array(TwinObject).min(1),
  rules: z.array(Rule),
  invariants: z.array(Invariant),
});
export type TwinSpec = z.infer<typeof TwinSpec>;

/** JSON Schema for Meta structured output (draft 2020-12, `$schema` stripped). */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/**
 * Semantic checks zod can't express: dangling ids, kind/ref mismatches.
 * Returned strings are fed back to the model verbatim during schema repair.
 */
export function checkTwin(spec: TwinSpec): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const o of spec.objects) {
    if (ids.has(o.id)) issues.push(`duplicate object id "${o.id}"`);
    ids.add(o.id);
  }
  for (const o of spec.objects) {
    if (o.attachedTo && !ids.has(o.attachedTo)) {
      issues.push(`object "${o.id}" attachedTo unknown id "${o.attachedTo}"`);
    }
  }
  const ruleIds = new Set<string>();
  const scoped = [
    ...spec.rules.map((r) => ({ tag: `rule ${r.id}`, s: r })),
    ...spec.invariants.map((i) => ({ tag: `invariant ${i.id}`, s: i })),
  ];
  for (const r of spec.rules) {
    if (ruleIds.has(r.id)) issues.push(`duplicate rule id "${r.id}"`);
    ruleIds.add(r.id);
  }
  for (const { tag, s } of scoped) {
    for (const id of s.appliesTo.ids) {
      if (!ids.has(id)) issues.push(`${tag} appliesTo unknown id "${id}"`);
    }
    if (!s.appliesTo.kind && s.appliesTo.ids.length === 0) {
      issues.push(`${tag} appliesTo needs a kind or at least one id`);
    }
    for (const p of [...s.when.all, ...s.when.any]) {
      if (p.of !== "self" && p.of !== "attached" && !ids.has(p.of)) {
        issues.push(`${tag} predicate references unknown object "${p.of}"`);
      }
      const needsValue = p.op !== "exists" && p.op !== "missing";
      if (needsValue && p.value === null) issues.push(`${tag} predicate on "${p.fact}" with op ${p.op} needs a value`);
      if (p.op === "in" && !Array.isArray(p.value)) issues.push(`${tag} predicate op "in" needs an array value`);
      if (p.fact.startsWith("signal.")) {
        const src = p.fact.split(".")[1];
        if (!SIGNAL_SOURCES.includes(src as SignalSource)) {
          issues.push(`${tag} uses unknown signal source "${src}" (allowed: ${SIGNAL_SOURCES.join(", ")})`);
        }
      }
    }
    if (s.when.all.length === 0 && s.when.any.length === 0) issues.push(`${tag} has an empty condition`);
  }
  return issues;
}

/** A claim from an external source. May be wrong; the trust layer weighs it. */
export const SignalEvent = z.object({
  t: z.number().int().min(0).describe("minutes from scenario start"),
  source: SignalSource,
  target: z.string().min(1).describe("object id the claim is about"),
  key: z.string().min(1),
  value: Scalar,
});
export type SignalEvent = z.infer<typeof SignalEvent>;

/** Ground truth physical change (a lane really goes down, a temp really rises). */
export const StateChange = z.object({
  t: z.number().int().min(0),
  target: z.string().min(1),
  key: z.string().min(1),
  value: Scalar,
});
export type StateChange = z.infer<typeof StateChange>;

export const Scenario = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  durationMin: z.number().int().min(1).max(24 * 60),
  tickMin: z.number().int().min(1).max(120),
  stateChanges: z.array(StateChange),
  signals: z.array(SignalEvent),
});
export type Scenario = z.infer<typeof Scenario>;

/**
 * A proposed fix, as edits to the rule set. Flat op shape (not a union) keeps
 * the JSON Schema shallow for constrained decoding.
 */
export const RuleOp = z.object({
  op: z.enum(["add", "replace", "remove"]),
  ruleId: z.string().nullable().describe("rule to replace/remove; null for add"),
  rule: Rule.nullable().describe("full new rule for add/replace; null for remove"),
});
export type RuleOp = z.infer<typeof RuleOp>;

export const RuleDiff = z.object({
  rationale: z.string().describe("one or two sentences a terminal planner would accept"),
  ops: z.array(RuleOp).min(1).max(4),
});
export type RuleDiff = z.infer<typeof RuleDiff>;
