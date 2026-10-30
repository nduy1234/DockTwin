import { useState } from "react";
import type { Decision } from "@/engine/decide";
import type { LadderLevel } from "@/engine/schema";
import { LEVEL_COLOR } from "./twin/colors";

export type Ruling = { status: "approved" | "overridden" | "escalated" | "auto"; level: LadderLevel };
export type Explanation = { headline: string; explanation: string; changeMyMind: string };

type Props = {
  decisions: Decision[];
  rulings: Record<string, Ruling>;
  explanations: Record<string, Explanation | "loading" | { error: string }>;
  onRule: (d: Decision, r: Ruling, note?: string) => void;
  onExplain: (d: Decision) => void;
  onAutoApprove: (ds: Decision[]) => void;
  onSelect: (id: string) => void;
};

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const key = (d: Decision) => `${d.evidence.scenarioId}|${d.subject}|${d.t}`;
export const rulingKey = key;

export function DecisionPanel({ decisions, rulings, explanations, onRule, onExplain, onAutoApprove, onSelect }: Props) {
  const auto = decisions.filter((d) => !d.approval.required && !rulings[key(d)]);
  if (decisions.length === 0) {
    return <p className="text-sm text-sand/50">No box needs action at this moment in the scenario. Scrub the timeline to see decisions.</p>;
  }
  return (
    <div className="space-y-3">
      {auto.length > 0 && (
        <button onClick={() => onAutoApprove(auto)} className="rounded-md border border-ok px-3 py-1 text-xs text-ok hover:bg-ok/10">
          Apply {auto.length} low-impact, high-confidence action{auto.length > 1 ? "s" : ""} by policy
        </button>
      )}
      {decisions.map((d) => (
        <DecisionCard
          key={key(d)}
          d={d}
          ruling={rulings[key(d)]}
          explanation={explanations[key(d)]}
          onRule={onRule}
          onExplain={onExplain}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function DecisionCard({
  d,
  ruling,
  explanation,
  onRule,
  onExplain,
  onSelect,
}: {
  d: Decision;
  ruling?: Ruling;
  explanation?: Explanation | "loading" | { error: string };
  onRule: Props["onRule"];
  onExplain: Props["onExplain"];
  onSelect: Props["onSelect"];
}) {
  const [open, setOpen] = useState(d.approval.required);
  const pct = Math.round(d.confidence * 100);
  return (
    <div className="space-y-2 rounded-md bg-navy p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => onSelect(d.subject)} className="font-mono hover:text-rust">
          {d.subject}
        </button>
        <div className="flex items-center gap-2 text-xs">
          {ruling ? (
            <span className="rounded bg-navy-3 px-1.5 py-0.5">
              {ruling.status === "auto" ? "auto-applied by policy" : ruling.status} · {ruling.level}
            </span>
          ) : d.approval.required ? (
            <span className="rounded bg-warn px-1.5 py-0.5 font-medium text-navy">NEEDS HUMAN APPROVAL</span>
          ) : (
            <span className="rounded border border-ok px-1.5 py-0.5 text-ok">policy may auto-apply</span>
          )}
        </div>
      </div>

      <div className="flex gap-1" role="list" aria-label="Action ladder">
        {d.ladder.map((s) => (
          <div
            key={s.level}
            role="listitem"
            title={s.status === "insufficient" ? "too gentle for current evidence" : s.status}
            className={`flex-1 rounded px-1 py-0.5 text-center font-mono text-[10px] uppercase ${
              s.status === "chosen" ? "font-bold text-white" : s.status === "insufficient" ? "text-sand/30 line-through" : "text-sand/50"
            }`}
            style={{ background: s.status === "chosen" ? LEVEL_COLOR[s.level] : "#1c3142" }}
          >
            {s.level}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-sand/50">Confidence</div>
          <div className="mt-1 h-1.5 rounded bg-navy-3">
            <div className="h-1.5 rounded" style={{ width: `${pct}%`, background: pct >= 70 ? "#3f8f6b" : "#d9a42b" }} />
          </div>
          <div className="font-mono">{d.confidence.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-sand/50">Cost of this action (est.)</div>
          <div className="font-mono">{usd(d.cost.actionUsd)}</div>
          <div className="text-sand/40">
            {d.cost.delayHours}h × {usd(d.cost.perHourUsd)}/h + {usd(d.cost.handlingUsd)}
          </div>
        </div>
        <div>
          <div className="text-sand/50">Delay costs (est.)</div>
          <div className="font-mono">{usd(d.cost.perHourUsd)}/hour</div>
        </div>
      </div>

      {d.approval.required && !ruling && <p className="text-xs text-warn">Why approval: {d.approval.reasons.join("; ")}.</p>}

      <button onClick={() => setOpen((o) => !o)} className="text-xs text-sand/60 underline-offset-2 hover:underline">
        {open ? "Hide evidence" : "Show evidence"}
      </button>
      {open && <Evidence d={d} />}

      {explanation && (
        <div className="rounded border border-navy-3 p-2 text-xs">
          {explanation === "loading" ? (
            <span className="animate-pulse text-sand/50">Muse Spark is explaining…</span>
          ) : "error" in explanation ? (
            <span className="text-rust">{explanation.error}</span>
          ) : (
            <>
              <div className="font-medium">{explanation.headline}</div>
              <p className="text-sand/80">{explanation.explanation}</p>
              <p className="text-sand/50">Would change with: {explanation.changeMyMind}</p>
            </>
          )}
        </div>
      )}

      {!ruling && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={() => onRule(d, { status: "approved", level: d.level })} className="rounded-md bg-rust px-3 py-1 text-xs font-medium text-white">
            Approve {d.level}
          </button>
          <select
            aria-label="Override action"
            className="rounded-md bg-navy-2 px-2 py-1 text-xs ring-1 ring-navy-3"
            value=""
            onChange={(e) => {
              const level = e.target.value as LadderLevel;
              if (!level) return;
              const note = window.prompt(`Reason for overriding ${d.level} → ${level}?`) ?? "";
              onRule(d, { status: "overridden", level }, note);
            }}
          >
            <option value="">Override…</option>
            {d.ladder
              .filter((s) => s.level !== d.level && s.level !== "human")
              .map((s) => (
                <option key={s.level} value={s.level}>
                  {s.level}
                  {s.status === "insufficient" ? " (gentler than evidence supports)" : ""}
                </option>
              ))}
          </select>
          <button onClick={() => onRule(d, { status: "escalated", level: "human" })} className="rounded-md px-3 py-1 text-xs ring-1 ring-navy-3 hover:bg-navy-2">
            Hand to supervisor
          </button>
        </div>
      )}
      {!explanation && (
        <button onClick={() => onExplain(d)} className="rounded-md px-3 py-1 text-xs text-sand/70 ring-1 ring-navy-3 hover:bg-navy-2">
          Explain (Muse Spark)
        </button>
      )}
    </div>
  );
}

function Evidence({ d }: { d: Decision }) {
  return (
    <div className="space-y-2 rounded bg-navy-2 p-2 text-xs">
      <div>
        <div className="mb-1 text-sand/50">Signals trusted (scenario {d.evidence.scenarioId}, t={d.t}m)</div>
        <table className="w-full font-mono text-[11px]">
          <tbody>
            {d.evidence.signals.map((s, i) => (
              <tr key={i} className="align-top">
                <td className="pr-2">{s.source}</td>
                <td className="pr-2">
                  {s.target !== d.subject && `${s.target}.`}
                  {s.key}={String(s.value)}
                </td>
                <td className={`pr-2 ${s.trust < 0.5 ? "text-rust" : s.trust < 0.8 ? "text-warn" : "text-ok"}`}>{s.trust.toFixed(2)}</td>
                <td className="font-sans text-sand/50">{s.notes.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.evidence.conflicts.map((c, i) => (
        <div key={i} className="text-warn">
          Conflict: {c.why} → trusted {c.winner.source} over {c.loser.source}
        </div>
      ))}
      <div>
        <div className="text-sand/50">Rules that fired</div>
        {d.evidence.firings.length === 0 && <div className="text-sand/40">none</div>}
        {d.evidence.firings.map((f, i) => (
          <div key={i}>
            <span className="text-rust">{f.ruleId}</span> → {f.level}: {f.reason}
          </div>
        ))}
        {d.floor && (
          <div className="text-warn">
            Safety floor {d.floor.invariantId}: {d.floor.description} (≥ {d.floor.level})
          </div>
        )}
      </div>
      <div className="text-sand/50">
        Confidence: {d.confidenceWhy.join("; ")}. Stable for {d.evidence.stableTicks} tick{d.evidence.stableTicks === 1 ? "" : "s"}; scenario
        peak {d.evidence.peak ?? "none"}.
      </div>
      <div className="text-sand/50">Cost lines: {d.cost.lines.map((l) => `${l.label} ${usd(l.usdPerHour)}/h`).join(" · ")}</div>
    </div>
  );
}
