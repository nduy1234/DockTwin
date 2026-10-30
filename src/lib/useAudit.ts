"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appendEntry, verifyChain, type AuditEntry, type AuditInput } from "@/engine/audit";

const KEY = "docktwin.audit.v1";

/**
 * Client-side append-only audit log, hash-chained and persisted per browser.
 * Appends are serialised so seq/prev links stay correct under concurrent calls.
 */
export function useAudit() {
  const [log, setLog] = useState<AuditEntry[]>([]);
  const [chain, setChain] = useState<{ ok: boolean; detail?: string }>({ ok: true });
  const ref = useRef<AuditEntry[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]") as AuditEntry[];
      if (Array.isArray(saved)) {
        ref.current = saved;
        setLog(saved);
      }
    } catch {
      /* storage unavailable: start empty */
    }
  }, []);

  useEffect(() => {
    let live = true;
    void verifyChain(log).then((r) => {
      if (live) setChain(r.ok ? { ok: true } : { ok: false, detail: `#${r.badSeq}: ${r.reason}` });
    });
    return () => {
      live = false;
    };
  }, [log]);

  const append = useCallback((input: AuditInput) => {
    queue.current = queue.current.then(async () => {
      const entry = await appendEntry(ref.current, input);
      ref.current = [...ref.current, entry];
      setLog(ref.current);
      try {
        localStorage.setItem(KEY, JSON.stringify(ref.current));
      } catch {
        /* quota or private mode: keep in memory */
      }
    });
    return queue.current;
  }, []);

  const clear = useCallback(() => {
    ref.current = [];
    setLog([]);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { log, chain, append, clear };
}
