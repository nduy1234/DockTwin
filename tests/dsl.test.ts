import { describe, expect, it } from "vitest";
import { evalCondition, evalPredicate, fire, initialState, makeCtx, rulesFor, subjectsOf } from "@/engine/dsl";
import type { Predicate } from "@/engine/schema";
import { reeferTwin, rule } from "./fixtures";

const spec = reeferTwin();
const ctx = (signals = {}, t = 0) => makeCtx(spec, initialState(spec), signals, t);
const p = (fact: string, op: Predicate["op"], value: Predicate["value"], of = "self"): Predicate => ({ of, fact, op, value });

describe("evalPredicate", () => {
  it("compares numbers and strings", () => {
    const c = ctx();
    expect(evalPredicate(c, p("setpoint_c", "eq", 4), "BOX1")).toBe(true);
    expect(evalPredicate(c, p("setpoint_c", "gt", 3), "BOX1")).toBe(true);
    expect(evalPredicate(c, p("setpoint_c", "lte", 3), "BOX1")).toBe(false);
    expect(evalPredicate(c, p("status", "in", ["full", "empty"]), "BOX1")).toBe(true);
    expect(evalPredicate(c, p("status", "neq", "empty"), "BOX1")).toBe(true);
  });

  it("never coerces types: '4' is not 4, strings never compare numerically", () => {
    const c = ctx();
    expect(evalPredicate(c, p("setpoint_c", "eq", "4"), "BOX1")).toBe(false);
    expect(evalPredicate(c, p("status", "gt", 1), "BOX1")).toBe(false);
  });

  it("treats missing data as unknown, not as a match", () => {
    const c = ctx();
    expect(evalPredicate(c, p("temp_c", "gt", 0), "BOX1")).toBe(false);
    expect(evalPredicate(c, p("temp_c", "neq", 4), "BOX1")).toBe(false);
    expect(evalPredicate(c, p("temp_c", "missing", null), "BOX1")).toBe(true);
    expect(evalPredicate(c, p("setpoint_c", "exists", null), "BOX1")).toBe(true);
  });

  it("resolves attached and explicit subjects", () => {
    const c = ctx();
    expect(evalPredicate(c, p("status", "eq", "up", "attached"), "BOX1")).toBe(true);
    expect(evalPredicate(c, p("status", "eq", "up", "attached"), "BOX2")).toBe(false); // no attachment
    expect(evalPredicate(c, p("status", "eq", "up", "LANE-4"), "BOX2")).toBe(true);
  });

  it("reads signals and the clock", () => {
    const c = ctx({ BOX1: { "customs.hold": { value: true, t: 5 } } }, 30);
    expect(evalPredicate(c, p("signal.customs.hold", "eq", true), "BOX1")).toBe(true);
    expect(evalPredicate(c, p("signal.customs.hold", "eq", true), "BOX2")).toBe(false);
    expect(evalPredicate(c, p("clock.minutes", "gte", 30), "BOX1")).toBe(true);
  });
});

describe("evalCondition", () => {
  it("all AND (any OR); empty condition never fires", () => {
    const c = ctx();
    const yes = p("reefer", "eq", true);
    const no = p("reefer", "eq", false);
    expect(evalCondition(c, { all: [yes], any: [] }, "BOX1")).toBe(true);
    expect(evalCondition(c, { all: [yes], any: [no, yes] }, "BOX1")).toBe(true);
    expect(evalCondition(c, { all: [yes], any: [no] }, "BOX1")).toBe(false);
    expect(evalCondition(c, { all: [], any: [] }, "BOX1")).toBe(false);
  });
});

describe("fire / scoping", () => {
  it("scopes by kind or explicit ids and fires in stable order", () => {
    const s = reeferTwin([
      rule({ id: "R1", when: { all: [p("reefer", "exists", null)], any: [] }, then: [{ type: "flag", code: "x", severity: "info" }] }),
      rule({
        id: "R2",
        appliesTo: { kind: null, ids: ["BOX2"] },
        when: { all: [p("reefer", "eq", false)], any: [] },
        then: [{ type: "flag", code: "y", severity: "info" }],
      }),
    ]);
    expect(subjectsOf(s, { kind: "container", ids: [] })).toEqual(["BOX1", "BOX2"]);
    const f = fire(makeCtx(s, initialState(s)));
    expect(f.map((x) => `${x.ruleId}:${x.subject}`)).toEqual(["R1:BOX1", "R1:BOX2", "R2:BOX2"]);
    expect(rulesFor(s, "BOX2").map((r) => r.id)).toEqual(["R1", "R2"]);
    expect(rulesFor(s, "LANE-4")).toEqual([]);
  });
});
