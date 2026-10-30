/**
 * Rule-of-thumb fixes the engine can propose without a model. Used for offline
 * mock mode and as a clearly labeled fallback if a Muse Spark fix call fails.
 * Every heuristic fix still goes through verifyFix like a model fix.
 */
import type { Bug } from "./sim";
import { LADDER, type Rule, type RuleDiff, type TwinSpec } from "./schema";

export function heuristicFix(spec: TwinSpec, bug: Bug): RuleDiff | null {
  const rule = (id: string) => spec.rules.find((r) => r.id === id);
  switch (bug.kind) {
    case "conflict": {
      const rs = bug.ruleIds.map(rule).filter((r): r is Rule => !!r);
      if (rs.length < 2) return null;
      // The rule pushing the more cautious action wins; ties go to the hold-ier set value.
      const caution = (r: Rule) => Math.max(-1, ...r.then.map((a) => (a.type === "recommend" ? LADDER.indexOf(a.level) : -1)));
      const winner = [...rs].sort((a, b) => caution(b) - caution(a) || a.id.localeCompare(b.id))[0]!;
      const top = Math.max(...spec.rules.map((r) => r.priority));
      return {
        rationale: `${bug.ruleIds.join(" and ")} fight over the same field at equal priority. Let the more cautious rule (${winner.id}) win explicitly instead of by rule order.`,
        ops: [{ op: "replace", ruleId: winner.id, rule: { ...winner, priority: top + 1 } }],
      };
    }
    case "invariant_violation": {
      const inv = spec.invariants.find((i) => i.id === bug.invariantId);
      if (!inv) return null;
      return {
        rationale: `Nothing escalates to ${inv.minLevel} when "${inv.description}". Add a rule that does, scoped exactly like the invariant.`,
        ops: [
          {
            op: "add",
            ruleId: null,
            rule: {
              id: nextId(spec),
              name: `Guarantee: ${inv.description}`.slice(0, 80),
              appliesTo: inv.appliesTo,
              priority: Math.max(...spec.rules.map((r) => r.priority), 0),
              when: inv.when,
              then: [{ type: "recommend", level: inv.minLevel, reason: inv.description }],
            },
          },
        ],
      };
    }
    case "oscillation": {
      const last = rule(bug.ruleIds.at(-1)!);
      if (!last) return null;
      const kept = last.then.filter((a) => a.type !== "set");
      return {
        rationale: `${bug.ruleIds.join(", ")} keep undoing each other. Stop ${last.id} from writing state; keep its recommendation.`,
        ops: [
          {
            op: "replace",
            ruleId: last.id,
            rule: { ...last, then: kept.length ? kept : [{ type: "flag", code: "needs_review", severity: "warn" }] },
          },
        ],
      };
    }
    case "unknown_fact": {
      const r = rule(bug.ruleIds[0]!);
      if (!r) return null;
      const known = [...new Set(spec.objects.flatMap((o) => o.props.map((p) => p.key)))];
      let changed = false;
      const fix = (p: Rule["when"]["all"][number]) => {
        if (p.fact.startsWith("signal.") || p.fact === "clock.minutes" || known.includes(p.fact)) return p;
        const best = known.map((k) => ({ k, d: distance(k, p.fact) })).sort((a, b) => a.d - b.d)[0];
        if (!best || best.d > 3) return p;
        changed = true;
        return { ...p, fact: best.k };
      };
      const next = { ...r, when: { all: r.when.all.map(fix), any: r.when.any.map(fix) } };
      return changed
        ? { rationale: `${r.id} reads a field that doesn't exist (likely a typo). Point it at the closest real field.`, ops: [{ op: "replace", ruleId: r.id, rule: next }] }
        : null;
    }
    default:
      return null;
  }
}

function nextId(spec: TwinSpec): string {
  const n = Math.max(0, ...spec.rules.map((r) => Number(r.id.replace(/\D/g, "")) || 0));
  return `R${n + 1}`;
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}
