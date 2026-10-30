import { NextResponse } from "next/server";
import { z } from "zod";
import { MetaConfigError } from "@/lib/meta/client";
import { SparkError, sparkJSON } from "@/lib/meta/spark";

export const runtime = "nodejs";
export const maxDuration = 30;

const Explanation = z.object({
  headline: z.string().describe("max 12 words, e.g. 'Inspect MSCU1234565: scale contradicts the carrier'"),
  explanation: z.string().describe("2-3 plain sentences for a terminal planner; cite the signals and their trust"),
  changeMyMind: z.string().describe("one sentence: what new evidence would justify a gentler action"),
});

const SYSTEM = `You explain DockTwin decisions to port terminal planners. The decision was made by a deterministic engine; you must not change it, second-guess its level, or invent facts. Use only the evidence provided: rules that fired, signals with their trust scores and notes, contradictions, the safety floor, confidence, and the itemised cost estimate. Plain language, no jargon like "invariant" (say "safety rule"). Dollar figures are estimates; say so.`;

/** Muse Spark explains an engine decision; it never makes one. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 30_000) return NextResponse.json({ error: "Decision payload too large" }, { status: 413 });
  let body: { decision?: unknown } | null = null;
  try {
    body = JSON.parse(raw || "null");
  } catch {
    /* falls through to 400 */
  }
  const decision = z
    .object({ subject: z.string(), level: z.string(), confidence: z.number() })
    .passthrough()
    .safeParse(body?.decision);
  if (!decision.success) return NextResponse.json({ error: "Expected { decision }" }, { status: 400 });
  const d = decision.data as { subject: string; level: string; confidence: number; [k: string]: unknown };

  try {
    const { data, call } = await sparkJSON({
      step: "explain decision",
      schemaName: "Explanation",
      schema: Explanation,
      system: SYSTEM,
      user: JSON.stringify(d),
      mock: () => ({
        headline: `[MOCK] ${d.level.toUpperCase()} ${d.subject}`,
        explanation: `[MOCK] The engine recommends ${d.level} with confidence ${d.confidence.toFixed(2)}. Connect MODEL_API_KEY for a Muse Spark explanation.`,
        changeMyMind: "[MOCK] A fresh, trusted reading that clears the triggering condition.",
      }),
      reasoningEffort: "low",
    });
    return NextResponse.json({ explanation: data, calls: [call] });
  } catch (err) {
    if (err instanceof MetaConfigError) return NextResponse.json({ error: err.message, calls: [] }, { status: 503 });
    if (err instanceof SparkError) return NextResponse.json({ error: err.message, calls: [err.call] }, { status: 502 });
    throw err;
  }
}
