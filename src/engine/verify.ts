/**
 * Apply a proposed rule diff to a copy of the twin and prove (or disprove) it
 * by re-running every scenario. The model proposes; this decides.
 */
import { formatRule } from "./format";
import { checkTwin, LADDER, type Rule, type RuleDiff, type Scenario, type TwinSpec } from "./schema";
import { runScenario, type Bug, type SimResult } from "./sim";

export function applyDiff(spec: TwinSpec, diff: RuleDiff): { spec: TwinSpec; errors: string[] } {
  const rules = [...spec.rules];
  const errors: string[] = [];
  for (const [i, op] of diff.ops.entries()) {
    const at = op.ruleId ? rules.findIndex((r) => r.id === op.ruleId) : -1;
    if (op.op === "add") {
      if (!op.rule) errors.push(`op ${i}: add needs a rule`);
      else if (rules.some((r) => r.id === op.rule!.id)) errors.push(`op ${i}: rule id ${op.rule.id} already exists`);
      else rules.push(op.rule);
    } else if (op.op === "replace") {
      if (at < 0) errors.push(`op ${i}: no rule ${op.ruleId} to replace`);
      else if (!op.rule) errors.push(`op ${i}: replace needs a rule`);
      else rules[at] = op.rule;
    } else {
      if (at < 0) errors.push(`op ${i}: no rule ${op.ruleId} to remove`);
      else rules.splice(at, 1);
    }
  }
  const next = { ...spec, rules };
  return { spec: next, errors: [...errors, ...checkTwin(next)] };
}

export type DiffLine = { sign: "+" | "-" | " "; text: string };

/** Human-readable before/after of the changed rules. */
export function diffLines(spec: TwinSpec, diff: RuleDiff): DiffLine[] {
  const lines: DiffLine[] = [];
  const show = (sign: DiffLine["sign"], r: Rule) => {
    const f = formatRule(r);
    lines.push({ sign, text: `${r.id} ${r.name} (p${r.priority})` });
    lines.push({ sign, text: `  WHEN ${f.when}` });
    for (const t of f.then) lines.push({ sign, text: `  THEN ${t}` });
  };
  for (const op of diff.ops) {
    const old = op.ruleId ? spec.rules.find((r) => r.id === op.ruleId) : undefined;
    if (old && op.op !== "add") show("-", old);
    if (op.rule && op.op !== "remove") show("+", op.rule);
  }
  return lines;
}

export type Verdict = "verified" | "needs_review" | "rejected";

export type Verification = {
  verdict: Verdict;
  targetFixed: boolean;
  applyErrors: string[];
  resolved: string[]; // bug keys gone after the fix
  introduced: Bug[]; // critical/warn bugs that only exist after the fix
  weakened: { scenarioId: string; subject: string; before: string; after: string }[];
  scenariosRun: number;
  after: SimResult[];
};

const serious = (b: Bug) => b.severity !== "info";

export function verifyFix(
  spec: TwinSpec,
  scenarios: Scenario[],
  before: SimResult[],
  diff: RuleDiff,
  targetKey: string,
): Verification & { spec: TwinSpec } {
  const applied = applyDiff(spec, diff);
  if (applied.errors.length) {
    return {
      verdict: "rejected",
      targetFixed: false,
      applyErrors: applied.errors,
      resolved: [],
      introduced: [],
      weakened: [],
      scenariosRun: 0,
      after: [],
      spec,
    };
  }
  const after = scenarios.map((s) => runScenario(applied.spec, s));
  const keys = (rs: SimResult[]) => new Set(rs.flatMap((r) => r.bugs.filter(serious).map((b) => b.key)));
  const beforeKeys = keys(before);
  const afterKeys = keys(after);
  const introduced = dedupe(after.flatMap((r) => r.bugs.filter((b) => serious(b) && !beforeKeys.has(b.key))));
  const resolved = [...beforeKeys].filter((k) => !afterKeys.has(k));
  const targetFixed = !afterKeys.has(targetKey);

  // A fix that silences a bug by making the twin react 2+ ladder steps more
  // gently somewhere is suspicious: it may just have deleted the safety logic.
  const weakened: Verification["weakened"] = [];
  for (const [i, b] of before.entries()) {
    const a = after[i]!;
    for (const [subject, o] of Object.entries(b.outcomes)) {
      const was = LADDER.indexOf(o.peak!);
      const now = a.outcomes[subject]?.peak ? LADDER.indexOf(a.outcomes[subject]!.peak!) : -1;
      if (was - now >= 2) weakened.push({ scenarioId: b.scenarioId, subject, before: o.peak!, after: a.outcomes[subject]?.peak ?? "none" });
    }
  }

  const verdict: Verdict = !targetFixed || introduced.some((b) => b.severity === "critical")
    ? "rejected"
    : introduced.length || weakened.length
      ? "needs_review"
      : "verified";
  return { verdict, targetFixed, applyErrors: [], resolved, introduced, weakened, scenariosRun: scenarios.length, after, spec: applied.spec };
}

function dedupe(bugs: Bug[]): Bug[] {
  const m = new Map<string, Bug>();
  for (const b of bugs) if (!m.has(b.key)) m.set(b.key, b);
  return [...m.values()];
}

/** Unique serious bugs across scenarios, most severe and earliest first. */
export function topBugs(results: SimResult[], limit = 4): (Bug & { scenarioId: string })[] {
  const m = new Map<string, Bug & { scenarioId: string }>();
  for (const r of results) for (const b of r.bugs) if (serious(b) && !m.has(b.key)) m.set(b.key, { ...b, scenarioId: r.scenarioId });
  const rank = { critical: 2, warn: 1, info: 0 } as const;
  return [...m.values()].sort((a, b) => rank[b.severity] - rank[a.severity]).slice(0, limit);
}
