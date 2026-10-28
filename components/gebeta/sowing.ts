// Pure planner behind the sowing animation: given the board before and after
// one move, replay the sow seed by seed so the board can drop one seed per
// frame, then name the moment it ends on (go again, a capture, or nothing).

import { PITS, storeOf, type GebetaView } from "@/engine/games/gebeta";
import type { Seat } from "@/engine/types";

export const SOW_MS = 120;

/** A pit along its owner's row, or a seat's store. */
export type Spot = { seat: Seat; pit: number } | { seat: Seat; store: true };

export interface SowFrame {
  pits: [number[], number[]];
  stores: [number, number];
  /** Where the latest seed dropped; null on the pick-up frame. */
  hit: Spot | null;
  /** Seeds still in hand after this frame. */
  hand: number;
}

export interface SowPlan {
  mover: Seat;
  /** Pick-up first, then one frame per seed. */
  frames: SowFrame[];
  extraTurn: boolean;
  /** The landing pit and the one opposite, emptied into the mover's store. */
  capture: { spots: [Spot, Spot]; n: number } | null;
}

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const boardOf = (v: Pick<GebetaView, "pits" | "stores">) => [...v.pits[0], v.stores[0], ...v.pits[1], v.stores[1]];

function spotAt(i: number): Spot {
  if (i === storeOf(0)) return { seat: 0, store: true };
  if (i === storeOf(1)) return { seat: 1, store: true };
  return i < PITS ? { seat: 0, pit: i } : { seat: 1, pit: i - PITS - 1 };
}

function frameOf(b: number[], hit: Spot | null, hand: number): SowFrame {
  return {
    pits: [b.slice(0, PITS), b.slice(PITS + 1, 2 * PITS + 1)],
    stores: [b[storeOf(0)], b[storeOf(1)]],
    hit,
    hand,
  };
}

export const sameSpot = (a: Spot | null | undefined, b: Spot) =>
  !!a && a.seat === b.seat && ("store" in a ? "store" in b : "pit" in b && a.pit === b.pit);

/** The frames from `prev` to `next`, or null when `next` isn't exactly one
 *  move later or the replayed sow doesn't match it (then just jump). */
export function planSowing(prev: GebetaView, next: GebetaView): SowPlan | null {
  const last = next.last;
  if (!last || next.moves !== prev.moves + 1) return null;
  const { seat, pit } = last;
  const b = boardOf(prev);
  let i = seat === 0 ? pit : PITS + 1 + pit;
  let hand = b[i];
  if (hand === 0) return null;
  b[i] = 0;
  const frames = [frameOf(b, null, hand)];
  const skip = storeOf(other(seat));
  while (hand > 0) {
    i = (i + 1) % b.length;
    if (i === skip) continue;
    b[i] += 1;
    hand -= 1;
    frames.push(frameOf(b, spotAt(i), hand));
  }

  let capture: SowPlan["capture"] = null;
  if (last.captured > 0) {
    const opposite = 2 * PITS - i;
    capture = { spots: [spotAt(i), spotAt(opposite)], n: last.captured };
    b[storeOf(seat)] += b[i] + b[opposite];
    b[i] = 0;
    b[opposite] = 0;
  }
  // A finished game also sweeps both sides, so only check a game in play.
  if (!next.over && boardOf(next).some((n, k) => n !== b[k])) return null;
  return { mover: seat, frames, extraTurn: last.extraTurn, capture };
}
