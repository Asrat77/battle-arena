import { createRng } from "../rng";
import type { GameDef, Rng, Seat } from "../types";

export const TURN_MS = 30_000;
export const LETTERS = ["B", "I", "N", "G", "O"] as const;
/** Cell indices of the 5 rows, 5 columns and 2 diagonals, row-major. */
export const LINES: readonly number[][] = [
  ...[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c)),
  ...[0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

export const rules = [
  "Each player gets a private 5×5 sheet with the numbers 1 to 25 in a random order.",
  "Take turns calling any number still open on your sheet. Both players cross it off their own sheet.",
  "Every full row, column or diagonal you complete strikes the next letter of B-I-N-G-O.",
  "Strike all five letters first to win. If one call completes BINGO for both players, the match is a draw.",
  "Each turn lasts 30 seconds. On timeout the first open number on your sheet is called, reading left to right, top to bottom.",
];

export interface BingoMove { number: number }
export interface BingoState {
  grids: [number[], number[]];
  /** Every called number in order; seat 0 makes the even calls. */
  called: number[];
  turn: Seat;
}
export interface BingoView {
  /** The viewer's own sheet; null for spectators. */
  grid: number[] | null;
  called: number[];
  /** Completed lines by seat. Counts only, so a sheet's layout stays private. */
  lines: [number, number];
  turn: Seat;
}

export const callerOf = (i: number): Seat => (i % 2 === 0 ? 0 : 1);
export const completedLines = (grid: readonly number[], called: readonly number[]) =>
  LINES.flatMap((line, i) => (line.every((cell) => called.includes(grid[cell])) ? [i] : []));
export const openNumbers = (grid: readonly number[], called: readonly number[]) => grid.filter((n) => !called.includes(n));

const lineCounts = (s: BingoState): [number, number] => [completedLines(s.grids[0], s.called).length, completedLines(s.grids[1], s.called).length];
const isOver = (s: BingoState) => lineCounts(s).some((n) => n >= LETTERS.length);

function shuffled(rng: Rng): number[] {
  const a = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const call = (s: BingoState, n: number): BingoState => ({ ...s, called: [...s.called, n], turn: s.turn === 0 ? 1 : 0 });

/** How much closer a number brings a sheet to its next lines. */
function progress(grid: readonly number[], called: readonly number[], n: number): number {
  const next = [...called, n];
  return LINES.reduce((sum, line) => {
    if (!line.some((cell) => grid[cell] === n)) return sum;
    const crossed = line.filter((cell) => next.includes(grid[cell])).length;
    return sum + (crossed === 5 ? 100 : crossed * crossed);
  }, 0);
}

export const bingo: GameDef<BingoState, BingoMove, BingoView> = {
  id: "bingo",
  name: "BINGO",
  setup: ({ seed }) => ({ grids: [shuffled(createRng(`${seed}:grid:0`)), shuffled(createRng(`${seed}:grid:1`))], called: [], turn: 0 }),
  validate(s, seat, m) {
    if (isOver(s)) return "match is over";
    if (seat !== s.turn) return "not your turn";
    if (!m || typeof m !== "object" || !Number.isInteger(m.number) || m.number < 1 || m.number > 25) return "move must be {number: 1..25}";
    return s.called.includes(m.number) ? "that number is already called" : null;
  },
  apply: (s, _seat, m) => call(s, m.number),
  onTimeout: (s) => (isOver(s) ? s : call(s, openNumbers(s.grids[s.turn], s.called)[0])),
  deadlineMs: (s) => (isOver(s) ? null : TURN_MS),
  activeSeats: (s) => (isOver(s) ? [] : [s.turn]),
  outcome(s) {
    const [a, b] = lineCounts(s);
    if (a < 5 && b < 5) return null;
    if (a >= 5 && b >= 5) return { winner: null, draw: true, reason: "BINGO on the same call" };
    return { winner: a >= 5 ? 0 : 1, draw: false, reason: "BINGO" };
  },
  view: (s, viewer) => ({
    grid: viewer === "spectator" ? null : s.grids[viewer].slice(),
    called: s.called.slice(),
    lines: lineCounts(s),
    turn: s.turn,
  }),
  bot(view, _seat, rng) {
    const grid = view.grid!;
    const moves = openNumbers(grid, view.called).map((n) => ({ n, score: progress(grid, view.called, n) }));
    const best = Math.max(...moves.map((m) => m.score));
    const optimal = moves.filter((m) => m.score === best), weaker = moves.filter((m) => m.score < best);
    return { number: rng.pick(rng.next() < 0.15 && weaker.length ? weaker : optimal).n };
  },
};
