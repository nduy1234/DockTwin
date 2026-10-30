import "server-only";
import type OpenAI from "openai";
import type { z } from "zod";
import { jsonSchemaFor } from "@/engine/schema";
import type { ModelCall } from "./callLog";
import { isMock, meta, MODELS } from "./client";
import { withRetry } from "./retry";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type UserContent = string | OpenAI.Chat.Completions.ChatCompletionContentPart[];

export class SparkError extends Error {
  constructor(
    message: string,
    readonly call: ModelCall,
  ) {
    super(message);
  }
}

/**
 * Ask Muse Spark for JSON that matches `schema`.
 *
 * Decoding is constrained server-side via response_format json_schema, then we
 * still zod-parse (belt and braces) and run `check` for semantic rules. Any
 * issues are fed back to the model for up to `maxRepairs` repair rounds.
 */
export async function sparkJSON<T>(args: {
  step: string;
  schemaName: string;
  schema: z.ZodType<T>;
  system: string;
  user: UserContent;
  check?: (value: T) => string[];
  mock: () => T;
  maxRepairs?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}): Promise<{ data: T; call: ModelCall }> {
  const started = Date.now();
  const call: ModelCall = {
    step: args.step,
    model: MODELS.spark,
    endpoint: "POST /v1/chat/completions (json_schema)",
    ms: 0,
    attempts: 0,
    repaired: false,
    mock: false,
    ok: false,
  };

  if (isMock()) {
    const data = args.mock();
    return { data, call: { ...call, mock: true, ok: true, attempts: 1, ms: Date.now() - started } };
  }

  const client = meta(); // throws MetaConfigError (not retried) when the key is missing
  const messages: Msg[] = [
    { role: "system", content: args.system },
    { role: "user", content: args.user } as Msg,
  ];
  const responseFormat = {
    type: "json_schema" as const,
    json_schema: { name: args.schemaName, schema: jsonSchemaFor(args.schema) },
  };
  const usage = { input: 0, output: 0 };
  const maxRepairs = args.maxRepairs ?? 2;

  try {
    for (let round = 0; round <= maxRepairs; round++) {
      const res = await withRetry(
        () =>
          client.chat.completions.create({
            model: MODELS.spark,
            messages,
            response_format: responseFormat,
            ...(args.reasoningEffort ? { reasoning_effort: args.reasoningEffort } : {}),
          }),
        { onAttempt: () => call.attempts++ },
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
    throw new Error(`Muse Spark output still invalid after ${maxRepairs} repair rounds`);
  } catch (err) {
    Object.assign(call, { usage, ms: Date.now() - started, error: errorText(err) });
    throw new SparkError(errorText(err), call);
  }
}

function validate<T>(
  raw: string,
  schema: z.ZodType<T>,
  check?: (v: T) => string[],
): { ok: true; value: T } | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["output was not valid JSON"] };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const semantic = check?.(parsed.data) ?? [];
  return semantic.length ? { ok: false, errors: semantic.slice(0, 20) } : { ok: true, value: parsed.data };
}

export function errorText(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { status?: number }).status;
    return status ? `${status}: ${err.message}` : err.message;
  }
  return String(err);
}
