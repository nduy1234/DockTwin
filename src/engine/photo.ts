/**
 * Photo -> twin seed. Pure and deterministic: turns SAM 3.1 boxes into twin
 * objects with stable ids, stack tiers, and lane attachment.
 */
import type { TwinObject } from "./schema";

export type Box = { left: number; top: number; right: number; bottom: number };
export type Segment = {
  concept: string;
  objectId: string;
  box: Box;
  mask?: { path: string; width: number; height: number };
};

/** Noun phrases sent to SAM (one request each) and the twin kind they seed. */
export const PHOTO_CONCEPTS = {
  "shipping container": "container",
  crane: "crane",
  "road lane": "gate_lane",
} as const;
export type PhotoConcept = keyof typeof PHOTO_CONCEPTS;

const MAX_CONTAINERS = 40;
const MIN_AREA_FRACTION = 0.0004;

const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
const cx = (b: Box) => (b.left + b.right) / 2;
const cy = (b: Box) => (b.top + b.bottom) / 2;
const xOverlap = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) / Math.min(a.right - a.left, b.right - b.left || 1);

export type Labels = Record<string, { code?: string | null; reefer?: boolean | null; color?: string | null }>;

export function segmentsToTwin(segments: Segment[], width: number, height: number, labels: Labels = {}): TwinObject[] {
  const minArea = width * height * MIN_AREA_FRACTION;
  const of = (kind: string) =>
    segments
      .filter((s) => PHOTO_CONCEPTS[s.concept as PhotoConcept] === kind && area(s.box) >= minArea)
      .sort((a, b) => cx(a.box) - cx(b.box) || cy(a.box) - cy(b.box));

  const lanes = of("gate_lane").map((s, i) => ({ s, id: `LANE-${i + 1}` }));
  const cranes = of("crane").map((s, i) => ({ s, id: `CRANE-${i + 1}` }));
  // Keep the largest boxes when SAM finds a whole yard; then restore left-to-right order.
  const boxes = of("container")
    .sort((a, b) => area(b.box) - area(a.box))
    .slice(0, MAX_CONTAINERS)
    .sort((a, b) => cx(a.box) - cx(b.box) || cy(a.box) - cy(b.box));

  const px = (b: Box) => `${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}`;
  const out: TwinObject[] = [];
  for (const { s, id } of lanes) {
    out.push({ id, kind: "gate_lane", label: `Lane seen in photo`, props: [{ key: "status", value: "up" }, { key: "photo_box", value: px(s.box) }], attachedTo: null });
  }
  for (const { s, id } of cranes) {
    out.push({ id, kind: "crane", label: "Crane seen in photo", props: [{ key: "status", value: "up" }, { key: "photo_box", value: px(s.box) }], attachedTo: null });
  }

  const used = new Set(out.map((o) => o.id));
  boxes.forEach((s, i) => {
    // Tier = how many boxes in the same column sit lower in the image.
    const tier = boxes.filter((o) => o !== s && xOverlap(o.box, s.box) > 0.5 && cy(o.box) > cy(s.box)).length;
    const lane = lanes.find((l) => cx(s.box) >= l.s.box.left && cx(s.box) <= l.s.box.right && cy(s.box) >= l.s.box.top && cy(s.box) <= l.s.box.bottom);
    const label = labels[s.objectId] ?? {};
    const code = label.code && /^[A-Z]{4}\d{7}$/.test(label.code) && !used.has(label.code) ? label.code : null;
    const id = code ?? `BOX-${String(i + 1).padStart(2, "0")}`;
    used.add(id);
    const props: TwinObject["props"] = [
      { key: "tier", value: tier },
      { key: "photo_box", value: px(s.box) },
      { key: "detected_by", value: "sam-3.1" },
    ];
    if (typeof label.reefer === "boolean") props.push({ key: "reefer", value: label.reefer });
    if (label.color) props.push({ key: "color", value: label.color });
    out.push({ id, kind: "container", label: code ? `${code} (read from photo)` : `Box ${i + 1} from photo`, props, attachedTo: lane?.id ?? null });
  });
  return out;
}
