"use client";

// The turn clock in the match header and the thin progress bar under it.
// Both turn coral at 10 s or less; the timer pulses and is announced to
// screen readers only at 10 s and 5 s so it doesn't chatter every second.

import { useEffect, useState } from "react";
import { Icon3D } from "@/components/ui/Icon3D";

export const URGENT_SECONDS = 10;

/** Milliseconds left until `deadline`, ticking every 250 ms. */
export function useTimeLeft(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, deadline - now);
}

function clock(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export function TurnTimer({ deadline }: { deadline: number | null }) {
  const left = useTimeLeft(deadline);
  const secs = left === null ? null : Math.ceil(left / 1000);
  const urgent = secs !== null && secs <= URGENT_SECONDS;

  // Hold the announcement at the last threshold crossed: 10, then 5.
  const announce = secs === null || secs > URGENT_SECONDS ? "" : secs > 5 ? "10 seconds left" : "5 seconds left";

  return (
    <span
      className={`inline-flex h-9 flex-none items-center gap-1 rounded-chip pl-1.5 pr-3 font-mono text-[16px] font-semibold tabular-nums ${
        urgent ? "animate-urgent bg-mismatch text-bg" : "bg-sf-2 text-ink"
      }`}
    >
      <Icon3D name="stopwatch" size={24} />
      <span aria-hidden>{secs === null ? "–:––" : clock(secs)}</span>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </span>
  );
}

/** Share of the turn left, as a 3 px bar. */
export function TurnBar({ deadline, total }: { deadline: number | null; total: number }) {
  const left = useTimeLeft(deadline);
  const share = left === null || total <= 0 ? 1 : Math.min(1, left / total);
  const urgent = left !== null && left <= URGENT_SECONDS * 1000;
  return (
    <div className="h-[3px] overflow-hidden rounded-sm bg-sf-3" aria-hidden>
      <i
        className={`block h-full rounded-sm transition-[width] duration-[250ms] ease-linear ${urgent ? "bg-mismatch" : "bg-accent"}`}
        style={{ width: `${share * 100}%` }}
      />
    </div>
  );
}
