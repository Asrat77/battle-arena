// Gebeta (Kalah-style mancala) for two seats. No hidden information, so the
// view is the whole board.
//
// Board layout, indices into `board` (14 slots), sown counter-clockwise in
// increasing index order:
//   seat 1:  12 11 10  9  8  7
//        13                    6
//   seat 0:   0  1  2  3  4  5
// 0..5 are seat 0's pits, 6 its store, 7..12 seat 1's pits, 13 its store.

import type { GameDef, Rng, Seat, Viewer } from "../types";

export const PITS = 6;
export const SEEDS_PER_PIT = 4;
export const TOTAL_SEEDS = PITS * 2 * SEEDS_PER_PIT;
export const TURN_MS = 30_000;

export const rulesText = [
  "Gebeta, Kalah variant: 6 pits a side, 4 seeds per pit, one store each.",
  "On your turn pick one of your non-empty pits and sow its seeds one by one counter-clockwise, into your own store but skipping your opponent's.",
  "If the last seed lands in your store, you move again.",
  "If the last seed lands in an empty pit on your side and the opposite pit has seeds, you capture both into your store.",
  "When either side has no seeds left, each player sweeps the seeds on their side into their own store and the game ends.",
  "Most seeds in store wins; equal stores is a draw. Each turn has 30 seconds; on timeout your leftmost non-empty pit is played.",
].join(" ");

/** `pit` is 0..5, counted from the mover's left along their own row. */
export interface GebetaMove {
  pit: number;
}

export interface GebetaLast {
  seat: Seat;
  pit: number;
  extraTurn: boolean;
  captured: number;
}

export interface GebetaState {
  board: number[];
  turn: Seat;
  moves: number;
  last: GebetaLast | null;
  over: boolean;
}

export interface GebetaView {
  /** pits[seat][i] = seeds in that seat's pit i. */
  pits: [number[], number[]];
  stores: [number, number];
  turn: Seat;
  moves: number;
  last: GebetaLast | null;
  over: boolean;
  you: Seat | null;
}

export const storeOf = (seat: Seat) => (seat === 0 ? PITS : 2 * PITS + 1);
const pitIndex = (seat: Seat, pit: number) => (seat === 0 ? pit : PITS + 1 + pit);
const ownsPit = (seat: Seat, i: number) => (seat === 0 ? i >= 0 && i < PITS : i > PITS && i < 2 * PITS + 1);
const opposite = (i: number) => 2 * PITS - i;
const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export function legalPits(board: readonly number[], seat: Seat): number[] {
  const out: number[] = [];
  for (let p = 0; p < PITS; p++) if (board[pitIndex(seat, p)] > 0) out.push(p);
  return out;
}

function sideEmpty(board: readonly number[], seat: Seat) {
  return legalPits(board, seat).length === 0;
}

function isMove(m: unknown): m is GebetaMove {
  if (typeof m !== "object" || m === null) return false;
  const pit = (m as { pit?: unknown }).pit;
  return typeof pit === "number" && Number.isInteger(pit) && pit >= 0 && pit < PITS;
}

/** Sow from `pit` for `seat`. Pure; shared by apply and the bot. */
export function sow(board: readonly number[], seat: Seat, pit: number) {
  const b = board.slice();
  let i = pitIndex(seat, pit);
  let hand = b[i];
  b[i] = 0;
  const skip = storeOf(other(seat));
  while (hand > 0) {
    i = (i + 1) % b.length;
    if (i === skip) continue;
    b[i] += 1;
    hand -= 1;
  }

  const extraTurn = i === storeOf(seat);
  let captured = 0;
  if (!extraTurn && ownsPit(seat, i) && b[i] === 1 && b[opposite(i)] > 0) {
    captured = b[i] + b[opposite(i)];
    b[storeOf(seat)] += captured;
    b[i] = 0;
    b[opposite(i)] = 0;
  }
  return { board: b, extraTurn, captured };
}

function play(s: GebetaState, seat: Seat, pit: number): GebetaState {
  const r = sow(s.board, seat, pit);
  const board = r.board;
  let over = false;
  if (sideEmpty(board, 0) || sideEmpty(board, 1)) {
    for (const owner of [0, 1] as const) {
      for (let p = 0; p < PITS; p++) {
        const i = pitIndex(owner, p);
        board[storeOf(owner)] += board[i];
        board[i] = 0;
      }
    }
    over = true;
  }
  return {
    board,
    turn: r.extraTurn && !over ? seat : other(seat),
    moves: s.moves + 1,
    last: { seat, pit, extraTurn: r.extraTurn, captured: r.captured },
    over,
  };
}

function viewOf(s: GebetaState, viewer: Viewer): GebetaView {
  return {
    pits: [s.board.slice(0, PITS), s.board.slice(PITS + 1, 2 * PITS + 1)],
    stores: [s.board[storeOf(0)], s.board[storeOf(1)]],
    turn: s.turn,
    moves: s.moves,
    last: s.last ? { ...s.last } : null,
    over: s.over,
    you: viewer === "spectator" ? null : viewer,
  };
}

/** Rebuild the 14-slot board from a view (the bot only sees its view). */
function boardOf(v: GebetaView): number[] {
  return [...v.pits[0], v.stores[0], ...v.pits[1], v.stores[1]];
}

export const gebeta: GameDef<GebetaState, GebetaMove, GebetaView> = {
  id: "gebeta",
  name: "Gebeta",

  setup() {
    const board = new Array<number>(2 * PITS + 2).fill(SEEDS_PER_PIT);
    board[storeOf(0)] = 0;
    board[storeOf(1)] = 0;
    return { board, turn: 0, moves: 0, last: null, over: false };
  },

  validate(s, seat, m) {
    if (s.over) return "game is over";
    if (seat !== s.turn) return "not your turn";
    if (!isMove(m)) return `move must be {pit: 0..${PITS - 1}}`;
    if (s.board[pitIndex(seat, m.pit)] === 0) return "that pit is empty";
    return null;
  },

  apply: (s, seat, m) => play(s, seat, m.pit),

  onTimeout(s) {
    return play(s, s.turn, legalPits(s.board, s.turn)[0]);
  },

  deadlineMs: (s) => (s.over ? null : TURN_MS),

  activeSeats: (s) => (s.over ? [] : [s.turn]),

  outcome(s) {
    if (!s.over) return null;
    const [a, b] = [s.board[storeOf(0)], s.board[storeOf(1)]];
    if (a === b) return { winner: null, draw: true, reason: `draw ${a}-${b}` };
    return { winner: a > b ? 0 : 1, draw: false, reason: `most seeds ${Math.max(a, b)}-${Math.min(a, b)}` };
  },

  view: viewOf,

  bot(view, seat, rng: Rng) {
    const board = boardOf(view);
    const pits = legalPits(board, seat);
    // Occasionally play a random pit so the bot is beatable.
    if (rng.next() < 0.15) return { pit: rng.pick(pits) };
    let best: number[] = [];
    let bestScore = -Infinity;
    for (const pit of pits) {
      const r = sow(board, seat, pit);
      const gained = r.board[storeOf(seat)] - board[storeOf(seat)];
      const score = (r.extraTurn ? 1000 : 0) + (r.captured > 0 ? 100 : 0) + gained;
      if (score > bestScore) [best, bestScore] = [[pit], score];
      else if (score === bestScore) best.push(pit);
    }
    return { pit: rng.pick(best) };
  },
};
