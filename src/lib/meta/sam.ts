import "server-only";
import { decodeMaskToSVGPath, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import type { Segment } from "@/engine/photo";
import type { ModelCall } from "./callLog";
import { isMock, meta, MODELS } from "./client";
import { MIN_ATTEMPT_MS, REQUEST_TIMEOUT_MS } from "./budget";
import { withRetry } from "./retry";
import { errorText } from "./spark";

export class SamError extends Error {
  constructor(
    message: string,
    readonly call: ModelCall,
  ) {
    super(message);
  }
}

type RawEvent = {
  type?: string;
  item_id?: unknown;
  output_index?: unknown;
  content_index?: unknown;
  part?: { type?: unknown; text?: unknown } | null;
};

/**
 * The parser finalises a text lane on `response.output_text.done`; the API may
 * only send `response.content_part.done`. Emit the former from the latter once
 * per lane (and pass through a real one if it does arrive).
 */
async function* withTextDone(stream: AsyncIterable<unknown>): AsyncGenerator<{ type: string }> {
  const done = new Set<string>();
  for await (const raw of stream) {
    const e = raw as RawEvent;
    const lane = `${String(e.item_id)}:${String(e.output_index)}:${String(e.content_index)}`;
    if (e.type === "response.output_text.done") {
      if (done.has(lane)) continue;
      done.add(lane);
    }
    yield raw as { type: string };
    if (e.type === "response.content_part.done" && e.part?.type === "output_text" && typeof e.part.text === "string" && !done.has(lane)) {
      done.add(lane);
      yield { type: "response.output_text.done", item_id: e.item_id, output_index: e.output_index, content_index: e.content_index, text: e.part.text } as {
        type: string;
      };
    }
  }
}

/** SAM 3.1 on one image for one noun phrase. Returns every match as box + mask path. */
export async function segment(imageDataUrl: string, concept: string, deadline: number): Promise<{ segments: Segment[]; call: ModelCall }> {
  const started = Date.now();
  const call: ModelCall = {
    step: `segment "${concept}"`,
    model: MODELS.sam,
    endpoint: "POST /v1/responses (stream)",
    ms: 0,
    attempts: 0,
    repaired: false,
    mock: false,
    ok: false,
  };
  if (isMock()) {
    return { segments: mockSegments(concept), call: { ...call, mock: true, ok: true, attempts: 1, ms: Date.now() - started } };
  }
  const client = meta();
  try {
    const result = await withRetry(
      async (_, timeoutMs) => {
        const stream = await client.responses.create(
          {
          model: MODELS.sam,
          stream: true,
          input: [
            {
              type: "message",
              role: "user",
              content: [
                { type: "input_text", text: concept },
                { type: "input_image", image_url: imageDataUrl, detail: "auto" },
              ],
            },
          ],
          },
          // The signal also aborts the stream mid-read, so a stalled stream cannot outlive its budget.
          { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) },
        );
        return parseImageStream(withTextDone(stream)).finalResult;
      },
      { deadline, requestTimeoutMs: REQUEST_TIMEOUT_MS, minAttemptMs: MIN_ATTEMPT_MS, onAttempt: () => call.attempts++ },
    );
    if (result.outcome.status !== "completed") throw new Error(`segmentation ${result.outcome.status}`);
    const masks = new Map(recordsOfKind(result.records, "mask").map((m) => [m.objectId, m]));
    const segments: Segment[] = recordsOfKind(result.records, "box").map((b) => {
      const m = masks.get(b.objectId);
      return {
        concept,
        objectId: `${concept}#${b.objectId}`,
        box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
        ...(m ? { mask: { path: decodeMaskToSVGPath(m.mask), width: m.mask.width, height: m.mask.height } } : {}),
      };
    });
    Object.assign(call, { ok: true, ms: Date.now() - started });
    return { segments, call };
  } catch (err) {
    Object.assign(call, { ms: Date.now() - started, error: errorText(err) });
    throw new SamError(errorText(err), call);
  }
}

/** Offline mock: a fixed grid so the photo flow is testable without a key. */
function mockSegments(concept: string): Segment[] {
  if (concept !== "shipping container") return [];
  return Array.from({ length: 6 }, (_, i) => ({
    concept,
    objectId: `${concept}#mock${i}`,
    box: { left: 120 + (i % 3) * 260, top: 520 - Math.floor(i / 3) * 90, right: 360 + (i % 3) * 260, bottom: 600 - Math.floor(i / 3) * 90 },
  }));
}
