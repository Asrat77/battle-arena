"use client";

// Small pieces shared by the matches table, the live card and the match drawer:
// the two players with the winner marked, the result pill, the stake cell and
// the stake pill.

import { Money } from "@/components/admin/Money";
import { PlayerCell } from "@/components/admin/PlayerCell";
import { StatusPill, type PillTone } from "@/components/admin/StatusPill";
import { Tooltip } from "@/components/admin/Tooltip";
import { birr, unitFor } from "@/lib/admin/format";
import { matchResult, playerName, stakeNote, type ResultKind } from "@/lib/admin/matches";
import type { MatchRow, PlayerRef, StakeInfo } from "@/lib/admin/types";

export const RESULT_TONE: Record<ResultKind, PillTone> = { won: "success", draw: "neutral", aborted: "rejected" };

/** A small "W" square for the winning seat. */
export function WinnerMark() {
  return (
    <span title="Winner" aria-label="Winner" className="inline-flex h-4 w-4 flex-none items-center justify-center rounded-[4px] bg-accent/15 font-mono text-[10px] font-semibold leading-none text-accent">
      W
    </span>
  );
}

export function Seat({ p, winner, size = "sm" }: { p: PlayerRef; winner: boolean; size?: "sm" | "md" }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <PlayerCell id={p.profileId} name={p.name} username={p.username} bot={p.bot} size={size} />
      {winner && <WinnerMark />}
    </span>
  );
}

/** Both players. Wide screens stack them with the winner marked; phones get one "A vs B" line of names. */
export function PlayersPair({ m }: { m: Pick<MatchRow, "players" | "outcome"> }) {
  const r = matchResult(m);
  const [a, b] = m.players;
  return (
    <>
      <div className="hidden min-w-0 flex-col gap-0.5 md:flex">
        {m.players.map((p, i) => (
          <Seat key={`${p.profileId}-${i}`} p={p} winner={r.winnerSeat === i} />
        ))}
      </div>
      <p className="min-w-0 truncate text-[14px] font-medium text-ink md:hidden">
        <span className={r.winnerSeat === 0 ? "text-accent" : ""}>{playerName(a)}</span>
        <span className="mx-1.5 font-normal text-ink-3">vs</span>
        <span className={r.winnerSeat === 1 ? "text-accent" : ""}>{playerName(b)}</span>
      </p>
    </>
  );
}

/** "Yodit won" / "Draw" / "Aborted" with the reason underneath on wide screens (and in the tooltip). */
export function ResultCell({ m, reason = true, full = false }: { m: Pick<MatchRow, "players" | "outcome">; reason?: boolean; full?: boolean }) {
  const r = matchResult(m);
  const short = r.kind === "won" ? "Won" : r.label;
  const pill = (
    <StatusPill tone={RESULT_TONE[r.kind]}>
      <span className={full ? "hidden" : "md:hidden"}>{short}</span>
      <span className={full ? "" : "max-md:hidden"}>{r.label}</span>
    </StatusPill>
  );
  return (
    <div className={`flex flex-col gap-0.5 ${full ? "items-start" : "items-end md:items-start"}`}>
      {r.reason ? <Tooltip content={r.reason}><span tabIndex={0} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent">{pill}</span></Tooltip> : pill}
      {reason && r.reason && <span className="max-w-[170px] truncate text-[11.5px] text-ink-3 max-md:hidden">{r.reason}</span>}
    </div>
  );
}

/** Stake per player, with the prize and fee as a second line (and tooltip) on wide screens; "Free" when unstaked. */
export function StakeCell({ stake }: { stake: StakeInfo | null }) {
  if (!stake) return <span className="text-ink-3">Free</span>;
  const detail =
    stake.status === "refunded"
      ? "refunded"
      : `prize ${birr(stake.prize)} · fee ${birr(stake.fee)}${stake.status === "held" ? " · held" : ""}`;
  return (
    <div className="leading-tight" title={`${birr(stake.amount)} ${unitFor(stake.book)} each, ${detail}, ${stake.book} book`}>
      <Money santim={stake.amount} book={stake.book} />
      <div className="num mt-0.5 whitespace-nowrap text-[11.5px] font-normal text-ink-3 max-md:hidden">{detail}</div>
      <span className="sr-only">{stakeNote(stake)}</span>
    </div>
  );
}

/** A compact stake pill for the live card. */
export function StakePill({ stake }: { stake: StakeInfo | null }) {
  if (!stake) return <span className="inline-flex h-6 items-center rounded-full border border-line px-2.5 text-[12px] font-medium text-ink-3">Free</span>;
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-accent/40 bg-accent/10 px-2.5 text-[12px] font-medium text-accent">
      <Money santim={stake.amount} book={stake.book} className="!text-accent" />
    </span>
  );
}
