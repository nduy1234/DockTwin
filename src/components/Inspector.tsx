import { rulesFor } from "@/engine/dsl";
import { formatRule } from "@/engine/format";
import type { LadderLevel, Scalar, TwinSpec } from "@/engine/schema";
import { LEVEL_COLOR } from "./twin/colors";

/** Click an object in the twin -> see its live state and the rules that govern it. */
export function Inspector({
  spec,
  id,
  state,
  level,
}: {
  spec: TwinSpec;
  id: string | null;
  state?: Record<string, Scalar>;
  level?: LadderLevel;
}) {
  const obj = id ? spec.objects.find((o) => o.id === id) : undefined;
  if (!obj) {
    return <p className="text-sm text-sand/50">Click any object in the twin to see its state and rules.</p>;
  }
  const props = state ?? Object.fromEntries(obj.props.map((p) => [p.key, p.value]));
  const rules = rulesFor(spec, obj.id);
  const invariants = spec.invariants.filter(
    (i) => i.appliesTo.ids.includes(obj.id) || (i.appliesTo.ids.length === 0 && i.appliesTo.kind === obj.kind),
  );

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="flex items-center justify-between">
          <span className="font-mono text-base">{obj.id}</span>
          {level && (
            <span className="rounded px-1.5 py-0.5 font-mono text-xs text-white" style={{ background: LEVEL_COLOR[level] }}>
              {level.toUpperCase()}
            </span>
          )}
        </div>
        <div className="text-sand/50">
          {obj.kind}
          {obj.attachedTo && ` · at ${obj.attachedTo}`}
        </div>
      </div>
      <div className="flex flex-wrap gap-1 font-mono text-[11px]">
        {Object.entries(props).map(([k, v]) => (
          <span key={k} className="rounded bg-navy-3 px-1.5 py-0.5">
            {k}={String(v)}
          </span>
        ))}
      </div>
      <div className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-sand/50">Rules ({rules.length})</h3>
        {rules.length === 0 && <p className="text-sand/40">No rules apply to this object.</p>}
        {rules.map((r) => {
          const f = formatRule(r);
          return (
            <div key={r.id} className="rounded bg-navy p-2 font-mono text-xs">
              <div className="mb-1 font-sans">
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
        {invariants.map((inv) => (
          <div key={inv.id} className="rounded bg-navy p-2 text-xs">
            <span className="text-warn">{inv.id}</span> {inv.description} <span className="text-sand/40">≥ {inv.minLevel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
