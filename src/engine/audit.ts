/**
 * Append-only, hash-chained audit log. Each entry commits to the previous
 * entry's hash, so editing or deleting any past entry breaks verification.
 * Uses Web Crypto SHA-256 (browser and Node 20+).
 */

export type AuditActor = "planner" | "engine" | "policy" | `model:${string}`;

export type AuditInput = {
  actor: AuditActor;
  action: string; // e.g. "twin.built", "decision.recommended", "decision.approved", "fix.applied"
  subject?: string;
  summary: string;
  data?: Record<string, unknown>;
};

export type AuditEntry = AuditInput & { seq: number; at: string; prev: string; hash: string };

export const GENESIS = "0".repeat(64);

async function sha256(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Canonical JSON: sorted keys, so the hash doesn't depend on insertion order. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

export async function appendEntry(log: AuditEntry[], input: AuditInput, now = new Date()): Promise<AuditEntry> {
  const last = log.at(-1);
  const body = { ...input, seq: (last?.seq ?? 0) + 1, at: now.toISOString(), prev: last?.hash ?? GENESIS };
  return { ...body, hash: await sha256(canonical(body)) };
}

export async function verifyChain(log: AuditEntry[]): Promise<{ ok: true } | { ok: false; badSeq: number; reason: string }> {
  let prev = GENESIS;
  for (const e of log) {
    if (e.prev !== prev) return { ok: false, badSeq: e.seq, reason: "previous-hash link broken" };
    const { hash, ...body } = e;
    if ((await sha256(canonical(body))) !== hash) return { ok: false, badSeq: e.seq, reason: "entry contents altered" };
    prev = hash;
  }
  return { ok: true };
}
