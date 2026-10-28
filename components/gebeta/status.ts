// Pure helpers behind the Gebeta adapter: which pits can be played, the
// status line and the hint under the board.

import type { GebetaView } from "@/engine/games/gebeta";
import type { Seat, Viewer } from "@/engine/types";
import type { Moment } from "./useSowing";

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

export function legalFor(view: GebetaView, seat: Seat): number[] {
  if (view.over || view.turn !== seat) return [];
  return view.pits[seat].flatMap((n, i) => (n > 0 ? [i] : []));
}

export function gebetaStatus(view: GebetaView, seat: Seat | "spectator", names: [string, string] = ["Seat 1", "Seat 2"]): string {
  const [a, b] = view.stores;
  if (view.over) {
    if (a === b) return `Draw · ${a}–${b}`;
    const winner: Seat = a > b ? 0 : 1;
    const score = `${Math.max(a, b)}–${Math.min(a, b)}`;
    if (seat === "spectator") return `${names[winner]} wins · ${score}`;
    return `${winner === seat ? "You win" : `${names[winner]} wins`} · ${score}`;
  }
  const last = view.last;
  const again = last?.extraTurn && last.seat === view.turn;
  const took = last && last.captured > 0 ? last : null;
  if (seat === "spectator") {
    if (took) return `${names[took.seat]} captured ${took.captured} · ${names[view.turn]}'s turn`;
    return `${names[view.turn]}${again ? " goes again" : "'s turn"}`;
  }
  if (took) return took.seat === seat ? `+${took.captured} captured · ${names[other(seat)]} next` : `${names[took.seat]} captured ${took.captured} · your turn`;
  if (view.turn === seat) return again ? "Go again!" : "Your turn";
  return `${names[other(seat)]} is thinking`;
}

const seedsWord = (n: number) => `${n} ${n === 1 ? "seed" : "seeds"}`;

/** The line under the board: sowing, the move's moment, the auto-play
 *  warning, or a nudge while the opponent plays. */
export function boardHint({
  view,
  seat,
  names,
  hand,
  moment,
  auto,
  disabled,
}: {
  view: GebetaView;
  seat: Viewer;
  names: [string, string];
  /** Seeds still sowing, or null when the board is settled. */
  hand: number | null;
  moment: Moment | null;
  auto: boolean;
  disabled: boolean;
}): string {
  if (hand !== null) return hand > 0 ? `${seedsWord(hand)} still travelling · tap the board to skip` : "";
  const mine = moment?.mover === seat;
  if (moment?.kind === "again")
    return mine ? "Last seed hit your store · timer reset to 30 s" : `${names[moment.mover]}'s last seed hit their store`;
  if (moment?.kind === "capture") {
    if (mine) return `Your empty pit and ${names[other(seat as Seat)]}'s opposite pit empty into your store`;
    const whose = seat === "spectator" ? "the opposite pit" : "your opposite pit";
    return `${names[moment.mover]}'s empty pit and ${whose} empty into their store`;
  }
  if (disabled || view.over || seat === "spectator") return "";
  if (auto) return "Your first non-empty pit plays itself at 0:00";
  return view.turn === seat ? "" : "Your pits wake up when it's your turn";
}
