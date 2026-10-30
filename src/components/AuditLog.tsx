import type { AuditEntry } from "@/engine/audit";

export function AuditLog({ log, chain, onClear }: { log: AuditEntry[]; chain: { ok: boolean; detail?: string }; onClear: () => void }) {
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(log, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `docktwin-audit-${Date.now()}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">
          Audit log <span className="text-sm text-sand/40">({log.length})</span>
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span className={chain.ok ? "text-ok" : "text-rust"} title="Each entry includes the SHA-256 of the previous one">
            {chain.ok ? "✓ hash chain intact" : `✗ chain broken at ${chain.detail}`}
          </span>
          <button onClick={exportJson} disabled={!log.length} className="rounded px-2 py-0.5 ring-1 ring-navy-3 disabled:opacity-40">
            Export JSON
          </button>
          <button onClick={onClear} disabled={!log.length} className="rounded px-2 py-0.5 text-sand/50 ring-1 ring-navy-3 disabled:opacity-40">
            Clear
          </button>
        </div>
      </div>
      <ol className="max-h-64 space-y-1 overflow-y-auto font-mono text-[11px]">
        {[...log].reverse().map((e) => (
          <li key={e.seq} className="grid grid-cols-[3rem_5.5rem_9rem_1fr] gap-2 rounded bg-navy px-2 py-1" title={`hash ${e.hash}\nprev ${e.prev}`}>
            <span className="text-sand/40">#{e.seq}</span>
            <span className="text-sand/50">{e.at.slice(11, 19)}</span>
            <span className={e.actor.startsWith("model:") ? "text-rust" : e.actor === "planner" ? "text-sand" : "text-sand/60"}>{e.actor}</span>
            <span>
              <span className="text-sand/60">{e.action}</span> {e.summary}
            </span>
          </li>
        ))}
        {log.length === 0 && <li className="text-sand/40">Nothing yet. Building, testing, fixing, and deciding are all recorded here.</li>}
      </ol>
    </div>
  );
}
