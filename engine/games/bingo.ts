// Paper BINGO for two seats.
//
// Each seat gets a private 5×5 grid filled randomly with 1–25. On your turn
// you call any uncrossed number from YOUR grid. That number is then crossed on
// BOTH grids (wherever it appears on each board). Complete a full row, column
// or diagonal of five crossed numbers to earn the next letter of B-I-N-G-O.
// First to complete 5 lines and slash "O" wins. Boards are private (hidden
// info); the view hides the opponent's grid layout.

import { createRng } from "../rng";
import type { GameDef, Rng, Seat, Viewer } from "../types";

export const GRID_SIZE = 5;
export const TOTAL_CELLS = GRID_SIZE * GRID_SIZE; // 25
export const TURN_MS = 45_000;
export const BINGO_LETTERS = ["B", "I", "N", "G", "O"] as const;

// Lines: 5 rows + 5 cols + 2 diagonals = 12 possible lines
// Each line is an array of 5 cell indices (0–24) in row-major order.
export const LINES: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  // rows
  for (let r = 0; r < GRID_SIZE; r++) {
    out.push([0, 1, 2, 3, 4].map((c) => r * GRID_SIZE + c));
  }
  // cols
  for (let c = 0; c < GRID_SIZE; c++) {
    out.push([0, 1, 2, 3, 4].map((r) => r * GRID_SIZE + c));
  }
  // diagonals
  out.push([0, 1, 2, 3, 4].map((i) => i * GRID_SIZE + i));
  out.push([0, 1, 2, 3, 4].map((i) => i * GRID_SIZE + (GRID_SIZE - 1 - i)));
  return out;
})();

export interface BingoMove {
  /** The number being called, 1–25. Must be uncrossed on the caller's grid. */
  number: number;
}

export interface BingoState {
  /** grids[seat] = array of 25 numbers in row-major order (1–25 each, unique). */
  grids: [number[], number[]];
  /** crossed[seat] = numbers already crossed on that seat's grid (stored as arrays for serialisation). */
  crossed: [number[], number[]];
  /** lettersEarned[seat] = how many BINGO letters that seat has (0–5). */
  lettersEarned: [number, number];
  /** completedLines[seat] = indices into LINES that are complete (stored as arrays). */
  completedLines: [number[], number[]];
  turn: Seat;
  moves: number;
  last: { seat: Seat; number: number; newLetters: [number, number] } | null;
  over: boolean;
}

export interface BingoView {
  /** The viewer's own grid layout (null for spectator). */
  myGrid: number[] | null;
  /** Numbers crossed on the viewer's own board. */
  myCrossed: number[];
  /** Line indices completed by the viewer. */
  myLines: number[];
  /** Opponent's crossed numbers (public — the call was heard by both). */
  oppCrossed: number[];
  /** Line indices completed by the opponent. */
  oppLines: number[];
  /** Letters earned by each seat, indexed by seat. */
  lettersEarned: [number, number];
  turn: Seat;
  moves: number;
  last: BingoState["last"];
  over: boolean;
  /** Which seat the viewer is, or null for spectator. */
  you: Seat | null;
}

/** Shuffle a copy of `arr` using Fisher-Yates with the given rng. */
function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Return the set of completed line indices for a seat. */
function completedLineIndices(crossed: Set<number>, grid: number[]): number[] {
  const out: number[] = [];
  for (let li = 0; li < LINES.length; li++) {
    if (LINES[li].every((idx) => crossed.has(grid[idx]))) out.push(li);
  }
  return out;
}

function isMove(m: unknown): m is BingoMove {
  if (typeof m !== "object" || m === null) return false;
  const n = (m as { number?: unknown }).number;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= TOTAL_CELLS;
}

/** All uncrossed numbers on a seat's grid. */
export function uncrossedNumbers(grid: number[], crossed: number[]): number[] {
  const s = new Set(crossed);
  return grid.filter((n) => !s.has(n));
}

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

function applyMove(s: BingoState, seat: Seat, num: number): BingoState {
  // Cross the called number on BOTH grids.
  const crossed: [number[], number[]] = [
    [...s.crossed[0]],
    [...s.crossed[1]],
  ];
  for (const side of [0, 1] as const) {
    if (s.grids[side].includes(num) && !crossed[side].includes(num)) {
      crossed[side] = [...crossed[side], num];
    }
  }

  // Recount completed lines for both seats.
  const completedLines: [number[], number[]] = [
    completedLineIndices(new Set(crossed[0]), s.grids[0]),
    completedLineIndices(new Set(crossed[1]), s.grids[1]),
  ];
  const lettersEarned: [number, number] = [
    Math.min(completedLines[0].length, BINGO_LETTERS.length),
    Math.min(completedLines[1].length, BINGO_LETTERS.length),
  ];

  const over =
    lettersEarned[0] >= BINGO_LETTERS.length || lettersEarned[1] >= BINGO_LETTERS.length;

  return {
    ...s,
    crossed,
    completedLines,
    lettersEarned,
    turn: over ? seat : other(seat),
    moves: s.moves + 1,
    last: { seat, number: num, newLetters: [...lettersEarned] as [number, number] },
    over,
  };
}

export const bingo: GameDef<BingoState, BingoMove, BingoView> = {
  id: "bingo",
  name: "BINGO",

  setup({ seed }) {
    const nums = Array.from({ length: TOTAL_CELLS }, (_, i) => i + 1);
    const rng0 = createRng(`${seed}:grid:0`);
    const rng1 = createRng(`${seed}:grid:1`);
    return {
      grids: [shuffle(nums, rng0), shuffle(nums, rng1)],
      crossed: [[], []],
      lettersEarned: [0, 0],
      completedLines: [[], []],
      turn: 0,
      moves: 0,
      last: null,
      over: false,
    };
  },

  validate(s, seat, m) {
    if (s.over) return "game is over";
    if (seat !== s.turn) return "not your turn";
    if (!isMove(m)) return "move must be { number: 1–25 }";
    if (s.crossed[seat].includes(m.number)) return "that number is already crossed";
    if (!s.grids[seat].includes(m.number)) return "that number is not on your grid";
    return null;
  },

  apply: (s, seat, m) => applyMove(s, seat, m.number),

  onTimeout(s) {
    const available = uncrossedNumbers(s.grids[s.turn], s.crossed[s.turn]);
    if (available.length === 0) return { ...s, over: true };
    return applyMove(s, s.turn, available[0]);
  },

  deadlineMs: (s) => (s.over ? null : TURN_MS),

  activeSeats: (s) => (s.over ? [] : [s.turn]),

  outcome(s) {
    if (!s.over) return null;
    const [a, b] = s.lettersEarned;
    if (a >= BINGO_LETTERS.length && b >= BINGO_LETTERS.length) {
      return { winner: null, draw: true, reason: "BINGO at the same time" };
    }
    const winner: Seat = a >= BINGO_LETTERS.length ? 0 : 1;
    return { winner, draw: false, reason: "BINGO!" };
  },

  view(s, viewer: Viewer): BingoView {
    const you: Seat | null = viewer === "spectator" ? null : viewer;
    const oppSeat: Seat = you === null ? 1 : other(you);
    const mySeat: Seat = you ?? 0;

    return {
      myGrid: you !== null ? s.grids[you].slice() : null,
      myCrossed: [...s.crossed[mySeat]],
      myLines: [...s.completedLines[mySeat]],
      oppCrossed: [...s.crossed[oppSeat]],
      oppLines: [...s.completedLines[oppSeat]],
      lettersEarned: [...s.lettersEarned],
      turn: s.turn,
      moves: s.moves,
      last: s.last ? { ...s.last } : null,
      over: s.over,
      you,
    };
  },

  bot(view: BingoView, _seat: Seat, rng: Rng): BingoMove {
    const myCrossed = new Set(view.myCrossed);
    const grid = view.myGrid ?? [];
    const available = grid.filter((n) => !myCrossed.has(n));
    if (available.length === 0) return { number: 1 };

    // Greedy: prefer the number that maximises progress toward completing lines.
    let bestNums: number[] = [];
    let bestScore = -1;

    for (const num of available) {
      const nextCrossed = new Set(myCrossed);
      nextCrossed.add(num);
      let score = 0;
      for (const line of LINES) {
        const count = line.filter((idx) => nextCrossed.has(grid[idx])).length;
        if (count === 5) score += 100;
        else score += count;
      }
      if (score > bestScore) {
        bestScore = score;
        bestNums = [num];
      } else if (score === bestScore) {
        bestNums.push(num);
      }
    }

    // 20% random factor so the bot stays beatable.
    if (rng.next() < 0.2) return { number: rng.pick(available) };
    return { number: rng.pick(bestNums) };
  },
};

export const rulesText = [
  "Each player gets a private 5×5 grid filled with the numbers 1 to 25.",
  "On your turn, call any uncrossed number from your grid — both players then cross that number wherever it appears on their own board.",
  "Complete a full row, column, or diagonal of 5 crossed numbers to earn a letter: B, then I, N, G, O.",
  "The first player to complete 5 lines and slash out the letter O shouts BINGO and wins!",
  "If both players reach BINGO on the same call, the match is a draw.",
  "Each turn has 45 seconds; on timeout your first uncrossed number is called automatically.",
].join(" ");
