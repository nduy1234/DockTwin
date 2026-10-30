import type { Action, Condition, Predicate, Rule } from "./schema";

const OPS: Record<Predicate["op"], string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "in",
  exists: "exists",
  missing: "missing",
};

export function formatPredicate(p: Predicate): string {
  const subject = p.of === "self" ? p.fact : `${p.of}.${p.fact}`;
  if (p.op === "exists" || p.op === "missing") return `${subject} ${OPS[p.op]}`;
  const v = Array.isArray(p.value) ? `[${p.value.join(", ")}]` : JSON.stringify(p.value);
  return `${subject} ${OPS[p.op]} ${v}`;
}

export function formatCondition(c: Condition): string {
  const parts: string[] = [];
  if (c.all.length) parts.push(c.all.map(formatPredicate).join(" AND "));
  if (c.any.length) parts.push(`(${c.any.map(formatPredicate).join(" OR ")})`);
  return parts.join(" AND ");
}

export function formatAction(a: Action): string {
  switch (a.type) {
    case "set":
      return `set ${a.key} = ${JSON.stringify(a.value)}`;
    case "flag":
      return `flag ${a.code} (${a.severity})`;
    case "recommend":
      return `recommend ${a.level.toUpperCase()} — ${a.reason}`;
  }
}

export function formatRule(r: Rule): { when: string; then: string[] } {
  return { when: formatCondition(r.when), then: r.then.map(formatAction) };
}
