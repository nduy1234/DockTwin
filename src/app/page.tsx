"use client";

import { useState } from "react";
import { ModelBadges } from "@/components/ModelBadges";
import { formatCondition, formatRule } from "@/engine/format";
import type { TwinSpec } from "@/engine/schema";
import type { ModelCall } from "@/lib/meta/callLog";

const SAMPLE = "Reefer box MSCU1234565 at Lane 4, plug at 4°C, customs hold possible.";

export default function Home() {
  const [text, setText] = useState(SAMPLE);
  const [spec, setSpec] = useState<TwinSpec | null>(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Dock<span className="text-rust">Twin</span>
        </h1>
        <p className="text-sm text-sand/60">Describe a terminal → get a programmable, testable digital twin</p>
      </header>

      <section className="rounded-lg bg-navy-2 p-4 space-y-3">
        <label htmlFor="describe" className="text-sm text-sand/70">
          Describe the situation
        </label>
        <textarea
          id="describe"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full rounded-md bg-navy p-3 font-mono text-sm outline-none ring-1 ring-navy-3 focus:ring-rust"
        />
        <div className="flex items-center gap-3">
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
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg bg-navy-2 p-4">
            <h2 className="font-medium">{spec.name}</h2>
            <p className="mb-3 text-sm text-sand/60">{spec.summary}</p>
            <ul className="space-y-2">
              {spec.objects.map((o) => (
                <li key={o.id} className="rounded-md bg-navy p-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-mono">{o.id}</span>
                    <span className="text-sand/50">
                      {o.kind}
                      {o.attachedTo && ` → ${o.attachedTo}`}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 font-mono text-[11px] text-sand/70">
                    {o.props.map((p) => (
                      <span key={p.key} className="rounded bg-navy-3 px-1.5">
                        {p.key}={String(p.value)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg bg-navy-2 p-4 space-y-2">
            <h2 className="font-medium">Behavior rules</h2>
            {spec.rules.map((r) => {
              const f = formatRule(r);
              return (
                <div key={r.id} className="rounded-md bg-navy p-2 font-mono text-xs">
                  <div className="mb-1 font-sans text-sm">
                    <span className="text-rust">{r.id}</span> {r.name}{" "}
                    <span className="text-sand/40">p{r.priority}</span>
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
            <h2 className="pt-2 font-medium">Invariants</h2>
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
      )}
    </main>
  );
}
