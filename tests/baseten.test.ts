import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { z } from "zod";
import { demoTerminal } from "@/engine/demo";
import { sparkScenarios } from "@/lib/meta/agents";
import { BASETEN_SCENARIO_MODEL, basetenEnabled, basetenJSON } from "@/lib/meta/baseten";
import { MODELS } from "@/lib/meta/client";
import type { ModelCall } from "@/lib/meta/callLog";
import { SparkError } from "@/lib/meta/spark";

const ENV_KEYS = ["SCENARIO_PROVIDER", "BASETEN_API_KEY", "MOCK_META"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllEnvs();
});

describe("baseten provider selection", () => {
  it("is off by default", () => {
    delete process.env.SCENARIO_PROVIDER;
    delete process.env.BASETEN_API_KEY;
    expect(basetenEnabled()).toBe(false);
  });

  it("stays off when the flag is on but the key is missing", () => {
    process.env.SCENARIO_PROVIDER = "baseten";
    delete process.env.BASETEN_API_KEY;
    expect(basetenEnabled()).toBe(false);
  });

  it("stays off when the key exists but the flag is not baseten", () => {
    delete process.env.SCENARIO_PROVIDER;
    process.env.BASETEN_API_KEY = "test-key";
    expect(basetenEnabled()).toBe(false);
  });

  it("turns on only with flag + key", () => {
    process.env.SCENARIO_PROVIDER = "baseten";
    process.env.BASETEN_API_KEY = "test-key";
    expect(basetenEnabled()).toBe(true);
  });
});

const Echo = z.object({ value: z.string() });

function fakeClient(content: string | Error) {
  const create = vi.fn(async () => {
    if (content instanceof Error) throw content;
    return {
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
  });
  return { chat: { completions: { create } } };
}

describe("basetenJSON", () => {
  it("parses validated JSON and logs the Baseten model id", async () => {
    const client = fakeClient(JSON.stringify({ value: "ok" }));
    const { data, call } = await basetenJSON({
      step: "test",
      schemaName: "Echo",
      schema: Echo,
      system: "sys",
      user: "usr",
      budgetMs: 5_000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    });
    expect(data).toEqual({ value: "ok" });
    expect(call.model).toBe(BASETEN_SCENARIO_MODEL);
    expect(call.model).toBe("meta-models/muse-spark-open-1026");
    expect(call.ok).toBe(true);
    expect(call.mock).toBe(false);
    expect(call.attempts).toBe(1);
  });

  it("fails loudly (SparkError with failed call record) when Baseten errors", async () => {
    const err = Object.assign(new Error("HTTP 500"), { status: 500 });
    const client = fakeClient(err);
    const caught = await basetenJSON({
      step: "test",
      schemaName: "Echo",
      schema: Echo,
      system: "sys",
      user: "usr",
      budgetMs: 10_000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    }).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(SparkError);
    const call = (caught as SparkError).call;
    expect(call.model).toBe(BASETEN_SCENARIO_MODEL);
    expect(call.ok).toBe(false);
    expect(call.error).toContain("500");
    expect(call.attempts).toBeGreaterThan(0);
  });
});

const fakeCall = (model: string, ok: boolean): ModelCall => ({
  step: "stress agent: invent scenarios",
  model,
  endpoint: "test",
  ms: 1,
  attempts: 1,
  repaired: false,
  mock: false,
  ok,
  ...(ok ? {} : { error: "boom" }),
});

describe("sparkScenarios provider routing", () => {
  it("uses Muse Spark when Baseten is off", async () => {
    delete process.env.SCENARIO_PROVIDER;
    delete process.env.BASETEN_API_KEY;
    const baseten = vi.fn();
    const spark = vi.fn(async () => ({ scenarios: [], call: fakeCall(MODELS.spark, true) }));
    const r = await sparkScenarios(demoTerminal(), [], { baseten, spark });
    expect(baseten).not.toHaveBeenCalled();
    expect(spark).toHaveBeenCalledOnce();
    expect(r.call.model).toBe(MODELS.spark);
    expect(r.calls).toHaveLength(1);
  });

  it("tags scenarios baseten when Baseten succeeds", async () => {
    process.env.SCENARIO_PROVIDER = "baseten";
    process.env.BASETEN_API_KEY = "test-key";
    delete process.env.MOCK_META;
    const scenario = {
      id: "A1",
      name: "Baseten scenario",
      description: "conflict",
      durationMin: 120,
      tickMin: 10,
      stateChanges: [{ t: 0, target: "MSCU7154023", key: "weight_t", value: 24 }],
      signals: [],
      expectations: [{ subject: "MSCU7154023", minLevel: "inspect", byT: 60, why: "test" }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseten = vi.fn(async () => ({ scenarios: [{ ...scenario, origin: "baseten" } as any], call: fakeCall(BASETEN_SCENARIO_MODEL, true) }));
    const spark = vi.fn();
    const r = await sparkScenarios(demoTerminal(), [], { baseten, spark });
    expect(spark).not.toHaveBeenCalled();
    expect(r.scenarios[0]?.origin).toBe("baseten");
    expect(r.call.model).toBe(BASETEN_SCENARIO_MODEL);
  });

  it("falls back to Muse Spark when the Baseten call fails, logging both calls", async () => {
    process.env.SCENARIO_PROVIDER = "baseten";
    process.env.BASETEN_API_KEY = "test-key";
    delete process.env.MOCK_META;
    const baseten = vi.fn(async () => {
      throw new SparkError("500: boom", fakeCall(BASETEN_SCENARIO_MODEL, false));
    });
    const spark = vi.fn(async () => ({ scenarios: [], call: fakeCall(MODELS.spark, true) }));
    const r = await sparkScenarios(demoTerminal(), [], { baseten, spark });
    expect(spark).toHaveBeenCalledOnce();
    expect(r.call.model).toBe(MODELS.spark);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[0]).toMatchObject({ model: BASETEN_SCENARIO_MODEL, ok: false });
    expect(r.calls[1]).toMatchObject({ model: MODELS.spark, ok: true });
  });
});
