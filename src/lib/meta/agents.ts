import "server-only";
import { z } from "zod";
import { heuristicFix } from "@/engine/heuristics";
import type { TaggedScenario } from "@/engine/scenarios";
import { RuleDiff, Scenario, type TwinSpec } from "@/engine/schema";
import type { Bug } from "@/engine/sim";
import { applyDiff } from "@/engine/verify";
import { TEMPLATES } from "@/templates";
import { sparkJSON } from "./spark";

const ScenarioSet = z.object({ scenarios: z.array(Scenario).min(1).max(3) });

const SCENARIO_SYSTEM = `You are DockTwin's adversarial stress-test agent for digital twins.
Given a twin (objects, behavior rules, invariants) and the scenarios already planned, invent 2-3 NEW scenarios most likely to expose behavior bugs: sources that contradict each other, signals that arrive in an awkward order, values sitting exactly on rule thresholds, a fact the rules forget to check, a condition that clears while another is still active.

Scenario format:
- stateChanges: ground truth (what is physically true), {t, target, key, value}
- signals: claims from external sources that may be wrong, {t, source, target, key, value}. Sources: carrier, scale, customs, reefer_sensor, gate_ops, billing, sensor, user.
- t in minutes, multiples of tickMin, never beyond durationMin. Use durationMin 120 and tickMin 10.
- Only target object ids that exist in the twin. Use the signal keys the rules actually read (look at "signal.<source>.<key>" facts) so the scenario exercises them.
- ids "A1", "A2", "A3". The description says in one sentence what conflict is being tested and which rule you expect to misbehave.`;

export async function sparkScenarios(spec: TwinSpec, planned: TaggedScenario[]) {
  const ids = new Set(spec.objects.map((o) => o.id));
  const { data, call } = await sparkJSON({
    step: "stress agent: invent scenarios",
    schemaName: "ScenarioSet",
    schema: ScenarioSet,
    system: `${SCENARIO_SYSTEM}

${TEMPLATES[spec.domain].agentHints}`,
    user: JSON.stringify({
      twin: { objects: spec.objects, rules: spec.rules, invariants: spec.invariants },
      alreadyPlanned: planned.map((s) => `${s.name}: ${s.description}`),
    }),
    check: ({ scenarios }) => {
      const issues: string[] = [];
      for (const s of scenarios) {
        for (const e of [...s.signals, ...s.stateChanges]) {
          if (!ids.has(e.target)) issues.push(`${s.id}: unknown target "${e.target}"`);
          if (e.t > s.durationMin) issues.push(`${s.id}: event at t=${e.t} is after durationMin ${s.durationMin}`);
        }
        if (s.signals.length + s.stateChanges.length === 0) issues.push(`${s.id}: has no events`);
      }
      if (new Set(scenarios.map((s) => s.id)).size !== scenarios.length) issues.push("scenario ids must be unique");
      return issues;
    },
    // Offline mock adds nothing: the seeded generator already covers the basics.
    mock: () => ({ scenarios: [] as Scenario[] }) as z.infer<typeof ScenarioSet>,
    reasoningEffort: "low",
  });
  const scenarios: TaggedScenario[] = data.scenarios.map((s) => ({ ...s, origin: "muse-spark" }));
  return { scenarios, call };
}

const FIX_SYSTEM = `You are DockTwin's rule-repair agent. A deterministic simulation found a behavior bug in a digital twin's rules. Propose the smallest rule change that fixes it.

Constraints:
- Edit only rules (ops: add, replace, remove). Never weaken safety: do not delete or loosen rules that recommend hold/inspect/human unless that rule IS the bug.
- Prefer the gentlest effective action on the ladder: watch, ask, slow, reroute, inspect, hold, human.
- When sources disagree, trust direct physical measurement over self-reported claims.
- Keep existing rule ids when replacing; new rules take the next free id (R<n>).
- "replace" and "add" carry the complete rule. "remove" sets rule to null. "add" sets ruleId to null.
- The engine will re-run every scenario on your patched twin and reject the fix if the bug persists or a new critical bug appears.`;

export async function sparkFix(spec: TwinSpec, bug: Bug, scenario: TaggedScenario | undefined) {
  return sparkJSON({
    step: `fix agent: ${bug.kind.replace("_", " ")}`,
    schemaName: "RuleDiff",
    schema: RuleDiff,
    system: `${FIX_SYSTEM}

${TEMPLATES[spec.domain].agentHints}`,
    user: JSON.stringify({
      bug: { kind: bug.kind, message: bug.message, rules: bug.ruleIds, subject: bug.subject, invariant: bug.invariantId, firstT: bug.firstT },
      rules: spec.rules,
      invariants: spec.invariants,
      subjectObject: spec.objects.find((o) => o.id === bug.subject) ?? null,
      scenario: scenario
        ? {
            name: scenario.name,
            description: scenario.description,
            signals: scenario.signals.filter((s) => !bug.subject || s.target === bug.subject).slice(0, 20),
          }
        : null,
    }),
    check: (diff) => applyDiff(spec, diff).errors,
    mock: (): RuleDiff =>
      heuristicFix(spec, bug) ?? { rationale: "[MOCK] no heuristic fix for this bug kind", ops: [{ op: "remove", ruleId: "__none__", rule: null }] },
    reasoningEffort: "medium",
  });
}

const BoxLabels = z.object({
  labels: z.array(
    z.object({
      segment: z.string().describe("the segment id exactly as given"),
      code: z.string().nullable().describe("ISO 6346 container number if legible, e.g. MSCU1234565, else null"),
      reefer: z.boolean().nullable().describe("true if a refrigeration unit is visible, null if unsure"),
      color: z.string().nullable(),
    }),
  ),
});

/** Muse Spark vision: read what SAM's boxes contain (codes, reefer units, color). */
export async function sparkLabelBoxes(imageDataUrl: string, boxes: { id: string; box: { left: number; top: number; right: number; bottom: number } }[]) {
  const ids = new Set(boxes.map((b) => b.id));
  return sparkJSON({
    step: "vision: read boxes",
    schemaName: "BoxLabels",
    schema: BoxLabels,
    system:
      "You read shipping containers in a terminal photo. For each numbered pixel box (left,top,right,bottom) report the container number only if you can actually read it, whether a reefer unit is visible, and the dominant color. Never guess a code; use null.",
    user: [
      { type: "image_url", image_url: { url: imageDataUrl } },
      { type: "text", text: JSON.stringify(boxes.map((b) => ({ segment: b.id, box: [b.box.left, b.box.top, b.box.right, b.box.bottom].map(Math.round) }))) },
    ],
    check: ({ labels }) => labels.filter((l) => !ids.has(l.segment)).map((l) => `unknown segment "${l.segment}"`),
    mock: () => ({ labels: boxes.map((b, i) => ({ segment: b.id, code: i === 0 ? "MSCU1234565" : null, reefer: i === 0, color: null })) }),
    reasoningEffort: "low",
  });
}
