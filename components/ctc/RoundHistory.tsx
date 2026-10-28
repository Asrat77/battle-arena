// The round table: one row per round with each side's guess and its meter.
// The viewer's guesses are on the left in blue (seat 1 for spectators). The
// round in play is highlighted, and the round that cracked a code gets a
// saffron wash.

"use client";

import { useEffect, useRef } from "react";
import { CODE_LENGTH, type Guess, type Round } from "@/engine/games/crackTheCode";
import type { Seat, Viewer } from "@/engine/types";
import { Meter } from "./Meter";

const ROW = "grid grid-cols-[18px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2.5";

export function RoundHistory({
  history,
  seat,
  names,
  current,
  follow = true,
}: {
  history: Round[];
  seat: Viewer;
  names: [string, string];
  /** The round in play: its number, the viewer's unresolved guess, and who has guessed. */
  current?: { round: number; mine: string | null; submitted: [boolean, boolean] } | null;
  /** Scroll the newest row into view as rows arrive. Off in replays, where it would move the page. */
  follow?: boolean;
}) {
  const left: Seat = seat === "spectator" ? 0 : seat;
  const right: Seat = left === 0 ? 1 : 0;
  const spectating = seat === "spectator";
  const heads = spectating
    ? [`${names[left]} → ${names[right]}`, `${names[right]} → ${names[left]}`]
    : [`You → ${names[right]}`, `${names[right]} → you`];

  const end = useRef<HTMLDivElement>(null);
  const rows = history.length + (current ? 1 : 0);
  useEffect(() => {
    if (follow) end.current?.scrollIntoView?.({ block: "nearest" });
  }, [rows, follow]);

  if (!rows) return null;
  return (
    <div className="flex min-h-0 flex-col overflow-y-auto rounded-[20px] bg-sf px-3.5 py-1" data-testid="round-history">
      <div className={`${ROW} mono pb-1.5 pt-2 text-[10.5px] uppercase tracking-[.06em] text-ink-3`}>
        <span>#</span>
        <span className="truncate">{heads[0]}</span>
        <span className="truncate">{heads[1]}</span>
      </div>
      {history.map((r) => {
        const won = r.guesses.some((g) => g?.exact === CODE_LENGTH);
        return (
          <div
            key={r.round}
            className={`${ROW} border-t border-line py-[9px] text-[13px] ${
              won ? "-mx-3.5 rounded-xl border-transparent bg-gradient-to-r from-accent/20 to-transparent px-3.5" : ""
            }`}
            data-win={won || undefined}
          >
            <span className="mono text-ink-3">{r.round}</span>
            <Cell guess={r.guesses[left]} side="you" />
            <Cell guess={r.guesses[right]} side="opp" />
          </div>
        );
      })}
      {current && (
        <div className={`${ROW} -mx-3.5 rounded-xl bg-sf-2 px-3.5 py-[9px] text-[13px]`} aria-current="step">
          <span className="mono text-ink-3">{current.round}</span>
          {spectating ? (
            <Progress done={current.submitted[left]} />
          ) : current.mine ? (
            <span className="mono text-[15px] font-semibold tracking-[.12em] text-you">{current.mine}</span>
          ) : (
            <Progress done={false} />
          )}
          <Progress done={current.submitted[right]} />
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

function Cell({ guess, side }: { guess: Guess | null; side: "you" | "opp" }) {
  if (!guess) return <span className="text-xs text-ink-3">no guess</span>;
  return (
    <span className="flex min-w-0 items-center justify-between gap-2">
      <span className={`mono text-[15px] font-semibold tracking-[.12em] ${side === "you" ? "text-you" : "text-opp"}`}>{guess.code}</span>
      <Meter exact={guess.exact} present={guess.present} size="sm" />
    </span>
  );
}

function Progress({ done }: { done: boolean }) {
  return <span className="text-xs text-ink-3">{done ? "Guessed" : "Thinking…"}</span>;
}
