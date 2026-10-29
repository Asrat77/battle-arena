import type { GameDef, Seat } from "../types";

export const TURN_MS = 30_000;
export const rules = ["Draw a line between neighboring dots on your turn.", "Complete a box to claim it and take another turn. One line can complete two boxes.", "The player with the most boxes after all 25 are claimed wins.", "Each turn lasts 30 seconds. On timeout the first available line is drawn for you."];
export type Edge = Seat | null;
export type DotsMove = { edge: number };
export interface DotsState { edges: Edge[]; boxes: Edge[]; turn: Seat; scores: [number, number]; moves: number; last: { seat: Seat; edge: number; captured: number[] } | null }
export type DotsView = DotsState;
export const boxEdges = (box: number) => { const r = Math.floor(box / 5), c = box % 5; return [r * 5 + c, (r + 1) * 5 + c, 30 + r * 6 + c, 31 + r * 6 + c]; };
export const available = (edges: readonly Edge[]) => edges.flatMap((e, i) => e === null ? [i] : []);
function play(s: DotsState, seat: Seat, edge: number): DotsState {
  const edges = s.edges.slice(); edges[edge] = seat;
  const boxes = s.boxes.slice();
  const captured: number[] = [];
  for (let i = 0; i < 25; i++) if (boxes[i] === null && boxEdges(i).every((e) => edges[e] !== null)) { boxes[i] = seat; captured.push(i); }
  const scores: [number, number] = [...s.scores]; scores[seat] += captured.length;
  return { edges, boxes, scores, turn: captured.length ? seat : seat === 0 ? 1 : 0, moves: s.moves + 1, last: { seat, edge, captured } };
}
function rank(s: DotsState, seat: Seat, edge: number): number {
  const next = play(s, seat, edge);
  if (next.last!.captured.length) return 1000 + next.last!.captured.length;
  const risky = next.boxes.some((b, i) => b === null && boxEdges(i).filter((e) => next.edges[e] !== null).length === 3);
  if (!risky) return 500;
  let simulated = next, gained = 0;
  while (true) {
    const capture = available(simulated.edges).find((e) => play(simulated, simulated.turn, e).last!.captured.length > 0);
    if (capture === undefined) break;
    simulated = play(simulated, simulated.turn, capture); gained += simulated.last!.captured.length;
  }
  return -gained;
}
export const dotsAndBoxes: GameDef<DotsState, DotsMove, DotsView> = {
  id: "dots-and-boxes", name: "Dots and Boxes",
  setup: () => ({ edges: Array<Edge>(60).fill(null), boxes: Array<Edge>(25).fill(null), turn: 0, scores: [0, 0], moves: 0, last: null }),
  validate(s, seat, m) {
    if (s.moves === 60) return "match is over";
    if (s.turn !== seat) return "not your turn";
    if (!m || typeof m !== "object" || !Number.isInteger(m.edge) || m.edge < 0 || m.edge >= 60) return "move must be {edge: 0..59}";
    return s.edges[m.edge] === null ? null : "that line is already drawn";
  },
  apply: (s, seat, m) => play(s, seat, m.edge),
  onTimeout: (s) => s.moves === 60 ? s : play(s, s.turn, available(s.edges)[0]),
  deadlineMs: (s) => s.moves === 60 ? null : TURN_MS,
  activeSeats: (s) => s.moves === 60 ? [] : [s.turn],
  outcome: (s) => s.moves < 60 ? null : { winner: s.scores[0] > s.scores[1] ? 0 : 1, draw: false, reason: "most boxes claimed" },
  view: (s) => ({ ...s, edges: s.edges.slice(), boxes: s.boxes.slice(), scores: [...s.scores], last: s.last ? { ...s.last, captured: s.last.captured.slice() } : null }),
  bot(view, seat, rng) {
    const moves = available(view.edges).map((edge) => ({ edge, score: rank(view, seat, edge) }));
    const best = Math.max(...moves.map((m) => m.score));
    const optimal = moves.filter((m) => m.score === best), weaker = moves.filter((m) => m.score < best);
    return { edge: rng.pick(rng.next() < 0.15 && weaker.length ? weaker : optimal).edge };
  },
};
