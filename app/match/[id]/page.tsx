"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { AdapterPlayer, MatchCommit } from "@/components/match/adapter";
import { adapterFor } from "@/components/match/adapters";
import { MatchFrame, type FrameSeat, type StatusTone } from "@/components/match/MatchFrame";
import { ResultCard, type ResultSeat } from "@/components/match/ResultCard";
import { resultSummary } from "@/components/match/result";
import { getGame } from "@/engine/registry";
import type { Seat } from "@/engine/types";
import { useSession } from "@/lib/session";
import { useMatch, type MatchEnd, type MatchStart, type MatchViewMsg } from "@/lib/useMatch";
import { usePlayerNames } from "@/lib/usePlayerNames";

const GAME_ICONS = { "crack-the-code": "vault", gebeta: "mancala" } as const;

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { profile, ready } = useSession();
  const { start, view, end, commit, ledger, error, missing, away, move, leave } = useMatch<unknown>(id);
  const names = usePlayerNames(start?.players);
  const fallbackTotal = useTurnLength(view?.deadline ?? null);

  if (ready && !profile)
    return (
      <p className="text-sm">
        Sign up on the <Link href="/" className="underline">home page</Link> first.
      </p>
    );
  if (missing)
    return (
      <p className="text-sm">
        This match is not live. <Link href={`/replay/${id}`} className="underline">Open its replay</Link>.
      </p>
    );
  if (!start || !view) return <p className="text-sm text-ink-3">Connecting to match…</p>;

  const adapter = adapterFor(start.gameId);
  const seat = start.seat;
  const spectating = seat === "spectator";
  // Blue is the viewer; spectators see seat 1 on the left.
  const left: Seat = spectating ? 0 : seat;
  const right: Seat = left === 0 ? 1 : 0;
  const name = (s: Seat) => names[start.players[s]] ?? "…";
  const label = (s: Seat) => `${name(s)}${s === seat ? " (you)" : ""}`;
  const labels: [string, string] = [label(0), label(1)];
  const frameSeat = (s: Seat): FrameSeat => ({
    id: start.players[s],
    name: name(s),
    bot: start.bot && start.botSeat === s,
    state: end ? endState(s, end) : (adapter?.seatState?.(view.view, s) ?? seatState(s, view)),
    offline: !end && away[s] !== null,
  });

  const seatNames: [string, string] = [name(0), name(1)];
  const players = ([0, 1] as const).map((s) => ({ id: start.players[s], name: name(s), bot: start.bot && start.botSeat === s })) as [
    AdapterPlayer,
    AdapterPlayer,
  ];
  const clock = adapter && !end ? adapter.timer(view.view) : null;
  const gameName = getGame(start.gameId)?.name ?? start.gameId;
  const { status, tone } =
    adapter && !end
      ? { status: adapter.status(view.view, seat, seatNames), tone: actTone(view, seat) }
      : plainStatus(view, end, seat, name);

  return (
    <MatchFrame
      game={gameName}
      icon={adapter?.icon ?? GAME_ICONS[start.gameId as keyof typeof GAME_ICONS] ?? "controller"}
      matchId={id}
      you={frameSeat(left)}
      opp={frameSeat(right)}
      deadline={clock?.deadline ?? view.deadline}
      total={clock?.total ?? fallbackTotal}
      status={status}
      tone={tone}
      spectating={spectating}
      over={Boolean(end)}
      away={end ? null : awayOf(away, seat, name)}
      rules={adapter?.rules}
      result={
        end && (
          <ResultCard
            matchId={id}
            result={resultSummary({
              gameId: start.gameId,
              gameName,
              outcome: end.outcome,
              reveal: end.reveal,
              view: view.view,
              seat,
              names: seatNames,
              bots: [Boolean(players[0].bot), Boolean(players[1].bot)],
            })}
            left={left}
            right={right}
            seats={players.map((p, s) => ({ ...p, label: s === seat ? "You" : p.name })) as [ResultSeat, ResultSeat]}
            ledgerIndex={ledger.state === "recorded" ? ledger.ledgerIndex : null}
            spectating={spectating}
          />
        )
      }
      onForfeit={leave}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {adapter ? (
          <adapter.Board
            view={view.view}
            seat={seat}
            onMove={move}
            disabled={Boolean(end)}
            names={seatNames}
            players={players}
            commit={commit}
            error={error}
          />
        ) : (
          <pre className="card mono overflow-x-auto whitespace-pre-wrap p-4 text-[13px]">{JSON.stringify(view.view, null, 2)}</pre>
        )}
        {error && !adapter?.showsErrors && (
          <p role="alert" className="text-sm font-semibold text-mismatch">
            {error.reason}
          </p>
        )}

        <Commitments start={start} commit={commit} labels={labels} over={Boolean(end)} />
      </div>
    </MatchFrame>
  );
}

/** The player whose forfeit is counting down, for the header. Players only hear about their opponent. */
function awayOf(away: [number | null, number | null], seat: Seat | "spectator", name: (s: Seat) => string) {
  for (const s of [0, 1] as const) if (away[s] !== null && s !== seat) return { name: name(s), until: away[s] as number };
  return null;
}

/** Length of the current turn, measured from when its deadline first arrived. */
function useTurnLength(deadline: number | null): number {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (deadline !== null) setTotal(Math.max(1, deadline - Date.now()));
  }, [deadline]);
  return total;
}

function endState(s: Seat, end: MatchEnd): string {
  return end.outcome.draw ? "Draw" : end.outcome.winner === s ? "Won" : "Lost";
}

function seatState(s: Seat, view: MatchViewMsg<unknown>): string {
  return view.activeSeats.includes(s) ? "Thinking" : "Waiting";
}

/** Saffron while the viewer still has to act, quiet otherwise. */
function actTone(view: MatchViewMsg<unknown>, seat: MatchStart["seat"]): StatusTone {
  return seat !== "spectator" && view.activeSeats.includes(seat) ? "mine" : "wait";
}

function plainStatus(
  view: MatchViewMsg<unknown>,
  end: MatchEnd | null,
  seat: MatchStart["seat"],
  name: (s: Seat) => string,
): { status: string; tone: StatusTone } {
  if (end) {
    const { draw, winner, reason } = end.outcome;
    if (draw) return { status: `Draw · ${reason}`, tone: "wait" };
    if (seat === "spectator") return { status: `${name(winner!)} wins · ${reason}`, tone: "wait" };
    return { status: `${winner === seat ? "You win" : `${name(winner!)} wins`} · ${reason}`, tone: winner === seat ? "mine" : "wait" };
  }
  if (seat === "spectator") return { status: "Watching live", tone: "wait" };
  if (view.activeSeats.includes(seat)) return { status: "Your move", tone: "mine" };
  const other: Seat = seat === 0 ? 1 : 0;
  return { status: `Waiting for ${name(other)}`, tone: "wait" };
}

function Commitments({
  start,
  commit,
  labels,
  over,
}: {
  start: MatchStart;
  commit: MatchCommit | null;
  labels: [string, string];
  over: boolean;
}) {
  const hashes = commit?.commitments ?? start.commitments;
  if (!Object.keys(hashes).length && start.gameId !== "crack-the-code") return null;
  return (
    <section className="card p-4 text-sm">
      <h2 className="eyebrow">Commitments</h2>
      {Object.keys(hashes).length ? (
        <ul className="mt-2 flex flex-col gap-1">
          {Object.entries(hashes).map(([s, hash]) => (
            <li key={s} className="min-w-0 break-all">
              {labels[Number(s) as Seat]}: <span className="mono text-ink-3">{hash}</span>
            </li>
          ))}
          {commit && <li className="text-xs text-ink-3">Published in block #{commit.ledgerIndex} before the first guess.</li>}
        </ul>
      ) : (
        <p className="mt-2 text-ink-3">
          {over ? "None. The match ended before both secrets were locked." : "Published once both secrets are locked."}
        </p>
      )}
    </section>
  );
}
