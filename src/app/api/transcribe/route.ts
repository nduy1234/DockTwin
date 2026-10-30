import { NextResponse } from "next/server";
import { MetaConfigError } from "@/lib/meta/client";
import { MAX_AUDIO_BYTES, transcribe, TranscribeError } from "@/lib/meta/voice";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Domain words Muse Voice Transcribe should not mis-hear. */
const BASE_KEYWORDS = ["reefer", "customs hold", "gate lane", "TEU", "demurrage", "setpoint", "chassis", "MSCU", "MAEU", "CMAU"];

/** Voice -> text with Muse Voice Transcribe. Expects multipart { audio: WAV, keywords?: string }. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size < 44) return NextResponse.json({ error: "Expected a WAV file in field 'audio'" }, { status: 400 });
  if (audio.size > Math.min(MAX_AUDIO_BYTES, 10 * 1024 * 1024)) return NextResponse.json({ error: "Recording too large" }, { status: 413 });
  const header = new Uint8Array(await audio.slice(0, 12).arrayBuffer());
  const tag = (o: number) => String.fromCharCode(...header.slice(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return NextResponse.json({ error: "Audio must be WAV" }, { status: 415 });

  const extra = String(form?.get("keywords") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  try {
    const r = await transcribe(audio, [...new Set([...BASE_KEYWORDS, ...extra])]);
    return NextResponse.json({ text: r.text, durationMs: r.durationMs, calls: [r.call] });
  } catch (err) {
    if (err instanceof MetaConfigError) return NextResponse.json({ error: err.message, calls: [] }, { status: 503 });
    if (err instanceof TranscribeError) return NextResponse.json({ error: `Muse Voice Transcribe failed: ${err.message}`, calls: [err.call] }, { status: 502 });
    throw err;
  }
}
