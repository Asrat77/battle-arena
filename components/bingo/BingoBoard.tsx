"use client";

// BingoBoard: renders the authentic paper BINGO table.
// Structured as a continuous ruled table with B-I-N-G-O column headers directly
// above the 5 columns, 1px table gridlines, pen-stroke crosses on numbers,
// and SVG strike lines across completed rows, columns, and diagonals.

import { BINGO_LETTERS, GRID_SIZE, LINES } from "@/engine/games/bingo";
import { BingoCell } from "./BingoCell";

interface BingoBoardProps {
  /** 25 numbers in row-major order. Null when the grid is hidden (spectator/opponent view). */
  grid: number[] | null;
  crossed: number[];
  completedLines: number[];
  lettersEarned: number;
  /** Numbers the player may legally call right now. Empty when not your turn. */
  callable: number[];
  onCall?: (n: number) => void;
  /** The number most recently called (to highlight). */
  freshNumber?: number | null;
  tone?: "you" | "opp" | "neutral";
  label?: string;
  className?: string;
}

/** Return the set of number-values that sit in at least one completed line. */
function lineCellNumbers(completedLines: number[], grid: number[]): Set<number> {
  const s = new Set<number>();
  for (const li of completedLines) {
    if (LINES[li]) {
      for (const idx of LINES[li]) s.add(grid[idx]);
    }
  }
  return s;
}

export function BingoBoard({
  grid,
  crossed,
  completedLines,
  lettersEarned,
  callable,
  onCall,
  freshNumber,
  tone = "you",
  label,
  className = "",
}: BingoBoardProps) {
  const crossedSet = new Set(crossed);
  const lineNumbers = grid ? lineCellNumbers(completedLines, grid) : new Set<number>();

  return (
    <div
      className={`w-full max-w-[390px] mx-auto rounded-2xl overflow-hidden border-2 border-line bg-sf shadow-float select-none ${className}`}
      role="table"
      aria-label={label ?? "BINGO Paper Table"}
    >
      {/* Table Header Row: B - I - N - G - O atop the 5 columns */}
      <div
        className="grid grid-cols-5 bg-line gap-[1px] border-b-2 border-line"
        role="row"
      >
        {BINGO_LETTERS.map((letter, i) => {
          const earned = i < lettersEarned;
          return (
            <div
              key={letter}
              role="columnheader"
              className={[
                "relative aspect-[1.3] sm:aspect-[1.4] flex items-center justify-center bg-sf-3",
                "font-mono font-black text-lg sm:text-xl tracking-tight transition-colors duration-200",
                earned ? "text-accent" : "text-ink-3/60",
              ].join(" ")}
              aria-label={`Letter ${letter}${earned ? ", crossed off" : ""}`}
            >
              <span className={earned ? "scale-105 transition-transform" : undefined}>
                {letter}
              </span>

              {/* Authentic pen slash through earned letter */}
              {earned && (
                <svg
                  className="pointer-events-none absolute inset-0 w-full h-full p-2 animate-pop"
                  viewBox="0 0 40 40"
                  fill="none"
                  aria-hidden
                >
                  <line
                    x1="8"
                    y1="32"
                    x2="32"
                    y2="8"
                    stroke="rgb(var(--acc))"
                    strokeWidth="3.6"
                    strokeLinecap="round"
                    className="drop-shadow-[0_0_6px_rgba(243,181,66,0.8)]"
                  />
                </svg>
              )}
            </div>
          );
        })}
      </div>

      {/* 5×5 Table Body: Contiguous cells divided by 1px crisp gridlines */}
      <div className="relative grid grid-cols-5 bg-line gap-[1px]" role="rowgroup">
        {grid ? (
          grid.map((num, idx) => {
            const isCrossed = crossedSet.has(num);
            const isInLine = lineNumbers.has(num);
            const isClickable = callable.includes(num);
            const isFresh = freshNumber === num;

            return (
              <div
                key={idx}
                role="cell"
                aria-rowindex={Math.floor(idx / GRID_SIZE) + 1}
                aria-colindex={(idx % GRID_SIZE) + 1}
              >
                <BingoCell
                  number={num}
                  crossed={isCrossed}
                  inLine={isInLine}
                  clickable={isClickable}
                  onClick={() => onCall?.(num)}
                  fresh={isFresh}
                />
              </div>
            );
          })
        ) : (
          /* Spectator / Opponent view when numbers are secret */
          Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, idx) => {
            const isCrossed = idx < crossed.length;
            return (
              <div
                key={idx}
                className={[
                  "relative aspect-square flex items-center justify-center bg-sf-2/70",
                  isCrossed ? "text-accent" : "text-ink-3/40",
                ].join(" ")}
                aria-hidden
              >
                {isCrossed ? (
                  <svg className="w-1/2 h-1/2 p-1" viewBox="0 0 24 24" fill="none">
                    <line
                      x1="4"
                      y1="4"
                      x2="20"
                      y2="20"
                      stroke={tone === "opp" ? "rgb(var(--opp))" : "rgb(var(--you))"}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <line
                      x1="20"
                      y1="4"
                      x2="4"
                      y2="20"
                      stroke={tone === "opp" ? "rgb(var(--opp))" : "rgb(var(--you))"}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <span className="font-mono text-[11px] opacity-40">·</span>
                )}
              </div>
            );
          })
        )}

        {/* SVG Strike Lines: Drawn across completed rows, columns, and diagonals */}
        <svg
          className="pointer-events-none absolute inset-0 w-full h-full z-10"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {completedLines.map((li) => {
            if (li < 5) {
              // Row line (0..4)
              const y = (li + 0.5) * 20;
              return (
                <line
                  key={`row-${li}`}
                  x1="2"
                  y1={y}
                  x2="98"
                  y2={y}
                  stroke="rgb(var(--acc))"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  className="drop-shadow-[0_0_8px_rgba(243,181,66,0.85)] animate-pop"
                />
              );
            }
            if (li < 10) {
              // Column line (0..4)
              const c = li - 5;
              const x = (c + 0.5) * 20;
              return (
                <line
                  key={`col-${c}`}
                  x1={x}
                  y1="2"
                  x2={x}
                  y2="98"
                  stroke="rgb(var(--acc))"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  className="drop-shadow-[0_0_8px_rgba(243,181,66,0.85)] animate-pop"
                />
              );
            }
            if (li === 10) {
              // Main diagonal (top-left to bottom-right)
              return (
                <line
                  key="diag-0"
                  x1="2"
                  y1="2"
                  x2="98"
                  y2="98"
                  stroke="rgb(var(--acc))"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  className="drop-shadow-[0_0_8px_rgba(243,181,66,0.85)] animate-pop"
                />
              );
            }
            if (li === 11) {
              // Anti-diagonal (top-right to bottom-left)
              return (
                <line
                  key="diag-1"
                  x1="98"
                  y1="2"
                  x2="2"
                  y2="98"
                  stroke="rgb(var(--acc))"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  className="drop-shadow-[0_0_8px_rgba(243,181,66,0.85)] animate-pop"
                />
              );
            }
            return null;
          })}
        </svg>
      </div>
    </div>
  );
}
