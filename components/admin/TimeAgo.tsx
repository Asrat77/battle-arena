"use client";

// "5m ago" that stays current (one shared 30 s ticker), with the full Addis
// Ababa date in the tooltip and a machine-readable datetime.

import { useEffect, useSyncExternalStore } from "react";
import { dateTime, fullDate, timeAgo } from "@/lib/admin/format";

const listeners = new Set<() => void>();
let now = Date.now();
let timer: number | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (timer === null) {
    timer = window.setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

/** The current time, updated every 30 s (shared by every caller). */
export function useNow(): number {
  const value = useSyncExternalStore(subscribe, () => now, () => 0);
  useEffect(() => {
    now = Date.now();
  }, []);
  return value || Date.now();
}

export function TimeAgo({ ts, mode = "ago", className = "" }: { ts: number | null | undefined; mode?: "ago" | "date"; className?: string }) {
  const current = useNow();
  if (ts == null) return <span className="text-ink-3">–</span>;
  return (
    <time dateTime={new Date(ts).toISOString()} title={fullDate(ts)} className={`whitespace-nowrap ${className}`} suppressHydrationWarning>
      {mode === "date" ? dateTime(ts) : timeAgo(ts, current)}
    </time>
  );
}
