import "server-only";
import OpenAI from "openai";

/** Exact values from https://dev.meta.ai/docs/models and the cookbook. */
export const META_BASE_URL = "https://api.meta.ai/v1";
export const MODELS = {
  spark: "muse-spark-1.3",
  sam: "sam-3.1",
  transcribe: "muse-voice-transcribe-1.0",
} as const;
export type MetaModel = (typeof MODELS)[keyof typeof MODELS];

export class MetaConfigError extends Error {}

/**
 * Mock mode is opt-in (MOCK_META=1), local dev only. It is refused on a Vercel
 * production deploy so the live demo can never silently fall back to canned data.
 */
export function isMock(): boolean {
  const on = process.env.MOCK_META === "1";
  if (on && process.env.VERCEL_ENV === "production") {
    throw new MetaConfigError("MOCK_META=1 is not allowed in production. Unset it and provide MODEL_API_KEY.");
  }
  return on;
}

export function apiKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) {
    throw new MetaConfigError(
      "MODEL_API_KEY is not set. Add it to .env.local (see .env.example), or set MOCK_META=1 for offline local dev.",
    );
  }
  return key;
}

let cached: OpenAI | null = null;

/** The OpenAI SDK does not auto-read MODEL_API_KEY, so pass it explicitly. */
export function meta(): OpenAI {
  // SDK retries off: lib/meta/retry.ts owns backoff so attempts are logged.
  cached ??= new OpenAI({ baseURL: META_BASE_URL, apiKey: apiKey(), maxRetries: 0, timeout: 90_000 });
  return cached;
}
