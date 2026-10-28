// Plays each new move on the live board: one seed per pit every 120 ms from
// the previous view, then the server state, then a short "go again" or
// capture moment. A tap (skip) or the next server move flushes the queue.
// With reduced motion the board jumps to the end and only the moment shows.

import { useEffect, useState } from "react";
import { TURN_MS, type GebetaView } from "@/engine/games/gebeta";
import type { Seat } from "@/engine/types";
import { planSowing, SOW_MS, type SowFrame, type SowPlan, type Spot } from "./sowing";

export const MOMENT_MS = 1_600;

export interface Moment {
  kind: "again" | "capture";
  mover: Seat;
  n: number;
  spots: Spot[];
  /** The move it belongs to, so a repeat pops again. */
  key: number;
}

function momentOf(plan: SowPlan | null, key: number): Moment | null {
  if (!plan) return null;
  if (plan.capture) return { kind: "capture", mover: plan.mover, n: plan.capture.n, spots: plan.capture.spots, key };
  if (plan.extraTurn) return { kind: "again", mover: plan.mover, n: 0, spots: [], key };
  return null;
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function useSowing(view: GebetaView) {
  const [seen, setSeen] = useState(view);
  const [run, setRun] = useState<{ plan: SowPlan; k: number; key: number } | null>(null);
  const [moment, setMoment] = useState<Moment | null>(null);
  // The server restarts the turn clock on every move; we only see it locally.
  const [deadline, setDeadline] = useState(() => Date.now() + TURN_MS);

  // A new view: plan from the one before it. Done during render so the end
  // state never flashes up before the first frame.
  if (seen !== view) {
    setSeen(view);
    if (seen.moves !== view.moves) {
      const plan = planSowing(seen, view);
      setDeadline(Date.now() + TURN_MS);
      if (plan && !reducedMotion()) {
        setRun({ plan, k: 0, key: view.moves });
        setMoment(null);
      } else {
        setRun(null);
        setMoment(momentOf(plan, view.moves));
      }
    }
  }

  useEffect(() => {
    if (!run) return;
    const t = setTimeout(() => {
      if (run.k < run.plan.frames.length - 1) setRun({ ...run, k: run.k + 1 });
      else {
        setRun(null);
        setMoment(momentOf(run.plan, run.key));
      }
    }, SOW_MS);
    return () => clearTimeout(t);
  }, [run]);

  useEffect(() => {
    if (!moment) return;
    const t = setTimeout(() => setMoment(null), MOMENT_MS);
    return () => clearTimeout(t);
  }, [moment]);

  const frame: SowFrame | null = run ? run.plan.frames[run.k] : null;
  return {
    frame,
    moment,
    deadline,
    skip() {
      if (!run) return;
      setRun(null);
      setMoment(momentOf(run.plan, run.key));
    },
  };
}
