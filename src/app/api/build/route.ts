import { NextResponse } from "next/server";
import { z } from "zod";
import { checkTwin, TwinSpec } from "@/engine/schema";
import { MetaConfigError } from "@/lib/meta/client";
import { SparkError, sparkJSON } from "@/lib/meta/spark";
import { mockPortTwin, PORT_SYSTEM } from "@/templates/port";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  text: z.string().trim().min(3).max(4000),
  domain: z.enum(["port"]).default("port"),
});

/** Describe -> Build: Muse Spark turns plain English into a validated TwinSpec. */
export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Expected { text: string }" }, { status: 400 });
  }
  const { text } = body.data;

  try {
    const { data, call } = await sparkJSON({
      step: "describe→build twin",
      schemaName: "TwinSpec",
      schema: TwinSpec,
      system: PORT_SYSTEM,
      user: text,
      check: (spec) => [
        ...checkTwin(spec),
        ...(spec.domain !== "port" ? ['domain must be "port"'] : []),
      ],
      mock: () => mockPortTwin(text),
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
