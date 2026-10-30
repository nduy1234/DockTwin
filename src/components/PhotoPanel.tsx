"use client";

import { useState } from "react";
import type { Segment } from "@/engine/photo";
import type { TwinObject } from "@/engine/schema";
import type { ModelCall } from "@/lib/meta/callLog";

const SAMPLES = [
  { src: "/samples/gate-staten-island.jpg", label: "Terminal gate" },
  { src: "/samples/yard-port-elizabeth.jpg", label: "Yard aerial" },
  { src: "/samples/stack-colored.jpg", label: "Box stack" },
];
const CONCEPT_COLOR: Record<string, string> = { "shipping container": "#d9622b", crane: "#d9a42b", "road lane": "#6f8fa6" };
const MAX_SIDE = 1280;

type Result = { url: string; width: number; height: number; segments: Segment[]; objects: TwinObject[]; warnings: string[]; calls: ModelCall[] };

/** Load any image, downscale to <= 1280 px, and return a JPEG data URL. */
async function toDataUrl(src: string): Promise<{ url: string; width: number; height: number }> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  // onload, not img.decode(): decode() can stall indefinitely in embedded/background views.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Image took too long to load")), 15_000);
    img.onload = () => (clearTimeout(timer), resolve());
    img.onerror = () => (clearTimeout(timer), reject(new Error("Could not read that image")));
    img.src = src;
  });
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * k);
  const height = Math.round(img.naturalHeight * k);
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
  return { url: canvas.toDataURL("image/jpeg", 0.85), width, height };
}

export function PhotoPanel({ onSeed, onCalls }: { onSeed: (objects: TwinObject[], source: string, calls: ModelCall[]) => void; onCalls: (c: ModelCall[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [name, setName] = useState("");

  async function analyze(src: string, label: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    setName(label);
    try {
      const { url, width, height } = await toDataUrl(src);
      const res = await fetch("/api/segment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: url, width, height }),
      });
      const json = await res.json();
      if (json.calls?.length) onCalls(json.calls);
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult({ url, width, height, segments: json.segments, objects: json.objects, warnings: json.warnings ?? [], calls: json.calls ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const counts = result
    ? Object.entries(
        result.segments.reduce<Record<string, number>>((m, s) => ({ ...m, [s.concept]: (m[s.concept] ?? 0) + 1 }), {}),
      )
    : [];
  const boxes = result?.objects.filter((o) => o.kind === "container") ?? [];
  const read = boxes.filter((o) => /^[A-Z]{4}\d{7}$/.test(o.id)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {SAMPLES.map((s) => (
          <button
            key={s.src}
            onClick={() => analyze(s.src, s.label)}
            disabled={busy}
            className="group relative h-16 w-24 overflow-hidden rounded-md ring-1 ring-navy-3 hover:ring-rust disabled:opacity-50"
            title={`Segment the ${s.label.toLowerCase()} sample`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.src} alt={s.label} className="h-full w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-navy/80 text-[10px]">{s.label}</span>
          </button>
        ))}
        <label className={`cursor-pointer rounded-md px-3 py-2 text-sm ring-1 ring-navy-3 hover:bg-navy ${busy ? "pointer-events-none opacity-50" : ""}`}>
          Upload photo…
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void analyze(URL.createObjectURL(f), f.name);
              e.target.value = "";
            }}
          />
        </label>
        {busy && <span className="animate-pulse text-xs text-sand/60">SAM 3.1 is segmenting {name.toLowerCase()}…</span>}
        {error && <span className="text-xs text-rust">{error}</span>}
      </div>

      {result && (
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <div className="relative overflow-hidden rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.url} alt={`${name} with SAM 3.1 segments`} className="block w-full" />
            <svg viewBox={`0 0 ${result.width} ${result.height}`} className="absolute inset-0 h-full w-full" aria-hidden>
              {result.segments.map((s) => {
                const c = CONCEPT_COLOR[s.concept] ?? "#f4f1ea";
                const w = s.box.right - s.box.left;
                const h = s.box.bottom - s.box.top;
                return (
                  <g key={s.objectId}>
                    {s.mask && (
                      <path
                        d={s.mask.path}
                        transform={`translate(${s.box.left} ${s.box.top}) scale(${w / s.mask.width} ${h / s.mask.height})`}
                        fill={c}
                        fillOpacity={0.35}
                        fillRule="evenodd"
                      />
                    )}
                    <rect x={s.box.left} y={s.box.top} width={w} height={h} fill="none" stroke={c} strokeWidth={Math.max(1.5, result.width / 500)} />
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-1 text-xs">
              {counts.map(([concept, n]) => (
                <span key={concept} className="rounded px-1.5 py-0.5 text-white" style={{ background: CONCEPT_COLOR[concept] }}>
                  {n} × {concept}
                </span>
              ))}
              {counts.length === 0 && <span className="text-sand/50">SAM found nothing it recognised.</span>}
            </div>
            <p className="text-xs text-sand/60">
              {boxes.length} container{boxes.length === 1 ? "" : "s"} → twin objects
              {read > 0 && `, ${read} code${read > 1 ? "s" : ""} read by Muse Spark vision`}.
            </p>
            {result.warnings.map((w, i) => (
              <p key={i} className="text-xs text-warn">
                {w}
              </p>
            ))}
            <button
              onClick={() => onSeed(result.objects, name, result.calls)}
              disabled={result.objects.length === 0}
              className="rounded-md bg-rust px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Seed twin with {result.objects.length} object{result.objects.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
