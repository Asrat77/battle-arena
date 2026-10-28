"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { AdapterPlayer } from "@/components/match/adapter";
import { adapterFor } from "@/components/match/adapters";
import { MatchFrame, type FrameSeat, type StatusTone } from "@/components/match/MatchFrame";
import { RecordChip } from "@/components/ui/Chip";
import { getGame } from "@/engine/registry";
import type { Seat } from "@/engine/types";
import { useSession } from "@/lib/session";
import { useMatch, type MatchEnd, type MatchStart, type MatchViewMsg } from "@/lib/useMatch";
import { usePlayerNames } from "@/lib/usePlayerNames";

const GAME_ICONS = { "crack-the-code": "vault", gebeta: "mancala" } as const;

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { profile, ready } = useSession();
  const { start, view, end, commit, ledger, error, missing, move, leave } = useMatch<unknown>(id);
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
  });

  const seatNames: [string, string] = [name(0), name(1)];
  const players = ([0, 1] as const).map((s) => ({ id: start.players[s], name: name(s), bot: start.bot && start.botSeat === s })) as [
    AdapterPlayer,
    AdapterPlayer,
  ];
  const clock = adapter && !end ? adapter.timer(view.view) : null;
  const { status, tone } =
    adapter && !end
      ? { status: adapter.status(view.view, seat, seatNames), tone: actTone(view, seat) }
      : plainStatus(view, end, seat, name);

  return (
    <MatchFrame
      game={getGame(start.gameId)?.name ?? start.gameId}
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
      rules={adapter?.rules}
      onForfeit={leave}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {adapter ? (
          <adapter.Board view={view.view} seat={seat} onMove={move} disabled={Boolean(end)} names={seatNames} players={players} />
        ) : (
          <pre className="card mono overflow-x-auto whitespace-pre-wrap p-4 text-[13px]">{JSON.stringify(view.view, null, 2)}</pre>
        )}
        {error && (
          <p role="alert" className="text-sm font-semibold text-mismatch">
            {error}
          </p>
        )}

        {end && <PlainEnd id={id} end={end} labels={labels} ledgerIndex={ledger.state === "recorded" ? ledger.ledgerIndex : null} />}

        <Commitments start={start} commit={commit} labels={labels} over={Boolean(end)} />
      </div>
    </MatchFrame>
  );
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

/** Stand-in end card until the MatchEnd screen lands. */
function PlainEnd({
  id,
  end,
  labels,
  ledgerIndex,
}: {
  id: string;
  end: MatchEnd;
  labels: [string, string];
  ledgerIndex: number | null;
}) {
  const secrets = (end.reveal as { secrets?: [string | null, string | null] }).secrets;
  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="match-end">
      <RecordChip state={ledgerIndex === null ? "pending" : "recorded"} block={ledgerIndex} long />
      {secrets && (
        <p className="text-sm">
          Secrets revealed: {labels[0]} <span className="mono">{secrets[0] ?? "none"}</span>, {labels[1]}{" "}
          <span className="mono">{secrets[1] ?? "none"}</span>
        </p>
      )}
      <div className="flex gap-2">
        <Link href={`/replay/${id}`} className="btn btn-act btn-sm">
          Replay and verify
        </Link>
        <Link href="/" className="btn btn-sec btn-sm">
          Home
        </Link>
      </div>
    </section>
  );
}

function Commitments({
  start,
  commit,
  labels,
  over,
}: {
  start: MatchStart;
  commit: { commitments: Record<string, string>; ledgerIndex: number } | null;
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
