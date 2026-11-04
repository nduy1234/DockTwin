/**
 * Decision ladder: for each box, the gentlest action that is still effective,
 * with the evidence that makes it verifiable.
 *
 *  - Rules propose a level (deterministic, from the sim tick).
 *  - Active invariants set a safety floor; the decision never goes below it.
 *  - Confidence = trust of the weakest signal the deciding rule relied on,
 *    discounted for unresolved contradictions and for a level that just changed.
 *  - The port safety policy sets a floor no rule, invariant, or fix can lower.
 *  - Decisions are advisory. Approval is required for high-impact or
 *    low-confidence actions and whenever the safety policy is active.
 */
import { costOfDelay, type CostEstimate } from "./cost";
import { evalCondition, makeCtx, resolveSubject, subjectsOf, type SignalStore } from "./dsl";
import { stateAt } from "./replay";
import type { SafetyFinding } from "./safety";
import { LADDER, type LadderLevel, type Scenario, type TwinSpec } from "./schema";
import { levelIndex, type SimResult, type TickRecord } from "./sim";
import { trustedSignals, type Conflict, type SignalView } from "./trust";

export const POLICY = {
  minConfidence: 0.7,
  highImpact: ["reroute", "inspect", "hold", "human"] as LadderLevel[],
  maxAutoActionUsd: 1500,
};

/** Trust assumed for facts read from twin state (ground truth / derived by rules). */
const STATE_TRUST = 0.95;

export type LadderStep = { level: LadderLevel; status: "insufficient" | "chosen" | "stronger" };

export type Decision = {
  subject: string;
  t: number;
  level: LadderLevel;
  ruleLevel: LadderLevel | null;
  floor: { level: LadderLevel; invariantId: string; description: string } | null;
  ladder: LadderStep[];
  confidence: number;
  confidenceWhy: string[];
  cost: CostEstimate;
  approval: { required: boolean; reasons: string[] };
  evidence: {
    scenarioId: string;
    firings: { ruleId: string; level: LadderLevel; reason: string; inputs: string[] }[];
    signals: SignalView[];
    conflicts: Conflict[];
    /** Active safety policies, each with the observations behind it. */
    safety: SafetyFinding[];
    stableTicks: number;
    peak: LadderLevel | null;
  };
};

export function decideAt(spec: TwinSpec, scenario: Scenario, result: SimResult, tickIdx: number): Decision[] {
  const tick = result.ticks[tickIdx];
  if (!tick) return [];
  const state = stateAt(spec, result, tickIdx);
  const signalsStore: SignalStore = {};
  for (const s of scenario.signals) {
    if (s.t > tick.t) continue;
    const slot = (signalsStore[s.target] ??= {});
    const k = `${s.source}.${s.key}`;
    if (!slot[k] || slot[k]!.t <= s.t) slot[k] = { value: s.value, t: s.t };
  }
  const ctx = makeCtx(spec, state, signalsStore, tick.t);

  const subjects = new Set(Object.keys(tick.levels));
  for (const inv of spec.invariants) for (const s of subjectsOf(spec, inv.appliesTo)) if (evalCondition(ctx, inv.when, s)) subjects.add(s);
  for (const s of Object.keys(tick.safety)) subjects.add(s);

  const out: Decision[] = [];
  for (const subject of subjects) {
    const props = state[subject] ?? {};
    const ruleLevel = tick.levels[subject] ?? null;

    let floor: Decision["floor"] = null;
    for (const inv of spec.invariants) {
      if (!subjectsOf(spec, inv.appliesTo).includes(subject) || !evalCondition(ctx, inv.when, subject)) continue;
      if (!floor || levelIndex(inv.minLevel) > levelIndex(floor.level)) {
        floor = { level: inv.minLevel, invariantId: inv.id, description: inv.description };
      }
    }
    const safety = tick.safety[subject] ?? [];
    for (const f of safety) {
      if (!floor || levelIndex(f.minLevel) > levelIndex(floor.level)) {
        floor = { level: f.minLevel, invariantId: f.policyId, description: f.description };
      }
    }
    const level: LadderLevel = levelIndex(floor?.level) > levelIndex(ruleLevel) ? floor!.level : (ruleLevel ?? "watch");

    const { signals, conflicts } = trustedSignals(spec, scenario, subject, tick.t, props);
    const trustOf = (target: string, fact: string) => {
      const key = fact.slice("signal.".length);
      return signals.find((s) => s.target === target && `${s.source}.${s.key}` === key);
    };

    const firings: Decision["evidence"]["firings"] = [];
    for (const f of tick.fired.filter((x) => x.subject === subject)) {
      const rule = spec.rules.find((r) => r.id === f.ruleId);
      if (!rule) continue;
      const inputs = [...rule.when.all, ...rule.when.any]
        .filter((p) => p.fact !== "clock.minutes") // the clock is not evidence
        .map((p) => `${resolveSubject(ctx, p.of, subject) ?? p.of}:${p.fact}`);
      for (const a of rule.then) if (a.type === "recommend") firings.push({ ruleId: rule.id, level: a.level, reason: a.reason, inputs });
    }

    // Confidence: weakest input of the rules that set the chosen level.
    const why: string[] = [];
    const deciding = firings.filter((f) => f.level === level);
    let conf = STATE_TRUST;
    if (deciding.length === 0) {
      why.push(floor ? `level set by safety floor ${floor.invariantId}, not by a rule` : "no rule fired; default watch");
      conf = floor ? 0.8 : STATE_TRUST;
    } else {
      // Best-supported deciding rule counts: one solid reason is enough.
      let best = 0;
      let bestWhy = "";
      for (const f of deciding) {
        let weakest = STATE_TRUST;
        let weakestWhy = `${f.ruleId} reads twin state only (trust ${STATE_TRUST})`;
        for (const input of f.inputs) {
          const [target, fact] = input.split(":") as [string, string];
          if (!fact.startsWith("signal.")) continue;
          const s = trustOf(target, fact);
          if (s && s.trust < weakest) {
            weakest = s.trust;
            weakestWhy = `${f.ruleId} relies on ${s.source}.${s.key}=${String(s.value)} (trust ${s.trust.toFixed(2)})`;
          }
        }
        if (weakest > best) {
          best = weakest;
          bestWhy = weakestWhy;
        }
      }
      conf = best;
      why.push(bestWhy);
    }
    if (conflicts.length) {
      conf *= 0.9;
      why.push(`${conflicts.length} contradiction${conflicts.length > 1 ? "s" : ""} between sources resolved by trust (×0.90)`);
    }
    let stable = 0;
    for (let i = tickIdx; i >= 0 && (result.ticks[i]!.levels[subject] ?? null) === ruleLevel; i--) stable++;
    if (stable < 2) {
      conf *= 0.9;
      why.push("level changed this tick (×0.90)");
    }
    conf = +conf.toFixed(2);

    const laneId = spec.objects.find((o) => o.id === subject)?.attachedTo;
    const num = (v: unknown) => (typeof v === "number" ? v : undefined);
    const sig = (key: string) => signals.find((s) => s.target === subject && s.key === key && s.trust >= 0.5)?.value;
    const cost = costOfDelay(level, {
      props,
      tempC: num(sig("temp_c")) ?? num(props.temp_c),
      freeMinutesLeft: num(sig("free_minutes_left")) ?? num(props.free_minutes_left),
      laneDown: laneId ? state[laneId]?.status === "down" : false,
    });

    const reasons: string[] = [];
    if (POLICY.highImpact.includes(level)) reasons.push(`${level} is a high-impact action`);
    if (conf < POLICY.minConfidence) reasons.push(`confidence ${conf.toFixed(2)} < ${POLICY.minConfidence}`);
    if (cost.actionUsd >= POLICY.maxAutoActionUsd) reasons.push(`estimated cost $${cost.actionUsd.toLocaleString("en-US")} ≥ $${POLICY.maxAutoActionUsd.toLocaleString("en-US")}`);
    if (floor && levelIndex(floor.level) > levelIndex(ruleLevel)) reasons.push(`rules under-reacted; raised to safety floor (${floor.invariantId})`);
    for (const f of safety) reasons.push(`safety policy ${f.policyId} is active`);
    if (result.bugs.some((b) => b.kind === "conflict" && b.subject === subject && (b.firstT ?? 0) <= tick.t)) reasons.push("rules conflict on this box");
    if (props.gate_route === "fast_lane" && levelIndex(level) >= levelIndex("inspect")) reasons.push(`rules route this box to fast_lane while the action is ${level}`);

    out.push({
      subject,
      t: tick.t,
      level,
      ruleLevel,
      floor,
      ladder: LADDER.map((l) => ({
        level: l,
        status: l === level ? "chosen" : levelIndex(l) < levelIndex(level) ? "insufficient" : "stronger",
      })),
      confidence: conf,
      confidenceWhy: why,
      cost,
      approval: { required: reasons.length > 0, reasons },
      evidence: { scenarioId: scenario.id, firings, signals, conflicts, safety, stableTicks: stable, peak: result.outcomes[subject]?.peak ?? null },
    });
  }
  return out.sort((a, b) => levelIndex(b.level) - levelIndex(a.level) || a.confidence - b.confidence || a.subject.localeCompare(b.subject));
}

/** What the twin shows per object: final decision levels at a port, raw rule levels in creator mode. */
export function displayLevels(spec: TwinSpec, tick: TickRecord | undefined, decisions: Decision[]): Record<string, LadderLevel> {
  if (spec.domain !== "port") return tick?.levels ?? {};
  return { ...tick?.levels, ...Object.fromEntries(decisions.map((d) => [d.subject, d.level])) };
}

/** Levels a planner may override to: never below an active safety policy. */
export function overrideOptions(d: Decision): LadderLevel[] {
  const min = Math.max(-1, ...d.evidence.safety.map((f) => levelIndex(f.minLevel)));
  return LADDER.filter((l) => l !== d.level && l !== "human" && levelIndex(l) >= min);
}
