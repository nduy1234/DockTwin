import type { ModelCall } from "@/lib/meta/callLog";

/** Subtle per-step trail showing which Meta model handled what. */
export function ModelBadges({ calls }: { calls: ModelCall[] }) {
  if (calls.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 text-[11px] font-mono">
      {calls.map((c, i) => (
        <li
          key={i}
          title={`${c.endpoint}\nattempts: ${c.attempts}${c.repaired ? " (schema repaired)" : ""}${
            c.usage ? `\ntokens: ${c.usage.input} in / ${c.usage.output} out` : ""
          }${c.error ? `\nerror: ${c.error}` : ""}`}
          className={`rounded-full border px-2 py-0.5 ${
            c.mock
              ? "border-warn text-warn"
              : c.ok
                ? "border-navy-3 text-sand/70"
                : "border-rust text-rust"
          }`}
        >
          {c.mock && <b>MOCK · </b>}
          {c.step} · <span className="text-sand">{c.model}</span> · {(c.ms / 1000).toFixed(1)}s
          {c.repaired && " · repaired"}
        </li>
      ))}
    </ul>
  );
}
