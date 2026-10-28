// How a game plugs into MatchFrame. Each game exports one adapter; the match
// page picks `adapters[view.game]` and renders it inside the frame.

import type { FC } from "react";
import type { Seat, Viewer } from "@/engine/types";
import type { Icon3DName } from "@/components/ui/Icon3D";

export type GameId = "crack-the-code" | "gebeta";

export interface TurnClock {
  /** Epoch ms when the current turn times out. Left out when the view does
   *  not carry it; the frame then uses the server's match deadline. */
  deadline?: number;
  /** Full length of the turn in ms, for the progress bar. */
  total: number;
  /** Whose clock is running. */
  owner: Seat | "both";
}

export interface AdapterPlayer {
  id: string;
  name: string;
  bot?: boolean;
}

/** The commit block for a match's hidden data, once it is sealed. */
export interface MatchCommit {
  commitments: Record<string, string>;
  ledgerIndex: number;
}

/** A move the server refused. `n` counts refusals, so a repeat is a new value. */
export interface MoveError {
  reason: string;
  n: number;
}

export interface GameAdapter<View, Move> {
  id: GameId;
  icon: Icon3DName;
  /** `names` are the players' display names by seat; `players` adds ids and bot flags.
   *  `commit` arrives live when the commit block is sealed; `error` is the last refused move. */
  Board: FC<{
    view: View;
    seat: Viewer;
    onMove(m: Move): void;
    disabled: boolean;
    names: [string, string];
    players?: [AdapterPlayer, AdapterPlayer];
    commit?: MatchCommit | null;
    error?: MoveError | null;
  }>;
  /** One plain sentence for the aria-live status line, e.g. "Your turn". */
  status(view: View, seat: Viewer, names: [string, string]): string;
  /** Optional short seat label under a player's name, e.g. "Locked". */
  seatState?(view: View, seat: Seat): string;
  timer(view: View): TurnClock;
  ReplayStep: FC<{ log: Move[]; step: number }>;
  rules: { title: string; lines: string[]; art: Icon3DName };
  /** False for Gebeta, so there is no commit notice. */
  hasHiddenInfo: boolean;
  /** True when the Board shows refused moves itself, so the page does not. */
  showsErrors?: boolean;
}
