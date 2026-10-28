// How a game plugs into MatchFrame. Each game exports one adapter; the match
// page picks `adapters[view.game]` and renders it inside the frame.

import type { FC } from "react";
import type { Seat, Viewer } from "@/engine/types";
import type { Icon3DName } from "@/components/ui/Icon3D";

export type GameId = "crack-the-code" | "gebeta";

export interface TurnClock {
  /** Epoch ms when the current turn times out. */
  deadline: number;
  /** Full length of the turn in ms, for the progress bar. */
  total: number;
  /** Whose clock is running. */
  owner: Seat | "both";
}

export interface GameAdapter<View, Move> {
  id: GameId;
  icon: Icon3DName;
  Board: FC<{ view: View; seat: Viewer; onMove(m: Move): void; disabled: boolean }>;
  /** One plain sentence for the aria-live status line, e.g. "Your turn". */
  status(view: View, seat: Viewer): string;
  timer(view: View): TurnClock;
  ReplayStep: FC<{ log: Move[]; step: number }>;
  rules: { title: string; lines: string[]; art: Icon3DName };
  /** False for Gebeta, so there is no commit notice. */
  hasHiddenInfo: boolean;
}
