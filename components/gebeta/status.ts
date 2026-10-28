// Pure helpers behind the Gebeta adapter: which pits can be played and the
// status line.

import type { GebetaView } from "@/engine/games/gebeta";
import type { Seat } from "@/engine/types";

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
  const again = view.last?.extraTurn && view.last.seat === view.turn;
  if (seat === "spectator") return `${names[view.turn]}${again ? " goes again" : "'s turn"}`;
  if (view.turn === seat) return again ? "Go again!" : "Your turn";
  return `${names[other(seat)]} is thinking`;
}
