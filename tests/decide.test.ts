import { describe, expect, it } from "vitest";
import { appendEntry, verifyChain, type AuditEntry } from "@/engine/audit";
import { ACTION_COST, costOfDelay } from "@/engine/cost";
import { decideAt } from "@/engine/decide";
import { generateScenarios } from "@/engine/scenarios";
import { runScenario } from "@/engine/sim";
import { trustedSignals } from "@/engine/trust";
import { mockPortTwin } from "@/templates/port";

const BOX = "MSCU1234565";
const spec = mockPortTwin("Reefer box MSCU1234565 at Lane 4, plug at 4°C, customs hold possible.");
const scenarios = generateScenarios(spec, 1);
const sc = (id: string) => scenarios.find((s) => s.id === id)!;
const at = (id: string, t: number) => {
  const s = sc(id);
  const r = runScenario(spec, s);
  return decideAt(spec, s, r, r.ticks.findIndex((x) => x.t === t)).find((d) => d.subject === BOX)!;
};

describe("trustedSignals", () => {
  it("lets the scale override the carrier's 'empty' claim and halves carrier trust", () => {
    const { signals, conflicts } = trustedSignals(spec, sc("S1"), BOX, 10);
    expect(conflicts.map((c) => [c.winner.source, c.loser.source])).toEqual([
      ["scale", "carrier"],
      ["scale", "carrier"],
    ]);
    const carrier = signals.find((s) => s.key === "declared_status")!;
    expect(carrier.trust).toBeCloseTo(0.6 * 0.5 - 0.004, 2); // 10 min stale, then halved
    expect(carrier.notes.join(" ")).toContain("contradicted by scale");
    expect(signals[0]!.source).toBe("scale"); // sorted most-trusted first
  });

  it("decays trust with age and only sees signals up to t", () => {
    const early = trustedSignals(spec, sc("S2"), BOX, 10).signals;
    expect(early.find((s) => s.source === "customs")).toBeUndefined(); // hold arrives at t=20
    const late = trustedSignals(spec, sc("S2"), BOX, 80).signals.find((s) => s.source === "customs")!;
    expect(late.trust).toBeCloseTo(0.98 - (60 / 60) * 0.05, 3);
  });
});

describe("decideAt", () => {
  it("paper vs scale: inspect, trusting the scale, no approval needed", () => {
    const d = at("S1", 20);
    expect(d.level).toBe("inspect");
    expect(d.evidence.firings.find((f) => f.level === "inspect")?.inputs).toContain(`${BOX}:signal.scale.weight_kg`);
    expect(d.confidenceWhy[0]).toContain("scale.weight_kg");
    expect(d.confidence).toBeGreaterThanOrEqual(0.7);
    expect(d.approval.required).toBe(false);
    expect(d.ladder.filter((s) => s.status === "insufficient").map((s) => s.level)).toEqual(["watch", "ask", "slow", "reroute"]);
  });

  it("customs hold is high impact and always needs a human", () => {
    const d = at("S2", 20);
    expect(d.level).toBe("hold");
    expect(d.approval.required).toBe(true);
    expect(d.approval.reasons).toContain("hold is a high-impact action");
  });

  it("raises an under-reacting rule set to the invariant floor and asks for approval", () => {
    const d = at("S3", 40); // sensor at setpoint +3.5°C, carrier still says OK
    expect(d.ruleLevel).toBeNull();
    expect(d.floor).toMatchObject({ level: "inspect", invariantId: "INV2" });
    expect(d.level).toBe("inspect");
    expect(d.approval.reasons.some((r) => r.includes("safety floor"))).toBe(true);
    expect(d.evidence.conflicts[0]?.loser.source).toBe("carrier");
    expect(d.cost.lines.some((l) => l.label.startsWith("reefer spoilage"))).toBe(true);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(at("S5", 30))).toBe(JSON.stringify(at("S5", 30)));
  });
});

describe("costOfDelay", () => {
  it("itemises dwell, demurrage, lane, and spoilage", () => {
    const c = costOfDelay("inspect", { props: { reefer: true, setpoint_c: 4 }, tempC: 9, freeMinutesLeft: 30, laneDown: true });
    expect(c.lines.map((l) => l.label.split(" (")[0])).toEqual(["yard dwell", "demurrage", "truck waiting at down lane", "reefer spoilage risk"]);
    expect(c.lines.at(-1)!.usdPerHour).toBe(Math.round(60_000 * 0.004 * 3));
    expect(c.actionUsd).toBe(Math.round(ACTION_COST.inspect.delayHours * c.perHourUsd + ACTION_COST.inspect.handlingUsd));
  });

  it("watch costs nothing extra", () => {
    expect(costOfDelay("watch", { props: {} }).actionUsd).toBe(0);
  });
});

describe("audit chain", () => {
  it("verifies an intact chain and detects tampering", async () => {
    const log: AuditEntry[] = [];
    const t0 = new Date("2026-11-04T12:00:00Z");
    log.push(await appendEntry(log, { actor: "engine", action: "decision.recommended", subject: BOX, summary: "inspect" }, t0));
    log.push(await appendEntry(log, { actor: "planner", action: "decision.approved", subject: BOX, summary: "ok", data: { level: "inspect" } }, t0));
    expect(log[1]!.prev).toBe(log[0]!.hash);
    expect(await verifyChain(log)).toEqual({ ok: true });

    const edited = log.map((e) => ({ ...e }));
    edited[0]!.summary = "watch";
    expect(await verifyChain(edited)).toMatchObject({ ok: false, badSeq: 1, reason: "entry contents altered" });
    expect(await verifyChain([log[1]!])).toMatchObject({ ok: false, badSeq: 2 });
  });
});
