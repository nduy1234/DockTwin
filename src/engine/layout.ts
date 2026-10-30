/**
 * Deterministic 3D placement from the twin spec alone (no model output needed).
 * Units are metres. +x runs along the quay, +z runs from gate (front) to yard.
 *
 *   gate lanes  ─ along x at z = 0, with scales beside them
 *   lane boxes  ─ queued behind their lane at z = 8, 15, ...
 *   yard boxes  ─ blocks of 10 bays x 4 rows x up to 3 tiers from z = 40
 *   cranes      ─ along the quay at z = 110
 *   plugs       ─ beside the box they power
 */
import type { ObjectKind, TwinSpec } from "./schema";

export type Placed = {
  id: string;
  kind: ObjectKind;
  pos: [number, number, number];
  size: [number, number, number];
};

const BOX: [number, number, number] = [6.1, 2.6, 2.4]; // 20ft container, x-length
const LANE_PITCH = 9;
const BAY = 6.6;
const ROW = 2.9;
const TIER = 2.6;
const BAYS_PER_BLOCK = 10;
const ROWS_PER_BLOCK = 4;
const TIERS = 3;

export function layoutTwin(spec: TwinSpec): Placed[] {
  const out: Placed[] = [];
  const place = (id: string, kind: ObjectKind, pos: [number, number, number], size: [number, number, number]) =>
    out.push({ id, kind, pos, size });

  const lanes = spec.objects.filter((o) => o.kind === "gate_lane");
  const laneX = new Map(lanes.map((l, i) => [l.id, (i - (lanes.length - 1) / 2) * LANE_PITCH]));
  for (const l of lanes) place(l.id, "gate_lane", [laneX.get(l.id)!, 0.05, 0], [3.6, 0.1, 14]);

  // Scales: on their lane if attached, else in a row at the far left of the gate.
  let looseScale = 0;
  for (const s of spec.objects.filter((o) => o.kind === "scale")) {
    const x = s.attachedTo && laneX.has(s.attachedTo) ? laneX.get(s.attachedTo)! : -40 - looseScale++ * 6;
    place(s.id, "scale", [x, 0.2, -4], [3.2, 0.4, 4]);
  }

  const queue = new Map<string, number>();
  const yard: string[] = [];
  for (const c of spec.objects.filter((o) => o.kind === "container")) {
    const lane = c.attachedTo && laneX.has(c.attachedTo) ? c.attachedTo : null;
    if (!lane) {
      yard.push(c.id);
      continue;
    }
    const n = queue.get(lane) ?? 0;
    queue.set(lane, n + 1);
    // Box sits lengthwise along z in the lane queue.
    place(c.id, "container", [laneX.get(lane)!, BOX[1] / 2, 9 + n * 7], [BOX[2], BOX[1], BOX[0]]);
  }

  const perBlock = BAYS_PER_BLOCK * ROWS_PER_BLOCK * TIERS;
  const blocks = Math.max(1, Math.ceil(yard.length / perBlock));
  const blockW = BAYS_PER_BLOCK * BAY;
  yard.forEach((id, i) => {
    const block = Math.floor(i / perBlock);
    const r = i % perBlock;
    // Fill ground slots across the block first, then stack: looks like a real yard.
    const tier = Math.floor(r / (BAYS_PER_BLOCK * ROWS_PER_BLOCK));
    const slot = r % (BAYS_PER_BLOCK * ROWS_PER_BLOCK);
    const bay = slot % BAYS_PER_BLOCK;
    const row = Math.floor(slot / BAYS_PER_BLOCK);
    const x = (block - (blocks - 1) / 2) * (blockW + 12) + (bay - (BAYS_PER_BLOCK - 1) / 2) * BAY;
    place(id, "container", [x, BOX[1] / 2 + tier * TIER, 40 + row * ROW], BOX);
  });

  for (const b of spec.objects.filter((o) => o.kind === "yard_block")) {
    place(b.id, "yard_block", [0, 0.02, 44], [blocks * (blockW + 12), 0.04, ROWS_PER_BLOCK * ROW + 4]);
  }

  const cranes = spec.objects.filter((o) => o.kind === "crane");
  cranes.forEach((c, i) => place(c.id, "crane", [(i - (cranes.length - 1) / 2) * 30, 15, 110], [16, 30, 4]));

  const pos = new Map(out.map((p) => [p.id, p]));
  for (const p of spec.objects.filter((o) => o.kind === "reefer_plug")) {
    const host = p.attachedTo ? pos.get(p.attachedTo) : undefined;
    const at: [number, number, number] = host
      ? [host.pos[0] + host.size[0] / 2 + 0.6, 1, host.pos[2]]
      : [-50, 1, 40];
    place(p.id, "reefer_plug", at, [0.6, 2, 0.6]);
  }

  layoutCreator(spec, out, place);
  return out;
}

const CREATOR_SIZE: Partial<Record<ObjectKind, [number, number, number]>> = {
  door: [2.4, 2.4, 0.15],
  gripper: [0.9, 0.9, 0.9],
  motor: [0.6, 0.6, 0.6],
  sensor: [0.3, 0.3, 0.3],
  button: [0.3, 0.3, 0.15],
  actor: [0.6, 1.7, 0.6],
};

/**
 * Creator mode: hosts (doors, grippers, anything unattached) in a row; their
 * sensors on top, motors to the right, buttons to the left; actors in front.
 */
function layoutCreator(
  spec: TwinSpec,
  out: Placed[],
  place: (id: string, kind: ObjectKind, pos: [number, number, number], size: [number, number, number]) => void,
) {
  const placed = new Set(out.map((p) => p.id));
  const rest = spec.objects.filter((o) => !placed.has(o.id));
  const size = (k: ObjectKind) => CREATOR_SIZE[k] ?? [1, 1, 1];
  const isChild = (o: (typeof rest)[0]) => o.kind !== "actor" && !!o.attachedTo && rest.some((h) => h.id === o.attachedTo);
  const hosts = rest.filter((o) => o.kind !== "actor" && !isChild(o));
  hosts.forEach((h, i) => {
    const s = size(h.kind);
    const y = h.kind === "gripper" ? 1.6 : s[1] / 2;
    place(h.id, h.kind, [(i - (hosts.length - 1) / 2) * 6, y, 0], s);
  });

  const byHost = new Map<string, typeof rest>();
  for (const o of rest.filter(isChild)) byHost.set(o.attachedTo!, [...(byHost.get(o.attachedTo!) ?? []), o]);
  for (const [hostId, kids] of byHost) {
    const host = out.find((p) => p.id === hostId);
    if (!host) continue;
    const [hx, hy, hz] = host.pos;
    const [hw, hh] = host.size;
    const sensors = kids.filter((k) => k.kind === "sensor");
    sensors.forEach((k, i) => place(k.id, k.kind, [hx + (i - (sensors.length - 1) / 2) * 0.6, hy + hh / 2 + 0.3, hz - 0.2], size(k.kind)));
    kids
      .filter((k) => k.kind !== "sensor")
      .forEach((k, i) => {
        const s = size(k.kind);
        const left = k.kind === "button";
        place(k.id, k.kind, [hx + (left ? -1 : 1) * (hw / 2 + 0.6 + i * 0.8), s[1] / 2 + 0.4, hz], s);
      });
  }

  const actors = rest.filter((o) => o.kind === "actor" || (isChild(o) && !out.some((p) => p.id === o.id)));
  actors.forEach((a, i) => place(a.id, a.kind, [(i - (actors.length - 1) / 2) * 1.5, size(a.kind)[1] / 2, -3.5], size(a.kind)));
}
