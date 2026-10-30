import { useEffect, useRef, useState } from "react";
import type { FixState, StressResponse } from "@/lib/api-types";
import { LEVEL_COLOR } from "./twin/colors";

const SEV: Record<string, string> = { critical: "text-rust", warn: "text-warn", info: "text-sand/50" };
const VERDICT = {
  verified: { label: "VERIFIED", cls: "bg-ok text-white" },
  needs_review: { label: "NEEDS REVIEW", cls: "bg-warn text-navy" },
  rejected: { label: "REJECTED", cls: "bg-rust text-white" },
} as const;

type Props = {
  data: StressResponse;
  scenarioIdx: number;
  tickIdx: number;
  fixes: Record<string, FixState>;
  onScenario: (i: number) => void;
  onTick: (i: number) => void;
  /** Bump to start the replay from the beginning (demo mode). */
  autoPlay?: number;
  onApply: (bugKey: string) => void;
};

const REPLAY_MS = 700;

export function StressPanel({ data, scenarioIdx, tickIdx, fixes, onScenario, onTick, onApply, autoPlay = 0 }: Props) {
  const result = data.results[scenarioIdx]!;
  const scenario = data.scenarios[scenarioIdx]!;
  const tick = result.ticks[tickIdx];
  const [playing, setPlaying] = useState(false);
  const at = useRef(tickIdx);
  at.current = tickIdx;

  useEffect(() => {
    if (autoPlay > 0) {
      onTick(0);
      setPlaying(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (at.current >= result.ticks.length - 1) setPlaying(false);
      else onTick(at.current + 1);
    }, REPLAY_MS);
    return () => clearInterval(id);
  }, [playing, result.ticks.length, onTick]);
  const serious = (i: number) => data.results[i]!.bugs.filter((b) => b.severity !== "info").length;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-2 rounded-lg bg-navy-2 p-4">
        <h2 className="font-medium">
          Scenarios <span className="text-sm text-sand/40">({data.scenarios.length}, seed {data.seed})</span>
        </h2>
        {data.agentError && (
          <p className="text-xs text-warn">Muse Spark scenario agent failed ({data.agentError}); seeded scenarios still ran.</p>
        )}
        <ul className="space-y-1">
          {data.scenarios.map((s, i) => (
            <li key={s.id}>
              <button
                onClick={() => onScenario(i)}
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${i === scenarioIdx ? "bg-navy-3" : "hover:bg-navy"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-mono text-xs text-sand/50">{s.id}</span> {s.name}
                  </span>
                  {serious(i) > 0 ? (
                    <span className="shrink-0 rounded bg-rust/20 px-1.5 text-xs text-rust">{serious(i)} bug{serious(i) > 1 ? "s" : ""}</span>
                  ) : (
                    <span className="shrink-0 text-xs text-ok">clean</span>
                  )}
                </div>
                <div className="text-[11px] text-sand/40">{s.origin === "muse-spark" ? "invented by Muse Spark" : "seeded generator"}</div>
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t border-navy-3 pt-2">
          <p className="text-xs text-sand/60">{scenario.description}</p>
          <label className="flex items-center gap-2 text-xs text-sand/70">
            <button
              onClick={() => {
                if (!playing && tickIdx >= result.ticks.length - 1) onTick(0);
                setPlaying((p) => !p);
              }}
              aria-label={playing ? "Pause replay" : "Play replay"}
              className="rounded px-2 py-0.5 ring-1 ring-navy-3 hover:bg-navy"
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <span className="w-14 font-mono">t={tick?.t ?? 0}m</span>
            <input
              type="range"
              min={0}
              max={result.ticks.length - 1}
              value={tickIdx}
              onChange={(e) => onTick(Number(e.target.value))}
              className="w-full accent-rust"
              aria-label="Scenario time"
            />
          </label>
          <div className="flex flex-wrap gap-1 text-[11px]">
            {Object.entries(tick?.levels ?? {}).map(([id, l]) => (
              <span key={id} className="rounded px-1.5 font-mono text-white" style={{ background: LEVEL_COLOR[l] }}>
                {id}: {l}
              </span>
            ))}
            {tick?.changed.map((c, i) => (
              <span key={i} className="rounded bg-navy px-1.5 font-mono text-sand/60">
                {c.target}.{c.key}={String(c.value)} <span className="text-sand/30">({c.by})</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg bg-navy-2 p-4 lg:col-span-2">
        <h2 className="font-medium">
          Behavior bugs <span className="text-sm text-sand/40">· found by the deterministic engine, fixes proposed by Muse Spark, verified by re-simulation</span>
        </h2>
        {data.bugs.length === 0 && <p className="text-sm text-ok">No conflicts, oscillations, or invariant violations across all scenarios.</p>}
        {data.bugs.map((b) => {
          const fix = fixes[b.key];
          return (
            <div key={b.key} className="space-y-2 rounded-md bg-navy p-3">
              <div className="text-sm">
                <span className={`font-mono text-xs uppercase ${SEV[b.severity]}`}>{b.kind.replace("_", " ")}</span>{" "}
                <span className="text-sand/40">
                  · {b.scenarioId} · t={b.firstT}m · ×{b.count}
                </span>
                <p className="mt-0.5">{b.message}</p>
              </div>
              {!fix || fix.status === "loading" ? (
                <p className="animate-pulse text-xs text-sand/50">Muse Spark is drafting a fix…</p>
              ) : fix.status === "error" ? (
                <p className="text-xs text-rust">Fix failed: {fix.error}</p>
              ) : (
                <div className="space-y-2 border-t border-navy-3 pt-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded px-1.5 py-0.5 font-mono ${VERDICT[fix.verification.verdict].cls}`}>
                      {VERDICT[fix.verification.verdict].label}
                    </span>
                    <span className="text-sand/60">
                      {fix.verification.targetFixed ? "bug gone" : "bug persists"} across {fix.verification.scenariosRun} scenarios ·{" "}
                      {fix.verification.resolved.length} resolved · {fix.verification.introduced.length} new
                    </span>
                    <span className={fix.source === "muse-spark" ? "text-sand/40" : "text-warn"}>
                      {fix.source === "muse-spark"
                        ? "proposed by muse-spark-1.3"
                        : fix.source === "mock"
                          ? "MOCK · engine heuristic (offline dev)"
                          : "engine fallback (Muse Spark call failed)"}
                    </span>
                  </div>
                  <p className="text-sm text-sand/80">{fix.diff.rationale}</p>
                  <pre className="overflow-x-auto rounded bg-navy-2 p-2 text-[11px] leading-relaxed">
                    {fix.lines.map((l, i) => (
                      <div key={i} className={l.sign === "+" ? "text-ok" : l.sign === "-" ? "text-rust" : ""}>
                        {l.sign} {l.text}
                      </div>
                    ))}
                  </pre>
                  {fix.verification.applyErrors.length > 0 && (
                    <p className="text-xs text-rust">Could not apply: {fix.verification.applyErrors.join("; ")}</p>
                  )}
                  {fix.verification.introduced.map((nb) => (
                    <p key={nb.key} className="text-xs text-warn">
                      New: {nb.message}
                    </p>
                  ))}
                  {fix.verification.weakened.map((w, i) => (
                    <p key={i} className="text-xs text-warn">
                      Weakens {w.subject} in {w.scenarioId}: {w.before} → {w.after}
                    </p>
                  ))}
                  {fix.verification.verdict !== "rejected" && (
                    <button
                      onClick={() => onApply(b.key)}
                      className="rounded-md bg-rust px-3 py-1 text-xs font-medium text-white"
                    >
                      {fix.verification.verdict === "verified" ? "Approve & apply fix" : "Review & apply anyway"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
