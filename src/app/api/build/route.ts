import { NextResponse } from "next/server";
import { z } from "zod";
import { checkTwin, TwinObject, TwinSpec } from "@/engine/schema";
import { MetaConfigError } from "@/lib/meta/client";
import { SparkError, sparkJSON } from "@/lib/meta/spark";
import { TEMPLATES } from "@/templates";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  text: z.string().trim().min(3).max(4000),
  domain: z.enum(["port", "creator"]).default("port"),
  /** Objects detected in a photo (SAM 3.1). Kept verbatim in the twin. */
  seed: z.array(TwinObject).max(60).optional(),
});

/** Describe -> Build: Muse Spark turns plain English (+ photo objects) into a validated TwinSpec, for either domain. */
export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Expected { text: string, seed?: TwinObject[] }" }, { status: 400 });
  }
  const { text, domain, seed = [] } = body.data;
  const template = TEMPLATES[domain];
  const user = seed.length
    ? `${text}\n\nThese objects were detected in a terminal photo by SAM 3.1 (photo_box is the pixel box). Include every one of them with the same id, kind, and props; you may add props and add objects the description implies. Write rules and safety invariants that cover them.\n${JSON.stringify(seed)}`
    : text;

  try {
    const { data, call } = await sparkJSON({
      step: seed.length ? "photo+text → build twin" : "describe→build twin",
      schemaName: "TwinSpec",
      schema: TwinSpec,
      system: template.system,
      user,
      check: (spec) => {
        const ids = new Set(spec.objects.map((o) => o.id));
        return [
          ...checkTwin(spec),
          ...(spec.domain !== domain ? [`domain must be "${domain}"`] : []),
          ...seed.filter((o) => !ids.has(o.id)).map((o) => `photo object "${o.id}" is missing; keep every detected object`),
        ];
      },
      mock: () => {
        const spec = template.mock(text);
        const ids = new Set(seed.map((o) => o.id));
        return { ...spec, objects: [...seed, ...spec.objects.filter((o) => !ids.has(o.id))] };
      },
    });
    return NextResponse.json({ spec: data, calls: [call] });
  } catch (err) {
    if (err instanceof MetaConfigError) {
      return NextResponse.json({ error: err.message, calls: [] }, { status: 503 });
    }
    if (err instanceof SparkError) {
      return NextResponse.json({ error: `Muse Spark failed: ${err.message}`, calls: [err.call] }, { status: 502 });
    }
    throw err;
  }
}
