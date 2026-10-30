import { NextResponse } from "next/server";
import { z } from "zod";
import { PHOTO_CONCEPTS, segmentsToTwin, type Labels, type Segment } from "@/engine/photo";
import { sparkLabelBoxes } from "@/lib/meta/agents";
import type { ModelCall } from "@/lib/meta/callLog";
import { MetaConfigError } from "@/lib/meta/client";
import { SamError, segment } from "@/lib/meta/sam";
import { SparkError } from "@/lib/meta/spark";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  image: z
    .string()
    .regex(/^data:image\/(jpeg|png|webp);base64,/, "image must be a JPEG/PNG/WebP data URL")
    .max(6_000_000),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
});

/**
 * Photo -> twin seed: SAM 3.1 segments containers, cranes, and lanes (one
 * request per noun phrase); Muse Spark vision reads codes on the boxes; the
 * engine turns segments into twin objects deterministically.
 */
export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Bad request" }, { status: 400 });
  const { image, width, height } = body.data;

  const calls: ModelCall[] = [];
  const warnings: string[] = [];
  const segments: Segment[] = [];
  try {
    const runs = await Promise.allSettled(Object.keys(PHOTO_CONCEPTS).map((c) => segment(image, c)));
    for (const [i, r] of runs.entries()) {
      const concept = Object.keys(PHOTO_CONCEPTS)[i]!;
      if (r.status === "fulfilled") {
        segments.push(...r.value.segments);
        calls.push(r.value.call);
      } else if (r.reason instanceof MetaConfigError) {
        throw r.reason;
      } else if (r.reason instanceof SamError) {
        calls.push(r.reason.call);
        warnings.push(`SAM failed for "${concept}": ${r.reason.message}`);
      } else throw r.reason;
    }
    if (!segments.some((s) => s.concept === "shipping container") && warnings.length) {
      return NextResponse.json({ error: warnings.join("; "), calls }, { status: 502 });
    }

    let labels: Labels = {};
    const boxes = segments.filter((s) => s.concept === "shipping container").slice(0, 40).map((s) => ({ id: s.objectId, box: s.box }));
    if (boxes.length) {
      try {
        const r = await sparkLabelBoxes(image, boxes);
        calls.push(r.call);
        labels = Object.fromEntries(r.data.labels.map((l) => [l.segment, l]));
      } catch (err) {
        if (!(err instanceof SparkError)) throw err;
        calls.push(err.call);
        warnings.push(`Muse Spark could not read box labels: ${err.message}`);
      }
    }
    return NextResponse.json({ segments, objects: segmentsToTwin(segments, width, height, labels), calls, warnings });
  } catch (err) {
    if (err instanceof MetaConfigError) return NextResponse.json({ error: err.message, calls }, { status: 503 });
    throw err;
  }
}
