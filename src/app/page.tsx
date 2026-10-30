"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Inspector } from "@/components/Inspector";
import { ModelBadges } from "@/components/ModelBadges";
import { formatCondition, formatRule } from "@/engine/format";
import type { TwinSpec } from "@/engine/schema";
import type { ModelCall } from "@/lib/meta/callLog";

const TwinScene = dynamic(() => import("@/components/twin/TwinScene"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-sand/40">Loading 3D twin…</div>,
});

const SAMPLE = "Reefer box MSCU1234565 at Lane 4, plug at 4°C, customs hold possible.";

export default function Home() {
  const [text, setText] = useState(SAMPLE);
  const [spec, setSpec] = useState<TwinSpec | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [calls, setCalls] = useState<ModelCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      setCalls((c) => [...c, ...(json.calls ?? [])]);
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSpec(json.spec);
      setSelected(json.spec.objects.find((o: { kind: string }) => o.kind === "container")?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Dock<span className="text-rust">Twin</span>
        </h1>
        <p className="text-sm text-sand/60">Describe a terminal → get a programmable, testable digital twin</p>
      </header>

      <section className="space-y-3 rounded-lg bg-navy-2 p-4">
        <label htmlFor="describe" className="text-sm text-sand/70">
          Describe the situation
        </label>
        <textarea
          id="describe"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          className="w-full rounded-md bg-navy p-3 font-mono text-sm outline-none ring-1 ring-navy-3 focus:ring-rust"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={build}
            disabled={busy || text.trim().length < 3}
            className="rounded-md bg-rust px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Building twin…" : "Build twin"}
          </button>
          {error && <p className="text-sm text-rust">{error}</p>}
        </div>
        <ModelBadges calls={calls} />
      </section>

      {spec && (
        <>
          <section className="grid gap-4 lg:grid-cols-3">
            <div className="relative h-[460px] overflow-hidden rounded-lg bg-navy-2 lg:col-span-2" data-testid="twin-canvas">
              <div className="pointer-events-none absolute left-3 top-2 z-10">
                <div className="font-medium">{spec.name}</div>
                <div className="text-xs text-sand/60">{spec.summary}</div>
              </div>
              <TwinScene spec={spec} selected={selected} onSelect={setSelected} />
            </div>
            <aside className="max-h-[460px] overflow-y-auto rounded-lg bg-navy-2 p-4">
              <Inspector spec={spec} id={selected} />
            </aside>
          </section>

          <section className="rounded-lg bg-navy-2 p-4">
            <h2 className="mb-2 font-medium">
              Behavior rules <span className="text-sm text-sand/40">({spec.rules.length}) · interpreted by the deterministic engine, never executed as code</span>
            </h2>
            <div className="grid gap-2 md:grid-cols-2">
              {spec.rules.map((r) => {
                const f = formatRule(r);
                return (
                  <div key={r.id} className="rounded-md bg-navy p-2 font-mono text-xs">
                    <div className="mb-1 font-sans text-sm">
                      <span className="text-rust">{r.id}</span> {r.name} <span className="text-sand/40">p{r.priority}</span>
                    </div>
                    <div>
                      <span className="text-sand/50">WHEN </span>
                      {f.when}
                    </div>
                    {f.then.map((t, i) => (
                      <div key={i}>
                        <span className="text-sand/50">THEN </span>
                        {t}
                      </div>
                    ))}
                  </div>
                );
              })}
              {spec.invariants.map((inv) => (
                <div key={inv.id} className="rounded-md bg-navy p-2 text-xs">
                  <span className="text-warn">{inv.id}</span> {inv.description}
                  <div className="font-mono text-sand/60">
                    {formatCondition(inv.when)} ⇒ ≥ {inv.minLevel}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
