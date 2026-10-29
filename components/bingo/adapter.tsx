"use client";

// BINGO inside MatchFrame: shows the player's private 5×5 paper table,
// the B-I-N-G-O column headers and letter progress, and the opponent's
// live progress (letters + crossed count, keeping grid layout hidden).

import { useMemo, useState } from "react";
import type { GameAdapter, ReplayStepProps } from "@/components/match/adapter";
import {
  BINGO_LETTERS,
  TURN_MS,
  type BingoMove,
  type BingoState,
  type BingoView,
} from "@/engine/games/bingo";
import { getGame } from "@/engine/registry";
import { initial, step } from "@/engine/replay";
import type { GameDef, Seat, Viewer } from "@/engine/types";
import { BingoBoard } from "./BingoBoard";
import { BingoHeader } from "./BingoHeader";

const rulesLines = [
  "Each player gets a private 5×5 paper grid filled with numbers 1 to 25.",
  "On your turn, call any uncrossed number from your table — both players cross it off on their own sheets.",
  "Complete a full row, column, or diagonal of 5 to strike through the next B-I-N-G-O letter.",
  "First player to earn all 5 letters (B-I-N-G-O) wins. Simultaneous 5th letters result in a draw.",
  "Each turn has 45 seconds; timeout auto-calls your first uncrossed number.",
];

type BoardProps = {
  view: BingoView;
  seat: Viewer;
  onMove: (m: BingoMove) => void;
  disabled: boolean;
  names: [string, string];
};

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

function LiveBoard({ view, seat, onMove, disabled, names }: BoardProps) {
  const spectating = seat === "spectator";
  const you: Seat = spectating ? 0 : (seat as Seat);
  const opp: Seat = other(you);

  const isMyTurn = !spectating && !disabled && view.turn === you && !view.over;
  const myCrossedSet = new Set(view.myCrossed);
  const callable = isMyTurn
    ? (view.myGrid ?? []).filter((n) => !myCrossedSet.has(n))
    : [];

  const freshNumber = view.last?.number ?? null;
  const callerName = view.last ? names[view.last.seat] : null;

  return (
    <div className="flex flex-col gap-3 max-w-[420px] mx-auto w-full">
      {/* Opponent Progress Card: Compact, informative header */}
      <div className="card flex items-center justify-between px-3.5 py-2.5 bg-sf border border-line">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-opp flex-none" />
          <span className="text-[13px] font-semibold text-ink truncate">
            {spectating ? names[1] : names[opp]}
          </span>
          <span className="mono text-[11px] text-ink-3 flex-none">
            ({view.oppCrossed.length}/25 crossed)
          </span>
        </div>

        <div className="flex items-center gap-2 flex-none">
          <span className="eyebrow text-[10px]">Letters:</span>
          <BingoHeader
            lettersEarned={view.lettersEarned[opp]}
            tone="opp"
            size="sm"
            label={`${spectating ? names[1] : names[opp]} has ${view.lettersEarned[opp]} of 5 letters`}
          />
        </div>
      </div>

      {/* Sheet Title Bar with Last Call Chip & Letters Progress */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="eyebrow">
            {spectating ? `${names[0]}'s Sheet` : "Your Sheet"}
          </span>
          {freshNumber && (
            <span className="chip text-[11px] py-0.5 px-2 bg-sf-2 text-ink-2">
              {callerName ? `${callerName} called ` : "Called: "}
              <span className="mono font-bold text-accent ml-1">#{freshNumber}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          <span className="mono text-[11.5px] font-bold text-accent">
            {view.lettersEarned[you]}/5 BINGO
          </span>
        </div>
      </div>

      {/* The Paper BINGO Table */}
      <BingoBoard
        grid={view.myGrid}
        crossed={view.myCrossed}
        completedLines={view.myLines}
        lettersEarned={view.lettersEarned[you]}
        callable={callable}
        onCall={(n) => onMove({ number: n })}
        freshNumber={freshNumber}
        tone="you"
        label={spectating ? `${names[0]}'s BINGO sheet` : "Your BINGO sheet"}
      />

      {/* Turn Interaction Prompt */}
      {isMyTurn && (
        <div className="flex items-center justify-center gap-2 py-2 px-3.5 rounded-xl bg-accent/15 border border-accent/30 text-accent text-[13px] font-semibold text-center animate-pulse">
          <span>🎯 Tap any uncrossed number on your table to call it</span>
        </div>
      )}
      {!spectating && !isMyTurn && !view.over && (
        <div className="flex items-center justify-center gap-2 py-2 px-3.5 rounded-xl bg-sf-2/70 text-ink-3 text-[12.5px] text-center">
          <span>⏳ Waiting for {names[view.turn]} to call a number…</span>
        </div>
      )}
      {spectating && !view.over && (
        <div className="flex items-center justify-center gap-2 py-2 px-3.5 rounded-xl bg-sf-2/70 text-ink-3 text-[12.5px] text-center">
          <span>Turn: {names[view.turn]}</span>
        </div>
      )}
    </div>
  );
}

/** Replay view — shows the match history step-by-step with inspectable player sheets. */
function ReplayStep({ log, step: at, seed, names }: ReplayStepProps) {
  const [activeSeat, setActiveSeat] = useState<Seat>(0);

  const cur = useMemo(() => {
    const game = getGame("bingo") as GameDef<BingoState, unknown, BingoView>;
    let m = initial(game, seed);
    let error: string | null = null;
    try {
      for (let i = 0; i < at; i++) m = step(game, seed, m, log[i], i);
    } catch (err) {
      error = (err as Error).message;
    }
    const s = m.state as BingoState;
    return { state: s, error };
  }, [log, at, seed]);

  const s = cur.state;
  const called = s.last?.number;
  const callerName = s.last ? names[s.last.seat] : null;

  return (
    <div className="flex flex-col gap-3 max-w-[420px] mx-auto w-full" data-testid="replay-step">
      <p className="eyebrow truncate text-center" aria-live="polite">
        {at === 0
          ? "Match starts · both sheets ready"
          : callerName && called
            ? `${callerName} called #${called}`
            : ""}
      </p>

      {/* Side-by-side seat scorecards */}
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map((seat) => (
          <button
            key={seat}
            type="button"
            onClick={() => setActiveSeat(seat)}
            className={[
              "card flex flex-col items-center gap-1.5 py-2.5 text-left transition-colors cursor-pointer",
              activeSeat === seat
                ? "ring-2 ring-accent border-accent/50 bg-sf-2"
                : "hover:bg-sf-2/70",
            ].join(" ")}
          >
            <div className="flex items-center gap-1.5 truncate max-w-full">
              <div
                className={`w-2 h-2 rounded-full flex-none ${
                  seat === 0 ? "bg-you" : "bg-opp"
                }`}
              />
              <span className="text-[12.5px] font-semibold truncate text-ink">
                {names[seat]}
              </span>
            </div>
            <BingoHeader
              lettersEarned={s.lettersEarned[seat]}
              tone={seat === 0 ? "you" : "opp"}
              size="sm"
            />
            <span className="text-[11px] text-ink-3">
              {s.crossed[seat].length}/25 crossed
            </span>
          </button>
        ))}
      </div>

      {/* The selected player's paper sheet at this replay step */}
      {s.grids && (
        <div className="flex flex-col gap-1.5 mt-1">
          <div className="flex items-center justify-between px-1">
            <span className="eyebrow">{names[activeSeat]}&apos;s Paper Sheet</span>
            <span className="mono text-[11px] text-accent font-semibold">
              {s.lettersEarned[activeSeat]}/5 Letters
            </span>
          </div>
          <BingoBoard
            grid={s.grids[activeSeat]}
            crossed={s.crossed[activeSeat]}
            completedLines={s.completedLines[activeSeat]}
            lettersEarned={s.lettersEarned[activeSeat]}
            callable={[]}
            freshNumber={called ?? null}
            tone={activeSeat === 0 ? "you" : "opp"}
            label={`${names[activeSeat]}'s Sheet Replay`}
          />
        </div>
      )}

      {cur.error && (
        <p className="text-small text-mismatch text-center" role="alert">
          The log stops replaying here: {cur.error}
        </p>
      )}
    </div>
  );
}

function bingoStatus(
  view: BingoView,
  seat: Viewer,
  names: [string, string]
): string {
  if (view.over) {
    const [a, b] = view.lettersEarned;
    if (a >= BINGO_LETTERS.length && b >= BINGO_LETTERS.length)
      return "BINGO — it's a draw!";
    const winner: Seat = a >= BINGO_LETTERS.length ? 0 : 1;
    if (seat === "spectator") return `${names[winner]} wins — BINGO!`;
    return seat === winner ? "BINGO — you win!" : "BINGO — opponent wins";
  }
  if (seat === "spectator") return `${names[view.turn]}'s turn`;
  if (view.turn === (seat as Seat)) return "Your turn — pick a number";
  return `${names[view.turn]}'s turn`;
}

export const BingoAdapter: GameAdapter<BingoView, BingoMove> = {
  id: "bingo",
  icon: "target",
  Board: LiveBoard,
  status: bingoStatus,
  timer: (view) => ({ total: TURN_MS, owner: view.turn }),
  ReplayStep,
  describeMove: (m) => `calls ${m.number}`,
  rules: {
    title: "BINGO",
    art: "target",
    lines: rulesLines,
  },
  hasHiddenInfo: true,
};
