// Tiny test game for engine and runtime tests. Not registered for players.
// Seats alternate; each turn you either score a point or pass. First to 3 wins.
// Each seat also gets a hidden token from the seed so tests can check hiding.

import { createRng } from "../rng";
import type { GameDef, Seat, Viewer } from "../types";

export type FirstToThreeMove = { type: "point" } | { type: "pass" };

export interface FirstToThreeState {
  turn: Seat;
  scores: [number, number];
  secrets: [string, string];
  moves: number;
}

export interface FirstToThreeView {
  turn: Seat;
  scores: [number, number];
  moves: number;
  mySecret: string | null;
}

export const TURN_MS = 10_000;

function isMove(m: unknown): m is FirstToThreeMove {
  if (typeof m !== "object" || m === null) return false;
  const type = (m as { type?: unknown }).type;
  return type === "point" || type === "pass";
}

function play(s: FirstToThreeState, seat: Seat, m: FirstToThreeMove): FirstToThreeState {
  const scores: [number, number] = [s.scores[0], s.scores[1]];
  if (m.type === "point") scores[seat] += 1;
  return { ...s, scores, turn: seat === 0 ? 1 : 0, moves: s.moves + 1 };
}

export const firstToThree: GameDef<FirstToThreeState, FirstToThreeMove, FirstToThreeView> = {
  id: "first-to-three",
  name: "First to Three",

  setup({ seed }) {
    const rng = createRng(`${seed}:setup`);
    const token = () => String(1000 + rng.int(9000));
    return { turn: 0, scores: [0, 0], secrets: [token(), token()], moves: 0 };
  },

  validate(s, seat, m) {
    if (seat !== s.turn) return "not your turn";
    if (!isMove(m)) return "move must be {type: 'point' | 'pass'}";
    return null;
  },

  apply: play,

  onTimeout(s, rng) {
    return play(s, s.turn, { type: rng.next() < 0.5 ? "point" : "pass" });
  },

  deadlineMs: () => TURN_MS,

  activeSeats: (s) => [s.turn],

  outcome(s) {
    for (const seat of [0, 1] as const) {
      if (s.scores[seat] >= 3) return { winner: seat, draw: false, reason: "reached 3" };
    }
    return null;
  },

  view(s, viewer: Viewer) {
    return {
      turn: s.turn,
      scores: [s.scores[0], s.scores[1]],
      moves: s.moves,
      mySecret: viewer === "spectator" ? null : s.secrets[viewer],
    };
  },


  reveal: (s) => ({ secrets: s.secrets }),

  bot(_view, _seat, rng) {
    return { type: rng.next() < 0.7 ? "point" : "pass" };
  },
};
