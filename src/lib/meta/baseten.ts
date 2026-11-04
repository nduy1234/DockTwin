import "server-only";
import OpenAI from "openai";
import type { z } from "zod";
import { jsonSchemaFor } from "@/engine/schema";
import { MIN_ATTEMPT_MS, REQUEST_TIMEOUT_MS } from "./budget";
import type { ModelCall } from "./callLog";
import { MetaConfigError } from "./client";
import { withRetry } from "./retry";
import { errorText, SparkError, validate } from "./spark";

/**
 * Muse Spark Open on Baseten: optional alternate provider for the stress
 * agent's scenario generation only. Off by default; enabled with
 * SCENARIO_PROVIDER=baseten plus BASETEN_API_KEY. Callers fall back to
 * Muse Spark on the Meta Model API whenever this is off or fails.
 */
export const BASETEN_SCENARIO_MODEL = "meta-models/muse-spark-open-1026";
export const BASETEN_DEFAULT_BASE_URL = "https://inference.baseten.co/v1";

export function basetenEnabled(): boolean {
  return process.env.SCENARIO_PROVIDER === "baseten" && !!process.env.BASETEN_API_KEY;
}

function basetenClient(): OpenAI {
  const apiKey = process.env.BASETEN_API_KEY;
  if (!apiKey) throw new MetaConfigError("BASETEN_API_KEY is not set (required when SCENARIO_PROVIDER=baseten).");
  return new OpenAI({
    baseURL: process.env.BASETEN_BASE_URL ?? BASETEN_DEFAULT_BASE_URL,
    apiKey,
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS,
  });
}

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Same contract as sparkJSON (deadline-bounded retries, zod validation,
 * schema-repair rounds) against Baseten's OpenAI-compatible endpoint.
 * `client` is injectable for tests; production uses basetenClient().
 */
export async function basetenJSON<T>(args: {
  step: string;
  schemaName: string;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  check?: (value: T) => string[];
  budgetMs: number;
  maxRepairs?: number;
  client?: OpenAI;
}): Promise<{ data: T; call: ModelCall }> {
  const started = Date.now();
  const call: ModelCall = {
    step: args.step,
    model: BASETEN_SCENARIO_MODEL,
    endpoint: "POST inference.baseten.co/v1/chat/completions (json_schema, Baseten)",
    ms: 0,
    attempts: 0,
    repaired: false,
    mock: false,
    ok: false,
  };

  const client = args.client ?? basetenClient();
  const messages: Msg[] = [
    { role: "system", content: args.system },
    { role: "user", content: args.user },
  ];
  const responseFormat = {
    type: "json_schema" as const,
    json_schema: { name: args.schemaName, schema: jsonSchemaFor(args.schema) },
  };
  const usage = { input: 0, output: 0 };
  const maxRepairs = args.maxRepairs ?? 2;
  const deadline = started + args.budgetMs;

  try {
    for (let round = 0; round <= maxRepairs; round++) {
      const res = await withRetry(
        (_, timeoutMs) =>
          client.chat.completions.create(
            { model: BASETEN_SCENARIO_MODEL, messages, response_format: responseFormat },
            { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) },
          ),
        { deadline, requestTimeoutMs: REQUEST_TIMEOUT_MS, minAttemptMs: MIN_ATTEMPT_MS, onAttempt: () => call.attempts++ },
      );
      usage.input += res.usage?.prompt_tokens ?? 0;
      usage.output += res.usage?.completion_tokens ?? 0;
      const raw = res.choices[0]?.message?.content ?? "";

      const issues = validate(raw, args.schema, args.check);
      if (issues.ok) {
        Object.assign(call, { ok: true, repaired: round > 0, usage, ms: Date.now() - started });
        return { data: issues.value, call };
      }
      messages.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content:
            "Your JSON failed validation:\n- " +
            issues.errors.join("\n- ") +
            "\nReturn the complete corrected JSON. Change only what is needed to fix these issues.",
        },
      );
    }
    throw new Error(`Baseten output still invalid after ${maxRepairs} repair rounds`);
  } catch (err) {
    Object.assign(call, { usage, ms: Date.now() - started, error: errorText(err) });
    throw new SparkError(errorText(err), call);
  }
}
