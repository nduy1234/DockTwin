"use client";

import { useRef, useState } from "react";
import type { ModelCall } from "@/lib/meta/callLog";
import { blobToTranscribeWav } from "@/lib/wav";

const MAX_SECONDS = 60;

/** Click to talk, click to stop. Speech -> Muse Voice Transcribe -> text. */
export function MicButton({ onText, onCalls }: { onText: (text: string, calls: ModelCall[]) => void; onCalls: (calls: ModelCall[]) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearTimeout(timer.current);
        setState("transcribing");
        try {
          const wav = await blobToTranscribeWav(new Blob(chunks, { type: r.mimeType }));
          const form = new FormData();
          form.append("audio", wav, "speech.wav");
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const json = await res.json();
          if (json.calls?.length) onCalls(json.calls);
          if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
          if (json.text) onText(json.text, json.calls ?? []);
          else setError("No speech detected");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setState("idle");
        }
      };
      rec.current = r;
      r.start();
      setState("recording");
      timer.current = setTimeout(() => r.state === "recording" && r.stop(), MAX_SECONDS * 1000);
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "Microphone permission denied" : String(e));
      setState("idle");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => (state === "recording" ? rec.current?.stop() : state === "idle" && start())}
        disabled={state === "transcribing"}
        aria-label={state === "recording" ? "Stop recording" : "Speak the description"}
        className={`rounded-md px-3 py-2 text-sm ring-1 disabled:opacity-50 ${
          state === "recording" ? "animate-pulse bg-rust/20 text-rust ring-rust" : "text-sand/80 ring-navy-3 hover:bg-navy"
        }`}
      >
        {state === "recording" ? "● Stop" : state === "transcribing" ? "Transcribing…" : "🎙 Speak"}
      </button>
      {error && <span className="text-xs text-rust">{error}</span>}
    </span>
  );
}
