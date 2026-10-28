"use client";

// The card that covers the board once a match is over: a big object for win,
// loss or draw, the reason in plain words, then the final score (Gebeta) or
// both secrets (Crack the Code), the ledger record and the way out.

import { Avatar3D } from "@/components/ui/Avatar3D";
import { ButtonLink } from "@/components/ui/Button";
import { RecordChip } from "@/components/ui/Chip";
import { Icon3D } from "@/components/ui/Icon3D";
import type { Seat } from "@/engine/types";
import type { ResultSummary } from "./result";

export interface ResultSeat {
  id: string;
  name: string;
  bot?: boolean;
  /** "You" for the viewer, else the name. */
  label: string;
}

export function ResultCard({
  matchId,
  result,
  left,
  right,
  seats,
  ledgerIndex,
}: {
  matchId: string;
  result: ResultSummary;
  /** The seat drawn on the left (blue): the viewer, or seat 1 when spectating. */
  left: Seat;
  right: Seat;
  seats: [ResultSeat, ResultSeat];
  /** Ledger block of the result once recorded; null while pending. */
  ledgerIndex: number | null;
}) {
  const won = result.kind === "win";
  return (
    <section aria-labelledby="result-title" className="relative mx-auto flex w-full max-w-[520px] flex-col gap-2.5 pb-2" data-testid="match-end">
      <div className="dither h-[300px]" aria-hidden />
      <header className="relative flex flex-col items-center gap-2 px-5 pb-2 pt-6 text-center">
        <Icon3D name={result.icon} size={120} className="animate-pop drop-shadow-[0_16px_24px_rgba(0,0,0,.45)]" />
        <span className={`eyebrow ${won ? "!text-accent" : ""}`}>{result.eyebrow}</span>
        <h2 id="result-title" className="text-[34px] font-semibold leading-[1.02] tracking-[-.045em] md:text-h1">
          {result.headline}
        </h2>
        <span className="text-ink-2">{result.detail}</span>
      </header>

      {result.score && (
        <div className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 rounded-card bg-sf px-3.5 py-3">
          <span className="flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <Avatar3D id={seats[left].id} bot={seats[left].bot} size="sm" seat="you" />
            <b className="max-w-full truncate font-semibold">{seats[left].label}</b>
          </span>
          <span className="mono text-[34px] font-semibold tracking-[-.04em]" aria-label={`${result.score[left]} to ${result.score[right]}`}>
            <span className="text-you">{result.score[left]}</span> <span className="text-ink-3">–</span>{" "}
            <span className="text-opp">{result.score[right]}</span>
          </span>
          <span className="flex min-w-0 flex-col-reverse items-end gap-1.5 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
            <b className="max-w-full truncate font-semibold">{seats[right].label}</b>
            <Avatar3D id={seats[right].id} bot={seats[right].bot} size="sm" seat="opp" />
          </span>
        </div>
      )}

      {result.secrets && (
        <div className="relative grid grid-cols-2 gap-2.5">
          {([left, right] as const).map((s, i) => (
            <div
              key={s}
              className={`card flex flex-col gap-1 p-3.5 ${i === 0 ? "shadow-[inset_0_0_0_1.5px_rgb(var(--you))]" : "shadow-[inset_0_0_0_1.5px_rgb(var(--opp))]"}`}
            >
              <span className="text-small text-ink-2">{seats[s].label === "You" ? "Your secret" : `${seats[s].name}’s`}</span>
              <span className={`mono text-[26px] font-semibold tracking-[.1em] ${i === 0 ? "text-you" : "text-opp"}`}>
                {result.secrets![s] ?? "None"}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card relative flex items-center gap-3 px-3.5 py-3">
        <Icon3D name="blockchain" size={36} />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="text-small font-semibold">Ledger record</b>
          <span className="text-small text-ink-2">Gameplay never waits for this</span>
        </span>
        <RecordChip state={ledgerIndex === null ? "pending" : "recorded"} block={ledgerIndex} />
      </div>

      <ButtonLink href={`/replay/${matchId}`} variant="act" icon="verified" block className="relative">
        Replay &amp; verify
      </ButtonLink>
      <ButtonLink href="/" variant="ghost" block className="relative">
        Home
      </ButtonLink>
    </section>
  );
}
