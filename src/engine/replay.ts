import { initialState, type State } from "./dsl";
import type { TwinSpec } from "./schema";
import type { SimResult } from "./sim";

/** Object state as of a given tick, rebuilt from the tick trace. */
export function stateAt(spec: TwinSpec, result: SimResult, tickIndex: number): State {
  const state = initialState(spec);
  for (const tick of result.ticks.slice(0, tickIndex + 1)) {
    for (const c of tick.changed) (state[c.target] ??= {})[c.key] = c.value;
  }
  return state;
}
