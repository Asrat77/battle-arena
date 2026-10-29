"use client";

// Replay & verify: step through a finished match by replaying its log with the
// game's own rules (the adapter's ReplayStep draws each step), then check it
// against the ledger. Verify sits under the replay on phones and beside it on
// desktop.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdapterPlayer } from "@/components/match/adapter";
import { adapterFor } from "@/components/match/adapters";
import { Scrubber, type Speed } from "@/components/replay/Scrubber";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { ButtonLink } from "@/components/ui/Button";
import { Chip, RecordChip } from "@/components/ui/Chip";
import { Icon3D } from "@/components/ui/Icon3D";
import { VerifyPanel } from "@/components/verify/VerifyPanel";
import { getGame } from "@/engine/registry";
import { emptyCells, openingSeat, ticTacToe, type TicTacToeState } from "@/engine/games/ticTacToe";
import { replay } from "@/engine/replay";
import type { LogEntry, MatchRecord, Seat } from "@/engine/types";
import type { VerifyReport } from "@/engine/verify";
import { ApiError, api, BOT_PLAYER, type StoredMatch } from "@/lib/api";
import { shortId, usePlayerNames } from "@/lib/usePlayerNames";

import { GAME_ICONS } from "@/lib/gameCatalog";

const REASONS: Record<string, string> = {
  cracked: "cracked the code",
  forfeit: "by forfeit",
  timeout: "on time",
};

type Load = { kind: "loading" } | { kind: "ok"; match: StoredMatch } | { kind: "live" } | { kind: "missing" } | { kind: "error"; message: string };

export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    setLoad({ kind: "loading" });
    api.match(id).then(
      (match) => setLoad({ kind: "ok", match }),
      (e) => {
        if (e instanceof ApiError && e.status === 409) setLoad({ kind: "live" });
        else if (e instanceof ApiError && e.status === 404) setLoad({ kind: "missing" });
        else setLoad({ kind: "error", message: (e as Error).message });
      },
    );
  }, [id]);

  if (load.kind === "ok") return <Replay match={load.match} />;
  return (
    <Shell>
      {load.kind === "loading" && (
        <p className="flex items-center gap-2 text-ink-3">
          <span className="spin" aria-hidden /> Loading replay…
        </p>
      )}
      {load.kind === "live" && (
        <div className="card flex max-w-xl flex-col gap-3">
          <div className="flex items-center gap-3">
            <Icon3D name="satellite" size={44} />
            <div className="min-w-0 flex-1">
              <Chip tone="bad" dot="rgb(var(--bad))">
                Live
              </Chip>
              <p className="mt-1 font-semibold">This match is still being played</p>
              <p className="text-small text-ink-3">Replays open when it ends.</p>
            </div>
          </div>
          <ButtonLink href={`/match/${id}`} icon="binoculars" block>
            Watch it live
          </ButtonLink>
        </div>
      )}
      {(load.kind === "missing" || load.kind === "error") && (
        <div className="card flex max-w-xl flex-col items-center gap-2.5 text-center">
          <Icon3D name="err404" size={80} />
          <b className="font-semibold">{load.kind === "missing" ? "No finished match with this ID" : "Couldn’t load this replay"}</b>
          <span className="text-small text-ink-3">
            {load.kind === "missing" ? "Check the link, or search the ledger by match ID." : load.message}
          </span>
          <ButtonLink href="/ledger" icon="blockchain" block>
            Open the ledger
          </ButtonLink>
        </div>
      )}
    </Shell>
  );
}

/** Page chrome: phones draw their own header (the app bar is hidden here). */
function Shell({ chip, children }: { chip?: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4">
      <header className="-mx-4 -mt-6 flex min-h-[60px] items-center gap-2 px-3 md:hidden">
        <button
          type="button"
          aria-label="Back"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-sf text-[22px] text-ink"
        >
          <span aria-hidden>‹</span>
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[18px] font-semibold tracking-[-.03em]">Replay &amp; verify</h1>
        {chip}
      </header>
      <div className="hidden items-center gap-3 md:flex">
        <Icon3D name="verified" size={48} />
        <h1 className="flex-1 text-[36px] font-semibold leading-none tracking-[-.045em]">Replay &amp; verify</h1>
        {chip}
      </div>
      {children}
    </div>
  );
}

function Replay({ match }: { match: StoredMatch }) {
  const { record } = match;
  const names = usePlayerNames(record.players);
  const labels: [string, string] = [names[record.players[0]] ?? "…", names[record.players[1]] ?? "…"];
  const adapter = adapterFor(record.gameId);
  const last = record.log.length;

  const [pos, setPos] = useState(last);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [mismatch, setMismatch] = useState(false);
  const onDone = useCallback((r: VerifyReport) => setMismatch(!r.ok), []);
  const seek = useCallback((p: number) => setPos(p), []);

  const recordState = mismatch ? "mismatch" : match.status === "recorded" ? "recorded" : "pending";
  const round = useMemo(() => roundAt(record, pos), [record, pos]);
  const label = `Step ${pos} of ${last}${round ? ` · ${record.gameId === "tic-tac-toe" ? "Board" : "Round"} ${round}` : ""}`;

  return (
    <div className={record.gameId === "dots-and-boxes" ? "dots-palette" : undefined}>
    <Shell chip={<RecordChip state={recordState} block={match.resultIndex} long={false} />}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_380px] md:items-start lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-7">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Summary match={match} labels={labels} />
          {adapter ? (
            <adapter.ReplayStep
              log={record.log}
              step={pos}
              seed={record.seed}
              names={labels}
              players={[player(record, labels, 0), player(record, labels, 1)]}
            />
          ) : (
            <p className="card text-small text-ink-3">This game has no replay view yet. Verify still checks it.</p>
          )}
          <Scrubber pos={pos} last={last} onSeek={seek} playing={playing} onPlaying={setPlaying} speed={speed} onSpeed={setSpeed} label={label} />
          <Timeline
            record={record}
            labels={labels}
            pos={pos}
            describe={adapter?.describeMove}
            commitIndex={match.commitIndex}
            resultIndex={match.resultIndex}
            onPick={(p) => {
              setPlaying(false);
              setPos(p);
            }}
          />
        </div>
        <aside className="flex min-w-0 flex-col gap-3 md:sticky md:top-[92px]">
          <VerifyPanel match={match} names={labels} onDone={onDone} />
        </aside>
      </div>
    </Shell>
    </div>
  );
}

function Summary({ match, labels }: { match: StoredMatch; labels: [string, string] }) {
  const { record } = match;
  const game = getGame(record.gameId);
  const icon = GAME_ICONS[record.gameId as keyof typeof GAME_ICONS] ?? "controller";
  const { outcome } = record;
  const reason = REASONS[outcome.reason] ?? outcome.reason.replace(/[-_]/g, " ");
  return (
    <div className="card flex flex-col gap-2.5" data-testid="replay-summary">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold">
          <Icon3D name={icon} size={26} />
          {game?.name ?? record.gameId}
        </span>
        <span className="text-small text-ink-3">{playedAt(record.startedAt, record.endedAt)}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-small">
        {([0, 1] as const).map((s) => (
          <span key={s} className="flex min-w-0 items-center gap-2">
            {s === 1 && <span className="text-ink-3">vs</span>}
            <Avatar3D id={record.players[s]} bot={record.players[s] === BOT_PLAYER} size="sm" />
            <b className={`truncate font-semibold ${s === 0 ? "text-you" : "text-opp"}`}>{labels[s]}</b>
          </span>
        ))}
        <span className="flex-1" />
        {outcome.draw ? (
          <b className="font-semibold">Draw · {reason}</b>
        ) : (
          <span className="flex items-center gap-1.5">
            <Icon3D name="crown" size={22} />
            <b className="font-semibold">{labels[outcome.winner!]}</b>
            <span className="text-ink-3">{reason}</span>
          </span>
        )}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-small">
        <dt className="text-ink-3">Result hash</dt>
        <dd className="mono truncate text-right text-[12px]" title={match.resultHash}>
          {short(match.resultHash)}
        </dd>
        <dt className="text-ink-3">Match ID</dt>
        <dd className="mono truncate text-right text-[12px]" title={record.matchId}>
          {shortId(record.matchId)}
        </dd>
      </dl>
    </div>
  );
}

/** Every log entry as a row; tapping one jumps there. The current row stays in view inside its own scroll box. */
function Timeline({
  record,
  labels,
  pos,
  describe,
  commitIndex,
  resultIndex,
  onPick,
}: {
  record: MatchRecord;
  labels: [string, string];
  pos: number;
  describe?: (move: never) => string;
  commitIndex: number | null;
  resultIndex: number | null;
  onPick(pos: number): void;
}) {
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = box.current;
    const row = list?.querySelector<HTMLElement>("[aria-current=step]");
    if (!list || !row) return;
    // Scroll the list only, never the page. The list is the row's offsetParent.
    const top = row.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTo({ top: top - list.clientHeight / 2 + row.offsetHeight / 2, behavior: "smooth" });
  }, [pos]);

  const rows: { step: number; text: React.ReactNode; tone?: "you" | "opp"; system?: boolean }[] = [
    { step: 0, text: commitIndex !== null ? `Match starts · commitments in block #${commitIndex}` : "Match starts" },
    ...record.log.map((e, i) => ({ step: i + 1, ...entryText(e, labels, describe, ticTimeoutText(record, i, labels)) })),
  ];
  return (
    <section aria-label="Timeline" className="card px-2 py-1.5">
      <ol ref={box} className="relative max-h-[280px] overflow-y-auto">
        {rows.map((r) => {
          const state = r.step === pos ? "cur" : r.step > pos ? "fut" : "past";
          return (
            <li key={r.step}>
              <button
                type="button"
                onClick={() => onPick(r.step)}
                aria-current={state === "cur" ? "step" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-small ${state === "cur" ? "bg-sf-2" : ""} ${
                  state === "fut" ? "opacity-45" : ""
                }`}
              >
                <span className="mono w-6 flex-none text-right text-ink-3">{r.step}</span>
                {r.system && <Icon3D name="stopwatch" size={18} />}
                <span className="min-w-0 flex-1">{r.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {resultIndex !== null && (
        <p className="flex items-center gap-2 border-t border-line px-2.5 pb-1 pt-2 text-small text-ink-3">
          <Icon3D name="trophy" size={18} />
          Result recorded in{" "}
          <Link href={`/ledger#block-${resultIndex}`} className="underline">
            block #{resultIndex}
          </Link>
        </p>
      )}
    </section>
  );
}

function entryText(entry: LogEntry, labels: [string, string], describe?: (move: never) => string, timeoutText?: string): { text: React.ReactNode; system?: boolean } {
  if (entry.seat === "system") {
    if (entry.move.type === "forfeit") return { text: `${labels[entry.move.seat]} forfeits`, system: true };
    return { text: timeoutText ?? "Timer ran out", system: true };
  }
  const who = <b className={`font-semibold ${entry.seat === 0 ? "text-you" : "text-opp"}`}>{labels[entry.seat]}</b>;
  const what = describe ? describe(entry.move as never) : `plays ${JSON.stringify(entry.move)}`;
  return { text: <>{who} {what}</> };
}

/** Name the two kinds of series timeout without changing the shared log format. */
function ticTimeoutText(record: MatchRecord, index: number, labels: [string, string]): string | undefined {
  const entry = record.log[index];
  if (record.gameId !== ticTacToe.id || entry.seat !== "system" || entry.move.type !== "timeout") return;
  try {
    const state = replay(ticTacToe, record.seed, record.log.slice(0, index)).state as TicTacToeState;
    if (state.phase === "pause") return `Board ${state.round + 1} starts · ${labels[openingSeat(state.round + 1)]} opens with X`;
    const cell = emptyCells(state.board)[0];
    return `${labels[state.turn]} auto-plays row ${Math.floor(cell / 3) + 1}, column ${cell % 3 + 1}`;
  } catch { return "Timer ran out"; }
}

/** The round number at `pos` for games whose state counts rounds (Crack the Code). */
function player(record: MatchRecord, labels: [string, string], s: Seat): AdapterPlayer {
  return { id: record.players[s], name: labels[s], bot: record.players[s] === BOT_PLAYER };
}

function roundAt(record: MatchRecord, pos: number): number | null {
  const game = getGame(record.gameId);
  if (!game) return null;
  try {
    const { round } = replay(game, record.seed, record.log.slice(0, pos)).state as { round?: unknown };
    return typeof round === "number" && round > 0 ? round : null;
  } catch {
    return null;
  }
}

function short(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

function playedAt(start: number, end: number): string {
  const d = new Date(start);
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const t = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${t(start)}–${t(end)}`;
}
