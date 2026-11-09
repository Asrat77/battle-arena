// Plain words for the Battleship status line, kept apart from the board so they can be tested in Node.

import { cellName, FLEET, other, type BattleshipView } from "@/engine/games/battleship";
import type { Viewer } from "@/engine/types";

export interface ShotWords {
  kind: "hit" | "miss" | "sunk";
  text: string;
  /** One or two words for the callout over the sea. */
  short: string;
}

/** The newest shot of the match, told from the viewer's side. */
export function lastShot(view: BattleshipView, seat: Viewer, names: [string, string]): ShotWords | null {
  if (!view.last) return null;
  const s = view.last.seat;
  const shot = view.shots[s][view.shots[s].length - 1];
  if (!shot) return null;
  const who = s === seat ? "You" : names[s];
  const whose = other(s) === seat ? "your" : seat === "spectator" ? `${names[other(s)]}’s` : "their";
  const at = cellName(shot.cell);
  if (shot.sunk !== null) return { kind: "sunk", text: `${who} sank ${whose} ${FLEET[shot.sunk].name}`, short: `Sunk · ${FLEET[shot.sunk].name}` };
  return shot.hit ? { kind: "hit", text: `${who} hit ${at}`, short: `Hit · ${at}` } : { kind: "miss", text: `${who} missed at ${at}`, short: `Miss · ${at}` };
}

/** True while seat 1 takes the reply shot after seat 0 sank its whole fleet. */
export const replyShot = (view: BattleshipView) => view.phase === "battle" && view.sunk[1].length === FLEET.length;

export function battleshipStatus(view: BattleshipView, seat: Viewer, names: [string, string]): string {
  if (view.phase === "over") return "Match over";
  if (view.phase === "placing") {
    if (seat === "spectator") return "Both fleets are being placed";
    return view.placed[seat] ? `Fleet ready · waiting for ${names[other(seat)]}` : "Place your fleet";
  }
  const last = lastShot(view, seat, names);
  const next = replyShot(view)
    ? seat === 1 ? "one reply shot to draw" : `${names[1]} gets one reply shot`
    : view.turn === seat ? "your shot" : `${names[view.turn]} to fire`;
  return last ? `${last.text} · ${next}` : next[0].toUpperCase() + next.slice(1);
}

/** Shots fired and hits scored by a seat. */
export function accuracy(view: BattleshipView, seat: 0 | 1) {
  const shots = view.shots[seat].length;
  const hits = view.shots[seat].filter((s) => s.hit).length;
  return { shots, hits, pct: shots ? Math.round((hits / shots) * 100) : 0 };
}
