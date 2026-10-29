import { Fragment } from "react";
import type { Seat, Viewer } from "@/engine/types";
import { boardResult, markFor, type TicTacToeView } from "@/engine/games/ticTacToe";

export function Mark({ value, className = "" }: { value: "X" | "O"; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" aria-hidden className={className}>
      {value === "X" ? <path d="M16 16 48 48M48 16 16 48" /> : <circle cx="32" cy="32" r="21" />}
    </svg>
  );
}

export function TicTacToeBoard({ view, seat, names, disabled = false, onMove, countdown }: {
  view: TicTacToeView;
  seat: Viewer;
  names: [string, string];
  disabled?: boolean;
  onMove?(cell: number): void;
  countdown?: number | null;
}) {
  const left: Seat = seat === "spectator" ? 0 : seat;
  const right: Seat = left === 0 ? 1 : 0;
  const result = boardResult(view.board);
  const interactive = seat !== "spectator" && !disabled && view.phase === "playing" && view.turn === seat && Boolean(onMove);
  const label = (s: Seat) => s === seat ? "You" : names[s];
  const tone = (s: Seat) => s === left ? "text-you" : "text-opp";
  const boardEnd = result.over ? result.winner === null ? "Board drawn" : `${label(result.winner)} ${result.winner === seat ? "win" : "wins"} this board` : null;

  return (
    <section className="mx-auto flex w-full max-w-[460px] flex-col gap-3" aria-label="Tic-Tac-Toe board">
      <div className="card flex items-center gap-2 !px-3.5 !py-3">
        {([left, right] as const).map((s, i) => (
          <Fragment key={s}>
            {i === 1 && <span aria-hidden className="mono text-ink-3">–</span>}
            <div className={`flex min-w-0 flex-1 items-center gap-2 ${i ? "flex-row-reverse text-right" : ""}`}>
              <Mark value={markFor(view.round, s)} className={`h-7 w-7 flex-none ${tone(s)}`} />
              <span className="min-w-0"><b className="block truncate text-small font-semibold">{label(s)}</b><span className="eyebrow">{markFor(view.round, s)}</span></span>
              <span className={`mono text-[28px] font-semibold ${i ? "mr-auto" : "ml-auto"} ${tone(s)}`}>{view.scores[s]}</span>
            </div>
          </Fragment>
        ))}
      </div>
      <div className="flex items-center justify-between px-1">
        <span className="eyebrow">Board {view.round} of 3</span>
        <span className="text-small text-ink-3">Best of three</span>
      </div>
      <div className="grid aspect-square grid-cols-3 grid-rows-3 gap-2 rounded-board bg-sf p-2.5 shadow-edge sm:gap-3 sm:p-3.5" role="group" aria-label={`Board ${view.round}, squares read left to right`}>
        {view.board.map((cell, i) => {
          const won = result.winningCells.includes(i);
          const last = view.lastCell === i;
          const description = `Row ${Math.floor(i / 3) + 1}, column ${i % 3 + 1}, ${cell === null ? "empty" : `${markFor(view.round, cell)}, ${names[cell]}`}${won ? ", winning square" : ""}${last ? ", latest move" : ""}`;
          const cellClass = `relative flex min-h-0 min-w-0 items-center justify-center rounded-[18px] transition-colors ${won ? "bg-pending-soft ring-2 ring-accent" : "bg-sf-2"} ${last && !won ? "shadow-[inset_0_0_0_1.5px_rgb(var(--ink3)/.5)]" : ""} ${cell === null && interactive ? "hover:bg-sf-3 active:scale-[.97]" : ""}`;
          const content = cell !== null ? <Mark value={markFor(view.round, cell)} className={`h-[65%] w-[65%] animate-pop ${tone(cell)}`} /> : null;
          return onMove && seat !== "spectator" ? (
            <button key={i} type="button" className={cellClass} aria-label={description} disabled={!interactive || cell !== null} onClick={() => onMove(i)}>{content}</button>
          ) : <div key={i} className={cellClass} role="img" aria-label={description}>{content}</div>;
        })}
      </div>
      <p className="min-h-6 text-center text-small font-semibold text-ink-2" aria-live="polite">
        {view.phase === "pause" ? `${boardEnd} · next board${countdown != null ? ` in ${countdown}s` : " shortly"}` : boardEnd ??
          (disabled ? "Board at this replay step" : interactive ? `Place your ${markFor(view.round, view.turn)}` : `${names[view.turn]} is playing ${markFor(view.round, view.turn)}`)}
      </p>
      {view.history.length > 0 && <div className="flex flex-wrap justify-center gap-1.5" aria-label="Completed boards">
        {view.history.map((r, i) => <span key={i} className="chip !text-[11px]">{i + 1} · {r.winner === null ? "Draw" : `${label(r.winner)} ${r.winner === seat ? "win" : "wins"}`}</span>)}
      </div>}
    </section>
  );
}
