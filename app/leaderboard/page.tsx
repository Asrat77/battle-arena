"use client";

// Rankings from rated matches (players only, under the farming cap), overall
// or per game. Top three stand on the podium, everyone else in a tight table.
// Your row is always visible: tinted in place, or pinned above the dock while
// it is scrolled off screen.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fmt, Podium } from "@/components/leaderboard/Podium";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Icon3D } from "@/components/ui/Icon3D";
import { Segmented } from "@/components/ui/Segmented";
import { api, type LeaderboardRow } from "@/lib/api";
import { useSession } from "@/lib/session";

import { GAME_OPTIONS, type GameId } from "@/lib/gameCatalog";

type Board = "overall" | GameId;

const BOARDS = [{ value: "overall" as const, label: "Overall" }, ...GAME_OPTIONS];

const PODIUM = 3;

export default function LeaderboardPage() {
  const { profile } = useSession();
  const [board, setBoard] = useState<Board>("overall");
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback((b: Board) => {
    setRows(null);
    setFailed(false);
    api.leaderboard(b === "overall" ? undefined : b).then(
      (r) => setRows(r.rows),
      () => setFailed(true),
    );
  }, []);

  useEffect(() => load(board), [board, load]);

  const mine = rows?.find((r) => r.profileId === profile?.id);
  const table = rows?.slice(PODIUM) ?? [];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <h1 className="sr-only">Leaderboard</h1>
      <Segmented<Board> label="Leaderboard" value={board} onChange={setBoard} options={BOARDS} />

      {failed ? (
        <div role="alert" className="flex items-start gap-3 rounded-[20px] bg-mismatch-soft p-3.5">
          <Icon3D name="warning" size={36} />
          <div className="flex flex-col gap-1.5">
            <b className="font-semibold text-mismatch">Couldn’t load rankings</b>
            <span className="text-small">Your rank is safe; we just couldn’t fetch it.</span>
            <Button size="sm" icon="refresh" className="self-start" onClick={() => load(board)}>
              Try again
            </Button>
          </div>
        </div>
      ) : !rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty board={board} />
      ) : (
        <>
          <Podium rows={rows} you={profile?.id} />
          {table.length > 0 && (
            <div className="-mb-1.5 grid grid-cols-[24px_34px_minmax(0,1fr)_52px_40px] gap-2.5 px-3.5" aria-hidden>
              <span className="eyebrow col-start-4 text-right">Rating</span>
              <span className="eyebrow text-right">Pts</span>
            </div>
          )}
          {table.length > 0 && (
            <ol className="card !px-3.5 !py-0.5" aria-label="Ranks 4 and below">
              {table.map((r) => (
                <RankRow key={r.profileId} row={r} you={r.profileId === profile?.id} />
              ))}
            </ol>
          )}
          <p className="text-center text-small text-ink-2">Ranked only from recorded matches. Bot matches never change rank.</p>
          {profile && <Pinned row={mine} board={board} />}
        </>
      )}
    </div>
  );
}

function record(r: LeaderboardRow) {
  return r.draws ? `${r.wins}–${r.losses}–${r.draws}` : `${r.wins}–${r.losses}`;
}

function RankRow({ row, you, pinned }: { row: LeaderboardRow; you?: boolean; pinned?: boolean }) {
  return (
    <li
      id={you && !pinned ? "my-rank" : undefined}
      aria-current={you && !pinned ? "true" : undefined}
      className={`grid grid-cols-[24px_34px_minmax(0,1fr)_52px_40px] items-center gap-2.5 py-2.5 text-[13.5px] ${
        pinned ? "" : "border-t border-line first:border-t-0"
      } ${you && !pinned ? "-mx-3.5 rounded-[14px] !border-t-transparent bg-you-soft px-3.5 [&+li]:border-t-transparent" : ""}`}
    >
      <span className={`font-mono font-semibold tabular-nums ${you ? "text-you" : "text-ink-3"}`}>{row.rank}</span>
      <Avatar3D id={row.profileId} size="sm" />
      <span className="flex min-w-0 flex-col">
        <Link href={`/profile/${row.profileId}`} className="truncate font-semibold hover:underline">
          {row.name}
          {you && " · you"}
        </Link>
        <span className="text-small text-ink-2" aria-label={`${row.wins} won, ${row.losses} lost${row.draws ? `, ${row.draws} drawn` : ""}`}>
          {record(row)}
        </span>
      </span>
      <span className="text-right font-mono text-[12.5px] tabular-nums" aria-label={`Rating ${row.rating}`}>
        {fmt(row.rating)}
      </span>
      <span className="text-right font-mono text-[12.5px] tabular-nums text-ink-2" aria-label={`${row.points} points`}>
        {fmt(row.points)}
      </span>
    </li>
  );
}

/**
 * Your row, pinned above the dock (or the bottom edge on desktop) while your
 * row in the list is off screen, or you sit on the podium out of view. Not
 * on the board yet: a nudge in the same spot.
 */
function Pinned({ row, board }: { row?: LeaderboardRow; board: Board }) {
  const [inView, setInView] = useState(true);

  useEffect(() => {
    if (!row) return;
    const el = document.getElementById(row.rank > PODIUM ? "my-rank" : "podium");
    if (!el) return;
    // On mobile the bottom margin counts the row as hidden once it is under the dock.
    const dock = window.matchMedia("(min-width: 768px)").matches ? 0 : 92;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: `0px 0px -${dock}px 0px`, threshold: 1 });
    io.observe(el);
    return () => io.disconnect();
  }, [row]);

  if (row && inView) return null;
  return (
    <div
      role="status"
      className="glass fixed inset-x-3 bottom-[92px] z-20 mx-auto max-w-[480px] rounded-[20px] px-3.5 shadow-[var(--sh),inset_0_0_0_1.5px_rgb(var(--you))] md:sticky md:bottom-3 md:mx-0 md:max-w-none"
    >
      {row ? (
        <ul>
          <RankRow row={row} you pinned />
        </ul>
      ) : (
        <div className="flex items-center gap-2.5 py-2.5 text-[13.5px]">
          <Icon3D name="sprout" size={34} />
          <span className="min-w-0 flex-1">
            <b className="font-semibold">You’re not ranked yet.</b>{" "}
            <span className="text-ink-2">Win or lose, one recorded match against a player puts you on the board.</span>
          </span>
          <ButtonLink href={board === "overall" ? "/" : `/queue/${board}`} size="sm">
            Play
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy aria-label="Loading rankings">
      <div className="grid grid-cols-3 items-end gap-2">
        {[96, 124, 80].map((h, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="h-[84px] w-[84px] animate-pulse rounded-[28px] bg-sf" />
            <div className="w-full animate-pulse rounded-[18px_18px_6px_6px] bg-sf" style={{ height: h }} />
          </div>
        ))}
      </div>
      {[1, 0.8, 0.6, 0.4].map((o) => (
        <div key={o} className="h-[54px] animate-pulse rounded-xl bg-sf" style={{ opacity: o }} />
      ))}
    </div>
  );
}

function Empty({ board }: { board: Board }) {
  return (
    <div className="card relative flex flex-col items-center gap-3 overflow-hidden !px-[18px] !py-[22px] text-center">
      <div className="dither !h-[220px]" aria-hidden />
      <div className="plate relative flex h-[140px] w-[140px] items-center justify-center rounded-full">
        <Icon3D name="podium" size={104} />
      </div>
      <h2 className="relative text-[24px] font-semibold tracking-[-.04em]">Be the first</h2>
      <p className="relative text-ink-2">No ranked matches yet. Play someone to get on the board.</p>
      <ButtonLink href={board === "overall" ? "/" : `/queue/${board}`} variant="act" icon={board === "overall" ? "controller" : "lightning"} block>
        {board === "overall" ? "Play a match" : "Quick match"}
      </ButtonLink>
      <span className="relative text-small text-ink-2">Bot matches never change rank.</span>
    </div>
  );
}
