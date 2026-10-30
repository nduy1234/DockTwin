/**
 * Transparent cost-of-delay model. Deliberately simple, fully itemised, and
 * labelled as an estimate in the UI. Every constant is a planning assumption a
 * terminal would replace with its own tariff.
 */
import type { LadderLevel, Scalar } from "./schema";

/** Expected delay and handling cost each ladder action adds for one box. */
export const ACTION_COST: Record<LadderLevel, { delayHours: number; handlingUsd: number; what: string }> = {
  watch: { delayHours: 0, handlingUsd: 0, what: "no change, keep monitoring" },
  ask: { delayHours: 0.25, handlingUsd: 0, what: "query the source to resolve a discrepancy" },
  slow: { delayHours: 0.5, handlingUsd: 40, what: "deprioritise in the gate/yard queue" },
  reroute: { delayHours: 0.75, handlingUsd: 90, what: "move to another lane or block" },
  inspect: { delayHours: 2, handlingUsd: 350, what: "physical check at the inspection lane" },
  hold: { delayHours: 8, handlingUsd: 600, what: "stop all moves until cleared" },
  human: { delayHours: 1, handlingUsd: 0, what: "hand to a supervisor to decide" },
};

export const ASSUMPTIONS = {
  yardDwellPerHour: 8, // storage + equipment opportunity
  demurragePerHour: 35, // ~$840/day once free time is gone
  truckWaitPerHour: 90, // driver + tractor waiting at a dead lane
  reeferCargoUsd: 60_000, // typical chilled cargo value
  spoilPerDegreeHour: 0.004, // share of cargo value lost per °C above tolerance per hour
  reeferToleranceC: 2,
};

export type CostLine = { label: string; usdPerHour: number };
export type CostEstimate = {
  perHourUsd: number;
  lines: CostLine[];
  action: LadderLevel;
  delayHours: number;
  handlingUsd: number;
  /** delayHours * perHourUsd + handlingUsd */
  actionUsd: number;
};

export function costOfDelay(
  level: LadderLevel,
  ctx: {
    props: Record<string, Scalar>;
    tempC?: number;
    freeMinutesLeft?: number;
    laneDown?: boolean;
  },
): CostEstimate {
  const a = ASSUMPTIONS;
  const { delayHours, handlingUsd } = ACTION_COST[level];
  const lines: CostLine[] = [{ label: "yard dwell", usdPerHour: a.yardDwellPerHour }];

  const free = ctx.freeMinutesLeft;
  if (free !== undefined && free <= delayHours * 60) {
    lines.push({ label: free <= 0 ? "demurrage (free time expired)" : "demurrage (free time runs out during delay)", usdPerHour: a.demurragePerHour });
  }
  if (ctx.laneDown) lines.push({ label: "truck waiting at down lane", usdPerHour: a.truckWaitPerHour });

  const sp = typeof ctx.props.setpoint_c === "number" ? ctx.props.setpoint_c : undefined;
  const temp = ctx.tempC ?? (typeof ctx.props.temp_c === "number" ? ctx.props.temp_c : undefined);
  if (ctx.props.reefer === true && sp !== undefined && temp !== undefined) {
    const over = temp - sp - a.reeferToleranceC;
    if (over > 0) {
      const value = typeof ctx.props.cargo_value_usd === "number" ? ctx.props.cargo_value_usd : a.reeferCargoUsd;
      lines.push({ label: `reefer spoilage risk (+${over.toFixed(1)}°C over tolerance)`, usdPerHour: Math.round(value * a.spoilPerDegreeHour * over) });
    }
  }

  const perHourUsd = lines.reduce((s, l) => s + l.usdPerHour, 0);
  return { perHourUsd, lines, action: level, delayHours, handlingUsd, actionUsd: Math.round(delayHours * perHourUsd + handlingUsd) };
}
