// Where each of the 60 lines sits on the 6×6 dot grid. Lines 0-29 are
// horizontal (5 per row, 6 rows), 30-59 vertical (6 per row, 5 rows).
// Coordinates are in the board's 0-100 box; a cell is 20 wide.

import type { Edge } from "@/engine/games/dotsAndBoxes";

export type Dir = "left" | "right" | "up" | "down";

export const isHorizontal = (e: number) => e < 30;

/** Row and column of the line's start dot. */
export function edgeCell(e: number): { r: number; c: number } {
  const n = isHorizontal(e) ? e : e - 30;
  const per = isHorizontal(e) ? 5 : 6;
  return { r: Math.floor(n / per), c: n % per };
}

/** Midpoint of the line. */
export function edgeMid(e: number): { x: number; y: number } {
  const { r, c } = edgeCell(e);
  return isHorizontal(e) ? { x: c * 20 + 10, y: r * 20 } : { x: c * 20, y: r * 20 + 10 };
}

export const edgeLabel = (e: number) => {
  const { r, c } = edgeCell(e);
  return `${isHorizontal(e) ? "Horizontal" : "Vertical"} line, row ${r + 1}, column ${c + 1}`;
};

/** The nearest undrawn line from `from` in a direction, or null at the edge of the board. */
export function nextEdge(edges: readonly Edge[], from: number, dir: Dir): number | null {
  const a = edgeMid(from);
  let best: number | null = null;
  let bestScore = Infinity;
  edges.forEach((owner, i) => {
    if (owner !== null || i === from) return;
    const b = edgeMid(i);
    const along = dir === "left" ? a.x - b.x : dir === "right" ? b.x - a.x : dir === "up" ? a.y - b.y : b.y - a.y;
    const across = dir === "left" || dir === "right" ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
    if (along <= 0.5) return;
    // Left and right stay in the row; up and down take the nearest row first.
    const horizontal = dir === "left" || dir === "right";
    if (horizontal && across > 0.5) return;
    const score = horizontal ? along : along * 1000 + across;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}
