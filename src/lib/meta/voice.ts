import "server-only";
import type { ModelCall } from "./callLog";
import { apiKey, isMock, META_BASE_URL, MODELS } from "./client";
import { withRetry } from "./retry";
import { errorText } from "./spark";

/** One-shot endpoint, per the Muse Voice Transcribe cookbook recipe. */
const TRANSCRIBE_URL = `${META_BASE_URL}/asr/transcribe`;
export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

export class TranscribeError extends Error {
  constructor(
    message: string,
    readonly call: ModelCall,
  ) {
    super(message);
  }
}

/**
 * POST a mono 16-bit WAV. The request params travel as a JSON multipart part
 * named "request"; the audio as a part named "audio". Response:
 * { sessionId, transcript, audioDurationMs, turns? }.
 */
export async function transcribe(wav: Blob, keywords: string[]): Promise<{ text: string; durationMs: number; call: ModelCall }> {
  const started = Date.now();
  const call: ModelCall = {
    step: "voice → text",
    model: MODELS.transcribe,
    endpoint: "POST /v1/asr/transcribe",
    ms: 0,
    attempts: 0,
    repaired: false,
    mock: false,
    ok: false,
  };
  if (isMock()) {
    return {
      text: "[MOCK] Reefer box MSCU1234565 at Lane 4, plug at 4°C, customs hold possible.",
      durationMs: 0,
      call: { ...call, mock: true, ok: true, attempts: 1, ms: Date.now() - started },
    };
  }
  const key = apiKey();
  const request = {
    mode: "PUSH_TO_TALK",
    model: MODELS.transcribe,
    audioEncoding: "WAV",
    // Only send when set: the server silently ignores empty/unknown fields.
    ...(keywords.length ? { keywords } : {}),
  };

  try {
    const json = await withRetry(
      async () => {
        const form = new FormData();
        form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
        form.append("audio", wav, "speech.wav");
        const res = await fetch(TRANSCRIBE_URL, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw Object.assign(new Error(`transcribe failed: ${body.slice(0, 200) || res.statusText}`), { status: res.status });
        }
        return (await res.json()) as { transcript?: string; audioDurationMs?: number };
      },
      { onAttempt: () => call.attempts++ },
    );
    Object.assign(call, { ok: true, ms: Date.now() - started });
    return { text: (json.transcript ?? "").trim(), durationMs: json.audioDurationMs ?? 0, call };
  } catch (err) {
    Object.assign(call, { ms: Date.now() - started, error: errorText(err) });
    throw new TranscribeError(errorText(err), call);
  }
}
