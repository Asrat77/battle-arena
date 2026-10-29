import type { GameDef, Seat } from "../types";

export const TURN_MS = 30_000;
export const PAUSE_MS = 3_000;
export const MAX_BOARDS = 3;
export const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

export const rules = [
  "Take turns placing X or O on an empty square. Three in a row, column or diagonal wins the board.",
  "Play up to three boards. Each board win earns a point; a drawn board counts but earns no points. Most points wins the match; equal scores draw.",
  "The opening player uses X. Players alternate who opens each board, with a three-second pause between boards.",
  "You have 30 seconds per turn. On timeout, the first empty square is played for you, reading left to right, top to bottom.",
];

export type Cell = Seat | null;
export interface TicTacToeMove { cell: number }
export interface CompletedBoard {
  board: Cell[];
  winner: Seat | null;
  winningCells: number[];
}
export interface TicTacToeState {
  board: Cell[];
  turn: Seat;
  round: number;
  scores: [number, number];
  phase: "playing" | "pause" | "finished";
  history: CompletedBoard[];
  lastCell: number | null;
}
export type TicTacToeView = TicTacToeState;

export const openingSeat = (round: number): Seat => (round % 2 === 1 ? 0 : 1);
export const markFor = (round: number, seat: Seat) => (seat === openingSeat(round) ? "X" : "O");
export const emptyCells = (board: readonly Cell[]) => board.flatMap((cell, i) => cell === null ? [i] : []);

export function boardResult(board: readonly Cell[]): { winner: Seat | null; winningCells: number[]; over: boolean } {
  const lines = WIN_LINES.filter(([a, b, c]) => board[a] !== null && board[a] === board[b] && board[b] === board[c]);
  return {
    winner: lines.length ? board[lines[0][0]] : null,
    winningCells: [...new Set(lines.flatMap((line) => [...line]))],
    over: lines.length > 0 || !board.includes(null),
  };
}

function play(s: TicTacToeState, seat: Seat, cell: number): TicTacToeState {
  const board = s.board.slice();
  board[cell] = seat;
  const result = boardResult(board);
  const next: TicTacToeState = { ...s, board, lastCell: cell, turn: seat === 0 ? 1 : 0 };
  if (!result.over) return next;
  const scores: [number, number] = [...s.scores];
  if (result.winner !== null) scores[result.winner]++;
  const remaining = MAX_BOARDS - s.round;
  const finished = remaining === 0 || Math.abs(scores[0] - scores[1]) > remaining;
  return {
    ...next, scores, phase: finished ? "finished" : "pause",
    history: [...s.history, { board: board.slice(), winner: result.winner, winningCells: result.winningCells }],
  };
}

// Small enough to search the complete board. Prefer fast wins and delay losses.
function minimax(board: Cell[], turn: Seat, me: Seat, depth: number, cache: Map<string, number>): number {
  const key = board.map((cell) => cell ?? "-").join("");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const result = boardResult(board);
  if (result.over) return result.winner === null ? 0 : result.winner === me ? 10 - depth : depth - 10;
  const values = emptyCells(board).map((cell) => {
    const next = board.slice();
    next[cell] = turn;
    return minimax(next, turn === 0 ? 1 : 0, me, depth + 1, cache);
  });
  const score = turn === me ? Math.max(...values) : Math.min(...values);
  cache.set(key, score);
  return score;
}

export function rankedMoves(board: readonly Cell[], seat: Seat): { cell: number; score: number }[] {
  const cache = new Map<string, number>();
  return emptyCells(board).map((cell) => {
    const next = board.slice();
    next[cell] = seat;
    return { cell, score: minimax(next, seat === 0 ? 1 : 0, seat, 1, cache) };
  });
}

export const ticTacToe: GameDef<TicTacToeState, TicTacToeMove, TicTacToeView> = {
  id: "tic-tac-toe",
  name: "Tic-Tac-Toe",
  setup: () => ({ board: Array<Cell>(9).fill(null), turn: 0, round: 1, scores: [0, 0], phase: "playing", history: [], lastCell: null }),
  validate(s, seat, move) {
    if (s.phase !== "playing") return s.phase === "pause" ? "next board starts shortly" : "match is over";
    if (seat !== s.turn) return "not your turn";
    if (typeof move !== "object" || move === null || !Number.isInteger(move.cell) || move.cell < 0 || move.cell > 8)
      return "move must be {cell: 0..8}";
    return s.board[move.cell] === null ? null : "that square is occupied";
  },
  apply: (s, seat, move) => play(s, seat, move.cell),
  onTimeout(s) {
    if (s.phase === "finished") return s;
    if (s.phase === "pause") return {
      ...s, board: Array<Cell>(9).fill(null), round: s.round + 1, turn: openingSeat(s.round + 1), phase: "playing", lastCell: null,
    };
    return play(s, s.turn, emptyCells(s.board)[0]);
  },
  deadlineMs: (s) => s.phase === "finished" ? null : s.phase === "pause" ? PAUSE_MS : TURN_MS,
  activeSeats: (s) => s.phase === "playing" ? [s.turn] : [],
  outcome(s) {
    if (s.phase !== "finished") return null;
    return s.scores[0] === s.scores[1]
      ? { winner: null, draw: true, reason: "series draw" }
      : { winner: s.scores[0] > s.scores[1] ? 0 : 1, draw: false, reason: "most boards won" };
  },
  view: (s) => ({ ...s, board: s.board.slice(), scores: [...s.scores], history: s.history.map((r) => ({ ...r, board: r.board.slice(), winningCells: r.winningCells.slice() })) }),
  bot(view, seat, rng) {
    const moves = rankedMoves(view.board, seat);
    const best = Math.max(...moves.map((move) => move.score));
    const optimal = moves.filter((move) => move.score === best);
    const weaker = moves.filter((move) => move.score < best);
    return { cell: rng.pick(rng.next() < 0.15 && weaker.length ? weaker : optimal).cell };
  },
};
