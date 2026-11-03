/**
 * Live smoke test: calls every API route against a running DockTwin with real
 * Meta models and fails loudly on any error, mocked call, or fallback.
 *
 *   npm run dev -- --port 3100          # in another terminal (MOCK_META unset)
 *   npx tsx scripts/smoke.ts            # BASE_URL defaults to http://localhost:3100
 *   BASE_URL=https://<deploy> npx tsx scripts/smoke.ts
 *   SMOKE_WAV=path/to/speech.wav npx tsx scripts/smoke.ts   # optional real speech
 *
 * Never prints secrets: it only talks to the app, which holds the key server-side.
 */
import fs from "node:fs";
import path from "node:path";
import { decideAt } from "@/engine/decide";
import { DEMO_DESCRIPTION, demoTerminal, PROBLEM_BOX } from "@/engine/demo";
import type { TwinSpec } from "@/engine/schema";
import { encodeWav } from "@/lib/wav";
import type { FixResponse, StressResponse } from "@/lib/api-types";
import type { ModelCall } from "@/lib/meta/callLog";

const BASE = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const ROOT = path.resolve(__dirname, "..");

type Row = { route: string; status: number; seconds: number; models: string; mock: string; ok: boolean; note: string };
const rows: Row[] = [];

async function call<T>(route: string, init: RequestInit): Promise<{ status: number; json: T & { calls?: ModelCall[]; error?: string }; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${route}`, { ...init, signal: AbortSignal.timeout(300_000) });
  const text = await res.text();
  let json: T & { calls?: ModelCall[]; error?: string };
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: `non-JSON response: ${text.slice(0, 120)}` } as T & { error: string };
  }
  return { status: res.status, json, ms: Date.now() - t0 };
}

function record(route: string, status: number, ms: number, calls: ModelCall[] = [], extra: { ok?: boolean; note?: string } = {}) {
  const mocked = calls.some((c) => c.mock);
  const failed = calls.filter((c) => !c.ok);
  const ok = status === 200 && calls.length > 0 && !mocked && failed.length === 0 && (extra.ok ?? true);
  rows.push({
    route,
    status,
    seconds: +(ms / 1000).toFixed(1),
    models: [...new Set(calls.map((c) => c.model))].join(", ") || "—",
    mock: calls.length ? String(mocked) : "—",
    ok,
    note: [extra.note, ...failed.map((c) => `${c.step}: ${c.error}`)].filter(Boolean).join("; "),
  });
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function main() {
  console.log(`DockTwin smoke test → ${BASE}\n`);

  // 1. Describe -> build (Muse Spark, json_schema)
  {
    const r = await call<{ spec?: TwinSpec }>("/api/build", post({ text: DEMO_DESCRIPTION, domain: "port" }));
    record("/api/build", r.status, r.ms, r.json.calls, {
      ok: !!r.json.spec,
      note: r.json.error ?? `${r.json.spec?.objects.length ?? 0} objects, ${r.json.spec?.rules.length ?? 0} rules`,
    });
  }

  // 2. Photo -> segments (SAM 3.1, + Muse Spark vision when boxes are found)
  {
    const file = path.join(ROOT, "public/samples/gate-staten-island.jpg");
    const image = `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`;
    const r = await call<{ segments?: { concept: string }[]; objects?: unknown[]; warnings?: string[] }>("/api/segment", post({ image, width: 1280, height: 975 }));
    const counts = (r.json.segments ?? []).reduce<Record<string, number>>((m, s) => ({ ...m, [s.concept]: (m[s.concept] ?? 0) + 1 }), {});
    const vision = r.json.calls?.some((c) => c.step.startsWith("vision"));
    record("/api/segment", r.status, r.ms, r.json.calls, {
      ok: !!r.json.segments,
      note:
        r.json.error ??
        `${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ") || "no segments"}${vision ? "" : " (no containers in this photo, so the vision step is skipped)"}`,
    });
  }

  // 3. Voice -> text (Muse Voice Transcribe)
  {
    const wavPath = process.env.SMOKE_WAV;
    let wav: Buffer;
    let note: string;
    if (wavPath && fs.existsSync(wavPath)) {
      wav = fs.readFileSync(wavPath);
      note = `speech from ${path.basename(wavPath)}`;
    } else {
      // No speech available: a 1 s tone still exercises the endpoint end to end.
      const sr = 16_000;
      const tone = new Float32Array(sr).map((_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / sr));
      wav = Buffer.from(encodeWav(tone, sr));
      note = "1 s generated tone (set SMOKE_WAV for real speech; transcript may be empty)";
    }
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "smoke.wav");
    const r = await call<{ text?: string }>("/api/transcribe", { method: "POST", body: form });
    record("/api/transcribe", r.status, r.ms, r.json.calls, { note: r.json.error ?? `${note}: "${(r.json.text ?? "").slice(0, 70)}"` });
  }

  // 4-6. Demo twin -> stress -> fix -> explain
  const spec = demoTerminal();
  const stress = await call<StressResponse>("/api/stress", post({ spec }));
  const agentScenarios = stress.json.scenarios?.filter((s) => s.origin === "muse-spark").length ?? 0;
  record("/api/stress", stress.status, stress.ms, stress.json.calls, {
    ok: !stress.json.agentError && agentScenarios > 0,
    note:
      stress.json.error ??
      stress.json.agentError ??
      `${stress.json.scenarios.length} scenarios (${agentScenarios} by Muse Spark), ${stress.json.bugs.length} bug root causes`,
  });

  const bug = stress.json.bugs?.[0];
  if (stress.status === 200 && bug) {
    const fix = await call<FixResponse>("/api/fix", post({ spec, scenarios: stress.json.scenarios, bugKey: bug.key }));
    record("/api/fix", fix.status, fix.ms, fix.json.calls, {
      ok: fix.json.source === "muse-spark",
      note: fix.json.error ?? `${bug.kind}: verdict ${fix.json.verification?.verdict} (source ${fix.json.source})`,
    });
  } else {
    rows.push({ route: "/api/fix", status: 0, seconds: 0, models: "—", mock: "—", ok: false, note: "no bug to fix (stress failed or found nothing)" });
  }

  if (stress.status === 200) {
    const i = stress.json.scenarios.findIndex((s) => s.id === "S2");
    const result = stress.json.results[i]!;
    const tick = result.ticks.findIndex((t) => t.t === 30);
    const decision = decideAt(spec, stress.json.scenarios[i]!, result, tick).find((d) => d.subject === PROBLEM_BOX);
    const ex = await call<{ explanation?: { headline: string } }>("/api/explain", post({ decision }));
    record("/api/explain", ex.status, ex.ms, ex.json.calls, { note: ex.json.error ?? `"${ex.json.explanation?.headline}"` });
  }

  // Summary
  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  console.log(`${pad("route", 16)} ${pad("status", 6)} ${pad("secs", 6)} ${pad("models", 34)} ${pad("mock", 5)} ${pad("result", 6)} note`);
  for (const r of rows) {
    console.log(`${pad(r.route, 16)} ${pad(String(r.status), 6)} ${pad(String(r.seconds), 6)} ${pad(r.models, 34)} ${pad(r.mock, 5)} ${pad(r.ok ? "PASS" : "FAIL", 6)} ${r.note}`);
  }
  const failed = rows.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\nSMOKE FAILED: ${failed.map((r) => r.route).join(", ")}`);
    process.exit(1);
  }
  console.log(`\nSMOKE PASSED: ${rows.length} routes, real Meta models, no mocks.`);
}

main().catch((err) => {
  console.error("SMOKE CRASHED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
