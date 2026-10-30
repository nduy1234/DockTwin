import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkTwin, jsonSchemaFor, RuleDiff, Scenario, TwinSpec } from "@/engine/schema";
import { mockPortTwin } from "@/templates/port";

const sample = () => mockPortTwin("Reefer box MSCU1234565 at Lane 4, plug at 4°C, customs hold possible.");

/** Meta structured output counts object/array nesting; limit is 10. */
function depth(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const n = node as Record<string, unknown>;
  const own = n.type === "object" || n.type === "array" ? 1 : 0;
  let max = 0;
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) for (const x of v) max = Math.max(max, depth(x));
    else if (v && typeof v === "object") max = Math.max(max, depth(v));
  }
  return own + max;
}

describe("TwinSpec", () => {
  it("mock twin parses and passes semantic checks", () => {
    const spec = TwinSpec.parse(sample());
    expect(checkTwin(spec)).toEqual([]);
    expect(spec.objects.find((o) => o.kind === "container")?.id).toBe("MSCU1234565");
  });

  it("mock extracts lane and setpoint from text", () => {
    const spec = mockPortTwin("Reefer TGHU7654321 at lane 7 set to -18 C");
    expect(spec.objects.some((o) => o.id === "LANE-7")).toBe(true);
    const box = spec.objects.find((o) => o.id === "TGHU7654321");
    expect(box?.props.find((p) => p.key === "setpoint_c")?.value).toBe(-18);
  });

  it("checkTwin reports dangling refs, unknown signal sources, and missing values", () => {
    const spec = sample();
    spec.objects[0]!.attachedTo = "LANE-99";
    spec.rules[0]!.when.all.push({ of: "GHOST", fact: "signal.weather.wind", op: "gt", value: null });
    const issues = checkTwin(spec);
    expect(issues).toContain('object "MSCU1234565" attachedTo unknown id "LANE-99"');
    expect(issues.some((i) => i.includes('unknown object "GHOST"'))).toBe(true);
    expect(issues.some((i) => i.includes('unknown signal source "weather"'))).toBe(true);
    expect(issues.some((i) => i.includes("needs a value"))).toBe(true);
  });

  it("rejects unknown ladder levels and object kinds", () => {
    const spec = sample() as unknown as { objects: { kind: string }[] };
    spec.objects[0]!.kind = "spaceship";
    expect(TwinSpec.safeParse(spec).success).toBe(false);
  });

  it.each([
    ["TwinSpec", TwinSpec],
    ["RuleDiff", RuleDiff],
    ["ScenarioSet", z.object({ scenarios: z.array(Scenario) })],
  ] as const)("%s JSON Schema fits Meta structured-output limits", (_, schema) => {
    const js = jsonSchemaFor(schema);
    const text = JSON.stringify(js);
    expect(text).not.toContain('"$ref"'); // recursive schemas are rejected (HTTP 400)
    expect(js).not.toHaveProperty("$schema");
    expect(depth(js)).toBeLessThanOrEqual(10);
    expect(text.length).toBeLessThan(120_000);
  });
});
