"use client";

// The match drawer: GET matches/:id for a recorded match (result, players, times,
// ledger blocks, stake and escrow, replay and ledger links) or a live one (live
// info and a Watch button). Opens from the table or from ?open=<id>; a 404 shows
// a not-found state inside the drawer.

import { Button, ButtonLink } from "@/components/admin/Button";
import { CopyButton } from "@/components/admin/CopyButton";
import { Drawer } from "@/components/admin/Drawer";
import { EmptyState } from "@/components/admin/EmptyState";
import { Money } from "@/components/admin/Money";
import { Skeleton } from "@/components/admin/Skeleton";
import { StatusPill } from "@/components/admin/StatusPill";
import { useAdminQuery } from "@/lib/admin/api";
import { dateTime, duration, fullDate, num, shortId } from "@/lib/admin/format";
import { ledgerText, liveElapsed, matchResult } from "@/lib/admin/matches";
import type { LiveMatchRow, MatchDetail } from "@/lib/admin/types";
import { ResultCell, Seat, StakePill } from "./MatchParts";

type Detail = MatchDetail | (LiveMatchRow & { live: true });
const isLive = (d: Detail): d is LiveMatchRow & { live: true } => "live" in d && d.live === true;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-4 first:pt-0 last:border-0">
      <h3 className="label mb-2.5 !text-[10.5px]">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[28px] items-center justify-between gap-4 text-[13.5px]">
      <dt className="flex-none text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right text-ink">{children}</dd>
    </div>
  );
}

const dash = <span className="text-ink-3">–</span>;

function Body({ d }: { d: Detail }) {
  if (isLive(d)) {
    return (
      <>
        <Section title="Players">
          <div className="space-y-2">
            {d.players.map((p, i) => (
              <Seat key={`${p.profileId}-${i}`} p={p} winner={false} size="md" />
            ))}
          </div>
        </Section>
        <Section title="Live">
          <dl>
            <Row label="Started">{dateTime(d.startedAt)}</Row>
            <Row label="Running for"><span className="num font-normal">{liveElapsed(d.startedAt, Date.now())}</span></Row>
            <Row label="Moves"><span className="num font-normal">{num(d.moves)}</span></Row>
            <Row label="Watching"><span className="num font-normal">{num(d.spectators)}</span></Row>
            <Row label="Room code">{d.room ? <CopyButton value={d.room} label="Copy room code">{d.room}</CopyButton> : dash}</Row>
            <Row label="Stake"><StakePill stake={d.stake} /></Row>
          </dl>
        </Section>
      </>
    );
  }
  const r = matchResult(d);
  return (
    <>
      <Section title="Result">
        <ResultCell m={d} reason={false} full />
        {r.reason && <p className="mt-2 text-[13px] text-ink-2">{r.reason}</p>}
      </Section>
      <Section title="Players">
        <div className="space-y-2">
          {d.players.map((p, i) => (
            <Seat key={`${p.profileId}-${i}`} p={p} winner={r.winnerSeat === i} size="md" />
          ))}
        </div>
      </Section>
      <Section title="Times">
        <dl>
          <Row label="Started"><span title={fullDate(d.startedAt)}>{dateTime(d.startedAt)}</span></Row>
          <Row label="Ended"><span title={fullDate(d.endedAt)}>{dateTime(d.endedAt)}</span></Row>
          <Row label="Duration"><span className="num font-normal">{duration(d.durationMs)}</span></Row>
          <Row label="Moves"><span className="num font-normal">{num(d.moves)}</span></Row>
        </dl>
      </Section>
      <Section title="Ledger">
        <dl>
          <Row label="Status"><StatusPill status={d.status}>{ledgerText(d)}</StatusPill></Row>
          <Row label="Commit block"><span className="num font-normal">{d.commitIndex ?? "–"}</span></Row>
          <Row label="Result block"><span className="num font-normal">{d.resultIndex ?? "–"}</span></Row>
          <Row label="Result hash">
            {d.resultHash ? (
              <CopyButton value={d.resultHash} label="Copy result hash">
                {shortId(d.resultHash, 10, 8)}
              </CopyButton>
            ) : (
              dash
            )}
          </Row>
        </dl>
      </Section>
      {d.stake && (
        <Section title="Stake and escrow">
          <dl>
            <Row label="Stake per player"><Money santim={d.stake.amount} book={d.stake.book} /></Row>
            <Row label="Pot"><Money santim={d.stake.amount * 2} book={d.stake.book} /></Row>
            <Row label="Prize"><Money santim={d.stake.prize} book={d.stake.book} /></Row>
            <Row label="Platform fee"><Money santim={d.stake.fee} book={d.stake.book} /></Row>
            <Row label="Status"><StatusPill status={d.stake.status} /></Row>
            <Row label="Book">{d.stake.book === "real" ? "Real money" : "Play money"}</Row>
            <Row label="Escrow id">
              {d.escrow ? (
                <CopyButton value={d.escrow.id} label="Copy escrow id">
                  {shortId(d.escrow.id, 8, 6)}
                </CopyButton>
              ) : (
                dash
              )}
            </Row>
          </dl>
        </Section>
      )}
    </>
  );
}

export function MatchDrawer({ id, onClose }: { id: string | null; onClose(): void }) {
  const { data, error, loading, reload } = useAdminQuery<Detail>(id ? `matches/${encodeURIComponent(id)}` : null);
  const d = data as Detail | null;
  const notFound = error?.status === 404;
  const title = d ? d.gameName : notFound ? "Match not found" : "Match";
  const footer = d ? (
    isLive(d) ? (
      <ButtonLink href={`/match/${encodeURIComponent(d.matchId)}`} target="_blank" rel="noopener noreferrer" variant="primary" icon="external">
        Watch
      </ButtonLink>
    ) : (
      <>
        <ButtonLink href="/ledger" target="_blank" rel="noopener noreferrer" variant="secondary" icon="shield">
          Verify on ledger
        </ButtonLink>
        <ButtonLink href={d.replay ?? `/replay/${encodeURIComponent(d.matchId)}`} target="_blank" rel="noopener noreferrer" variant="primary" icon="external">
          Open replay
        </ButtonLink>
      </>
    )
  ) : undefined;

  return (
    <Drawer
      open={id !== null}
      onClose={onClose}
      title={title}
      subtitle={d ? (isLive(d) ? <span>Live now</span> : <span>{matchResult(d).label}</span>) : id ? <span className="font-mono text-[12px] text-ink-3">{shortId(id, 8, 6)}</span> : undefined}
      footer={footer}
    >
      {error && !data ? (
        notFound ? (
          <EmptyState icon="search" title="This match does not exist">
            There is no recorded or live match with the id <span className="font-mono">{id}</span>. The link may be old or mistyped.
          </EmptyState>
        ) : (
          <EmptyState icon="alert" tone="error" title="Couldn't load this match" action={<Button size="sm" icon="refresh" onClick={reload}>Try again</Button>}>
            {error.message}
          </EmptyState>
        )
      ) : !d ? (
        <div className="space-y-4" aria-busy={loading || undefined}>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <Body d={d} />
      )}
    </Drawer>
  );
}
