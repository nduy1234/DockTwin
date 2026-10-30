import { describe, expect, it } from "vitest";
import { segmentsToTwin, type Segment } from "@/engine/photo";
import { checkTwin, TwinObject } from "@/engine/schema";
import { encodeWav } from "@/lib/wav";

describe("encodeWav", () => {
  it("writes a mono 16-bit PCM header and clamps samples", () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
    const v = new DataView(buf);
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });
});

const seg = (concept: string, id: string, l: number, t: number, r: number, b: number): Segment => ({
  concept,
  objectId: `${concept}#${id}`,
  box: { left: l, top: t, right: r, bottom: b },
});

describe("segmentsToTwin", () => {
  const segments = [
    seg("shipping container", "a", 100, 400, 300, 480), // ground, left
    seg("shipping container", "b", 110, 320, 290, 400), // stacked on a
    seg("shipping container", "c", 500, 400, 700, 480), // ground, right, inside lane
    seg("shipping container", "tiny", 900, 10, 905, 14), // noise
    seg("crane", "k", 800, 0, 1000, 300),
    seg("road lane", "l", 450, 380, 750, 600),
  ];
  const objs = segmentsToTwin(segments, 1280, 720, {
    "shipping container#c": { code: "MSCU1234565", reefer: true, color: "white" },
    "shipping container#a": { code: "not-a-code", reefer: null },
  });

  it("maps concepts to kinds, drops noise, and orders left to right", () => {
    expect(objs.map((o) => `${o.kind}:${o.id}`)).toEqual([
      "gate_lane:LANE-1",
      "crane:CRANE-1",
      "container:BOX-01",
      "container:BOX-02",
      "container:MSCU1234565",
    ]);
    for (const o of objs) expect(TwinObject.safeParse(o).success).toBe(true);
  });

  it("estimates stack tiers, attaches boxes to lanes, and applies valid vision labels only", () => {
    const get = (id: string) => objs.find((o) => o.id === id)!;
    const prop = (id: string, k: string) => get(id).props.find((p) => p.key === k)?.value;
    expect(prop("BOX-01", "tier")).toBe(1); // b (higher in image) sits on a
    expect(prop("BOX-02", "tier")).toBe(0);
    expect(get("MSCU1234565").attachedTo).toBe("LANE-1");
    expect(prop("MSCU1234565", "reefer")).toBe(true);
    expect(get("BOX-02").label).not.toContain("not-a-code");
  });

  it("produces a twin that passes semantic checks once rules are added", () => {
    expect(checkTwin({ name: "p", domain: "port", summary: "", objects: objs, rules: [], invariants: [] })).toEqual([]);
  });
});
