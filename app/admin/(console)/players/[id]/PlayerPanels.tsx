"use client";

// The tab bodies of the player page: overview (rewards, per-game table, newest
// matches), matches, wallet, deposits and withdrawals. Each is a card with a
// DataTable (phones get stacked cards) and a link to the full list elsewhere.

import { ButtonLink } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { CopyButton } from "@/components/admin/CopyButton";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Money } from "@/components/admin/Money";
import { PlayerCell } from "@/components/admin/PlayerCell";
import { Segmented } from "@/components/admin/Tabs";
import { StatusPill, type PillTone } from "@/components/admin/StatusPill";
import { TimeAgo } from "@/components/admin/TimeAgo";
import { dateTime, duration, num, shortId, unitFor, type Book } from "@/lib/admin/format";
import { kindLabel, kindTone } from "@/lib/admin/overview";
import {
  RESULT_LABELS,
  bankLabel,
  depositAmount,
  gameLabel,
  opponentOf,
  resultFor,
  winRate,
  winRateText,
  wonPrize,
  type MatchResult,
} from "@/lib/admin/players";
import type { AdminDeposit, AdminWithdrawal, GameTally, MatchRow, UserDetail } from "@/lib/admin/types";
import type { Txn } from "@/backend/src/wallet";

const dash = <span className="text-ink-3">–</span>;
const RESULT_TONE: Record<MatchResult, PillTone> = { won: "success", lost: "rejected", draw: "neutral" };

/** A label and value pair used in the rewards card. */
function Stat({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label !text-[10.5px]">{label}</dt>
      <dd className="num mt-1.5 text-[22px] leading-none tracking-[-0.02em] text-ink">{children}</dd>
      {sub && <dd className="mt-1.5 text-[12px] font-normal text-ink-3">{sub}</dd>}
    </div>
  );
}

// ---------------------------------------------------------------- matches

function matchColumns(profileId: string): Column<MatchRow>[] {
  return [
    { key: "time", header: "Time", phone: "secondary", cell: (m) => <TimeAgo ts={m.endedAt} mode="date" className="text-ink-2" /> },
    { key: "game", header: "Game", primary: true, cell: (m) => <span className="font-medium text-ink">{m.gameName}</span> },
    {
      key: "opponent",
      header: "Opponent",
      phone: "secondary",
      phoneLabel: "opponent",
      cell: (m) => {
        const o = opponentOf(m, profileId);
        return o ? <PlayerCell id={o.profileId} name={o.name} username={o.username} bot={o.bot} size="sm" /> : dash;
      },
    },
    {
      key: "result",
      header: "Result",
      primary: true,
      cell: (m) => {
        const r = resultFor(m, profileId);
        return r ? <StatusPill tone={RESULT_TONE[r]}>{RESULT_LABELS[r]}</StatusPill> : dash;
      },
    },
    { key: "duration", header: "Duration", phone: "secondary", align: "right", cell: (m) => <span className="num font-normal text-ink-2">{duration(m.durationMs)}</span> },
    { key: "moves", header: "Moves", align: "right", cell: (m) => <span className="num font-normal text-ink-2">{num(m.moves)}</span> },
    {
      key: "stake",
      header: "Stake",
      phone: "secondary",
      align: "right",
      cell: (m) => {
        if (!m.stake) return <span className="text-ink-3">Free</span>;
        const prize = wonPrize(m, resultFor(m, profileId));
        return (
          <div className="leading-tight">
            <Money santim={m.stake.amount} book={m.stake.book} />
            {prize != null && (
              <div className="text-[11.5px] font-normal text-recorded">
                won <Money santim={prize} book={m.stake.book} unit={false} className="!text-recorded" />
              </div>
            )}
            {m.stake.status === "refunded" && <div className="text-[11.5px] font-normal text-ink-3">refunded</div>}
          </div>
        );
      },
    },
    { key: "status", header: "Ledger", cell: (m) => <StatusPill status={m.status} /> },
  ];
}

const matchHref = (m: MatchRow) => `/admin/matches?open=${encodeURIComponent(m.matchId)}`;

export function MatchesPanel({ detail, limit }: { detail: UserDetail; limit?: number }) {
  const rows = limit ? detail.recentMatches.slice(0, limit) : detail.recentMatches;
  return (
    <Card
      title={limit ? "Newest matches" : `Recent matches (${num(rows.length)} of ${num(detail.matches)})`}
      bodyClassName=""
      actions={
        <ButtonLink href={`/admin/matches?player=${encodeURIComponent(detail.profile.id)}`} size="sm" variant="secondary" iconRight="chevronRight">
          All matches of this player
        </ButtonLink>
      }
    >
      <DataTable
        caption="Matches of this player"
        rows={rows}
        columns={matchColumns(detail.profile.id)}
        rowKey={(m) => m.matchId}
        rowHref={matchHref}
        empty={{ title: "No matches yet", body: "This player has not finished a match." }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------- overview

export function OverviewPanel({ detail }: { detail: UserDetail }) {
  const { rewards, perGame } = detail;
  const o = rewards.overall;
  const played = o.wins + o.losses + o.draws;
  const cols: Column<GameTally>[] = [
    { key: "game", header: "Game", primary: true, cell: (g) => <span className="font-medium text-ink">{gameLabel(g.gameId, detail.recentMatches)}</span> },
    { key: "played", header: "Played", phone: "secondary", phoneLabel: "played", align: "right", cell: (g) => <span className="num">{num(g.played)}</span> },
    { key: "wins", header: "Wins", phone: "secondary", phoneLabel: "wins", align: "right", cell: (g) => <span className="num">{num(g.wins)}</span> },
    { key: "losses", header: "Losses", phone: "secondary", phoneLabel: "losses", align: "right", cell: (g) => <span className="num">{num(g.losses)}</span> },
    { key: "draws", header: "Draws", align: "right", cell: (g) => <span className="num">{num(g.draws)}</span> },
    {
      key: "rate",
      header: "Win rate",
      primary: true,
      className: "md:w-[190px]",
      cell: (g) => {
        const r = winRate(g.wins, g.played);
        return (
          <div className="flex items-center justify-end gap-2.5 md:justify-start">
            <span
              role="img"
              aria-label={`Win rate ${winRateText(g.wins, g.played)}`}
              className="hidden h-1.5 w-20 flex-none overflow-hidden rounded-full bg-sf-3 md:block"
            >
              <span className="block h-full rounded-full bg-accent" style={{ width: `${(r ?? 0) * 100}%` }} />
            </span>
            <span className="num w-10 text-right md:text-left">{winRateText(g.wins, g.played)}</span>
          </div>
        );
      },
    },
  ];
  return (
    <div className="grid gap-4 lg:gap-5">
      <Card title="Rewards" info="Points, ratings and badges come from the rewards ledger. W/L/D counts matches against players and bots.">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          <Stat label="Points">{num(rewards.points)}</Stat>
          <Stat label="Tokens">{num(rewards.tokens)}</Stat>
          <Stat
            label="Overall rating"
            sub={
              <span className="num font-normal">
                <span className="text-recorded">{num(o.wins)}W</span> <span className="text-mismatch">{num(o.losses)}L</span> <span className="text-ink-2">{num(o.draws)}D</span>
                <span className="text-ink-3"> · {winRateText(o.wins, played)}</span>
              </span>
            }
          >
            {num(o.rating)}
          </Stat>
          <Stat label="Win streak" sub={rewards.streak === 1 ? "win in a row" : "wins in a row"}>
            {num(rewards.streak)}
          </Stat>
        </dl>
        <div className="mt-5 border-t border-line pt-4">
          <p className="label !text-[10.5px]">Badges</p>
          {rewards.badges.length ? (
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {rewards.badges.map((b) => (
                <li key={b.id}>
                  <span title={`Earned ${dateTime(b.earnedAt)}`} className="inline-flex h-6 items-center rounded-full border border-accent/40 bg-accent/10 px-2.5 text-[12px] font-medium text-accent">
                    {b.name}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-ink-3">No badges earned yet.</p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:gap-5">
        <Card title="Per game" bodyClassName="">
          <DataTable
            caption="Results per game"
            rows={perGame}
            columns={cols}
            rowKey={(g) => g.gameId}
            empty={{ title: "No games played", body: "Results per game appear after the first match." }}
          />
        </Card>
        <div className="min-w-0">
          <MatchesPanel detail={detail} limit={5} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- wallet

export function WalletPanel({ detail, book, onBook }: { detail: UserDetail; book: Book; onBook(b: Book): void }) {
  const txns = detail.txns[book];
  const cols: Column<Txn>[] = [
    { key: "time", header: "Time", phone: "secondary", cell: (t) => <TimeAgo ts={t.ts} mode="date" className="text-ink-2" /> },
    { key: "kind", header: "Kind", primary: true, cell: (t) => <StatusPill tone={kindTone(t.kind)}>{kindLabel(t.kind)}</StatusPill> },
    { key: "amount", header: "Amount", align: "right", primary: true, cell: (t) => <Money santim={t.amount} book={book} signed unit={false} /> },
    { key: "balance", header: "Balance after", phone: "secondary", phoneLabel: "after", align: "right", cell: (t) => <Money santim={t.balance} book={book} unit={false} className="text-ink-2" /> },
    {
      key: "ref",
      header: "Ref",
      phone: "secondary",
      cell: (t) =>
        t.ref ? (
          <CopyButton value={t.ref} label="Copy reference" className="whitespace-nowrap">
            {shortId(t.ref, 6, 4)}
          </CopyButton>
        ) : (
          dash
        ),
    },
    {
      key: "note",
      header: "Note",
      className: "md:max-w-[320px]",
      cell: (t) =>
        t.note || t.by ? (
          <div className="min-w-0 text-[13px] leading-snug">
            {t.note && <p className="line-clamp-2 text-ink" title={t.note}>{t.note}</p>}
            {t.by && <p className="text-[12px] text-ink-3">by {t.by}</p>}
          </div>
        ) : (
          dash
        ),
    },
  ];
  return (
    <Card
      title={`${book === "real" ? "Real" : "Play"} money, newest ${num(Math.min(txns.length, 50))}`}
      info="The last 50 movements in this book. The full history is in the wallet ledger."
      bodyClassName=""
      actions={
        <>
          <Segmented<Book>
            label="Book"
            size="sm"
            value={book}
            onChange={onBook}
            items={[
              { value: "real", label: "Real" },
              { value: "play", label: "Play" },
            ]}
          />
          <ButtonLink href={`/admin/wallet?profileId=${encodeURIComponent(detail.profile.id)}`} size="sm" variant="secondary" iconRight="chevronRight">
            Full ledger for this player
          </ButtonLink>
        </>
      }
    >
      <DataTable
        caption={`${unitFor(book)} transactions of this player`}
        rows={txns}
        columns={cols}
        rowKey={(t) => t.id}
        empty={{ title: `No ${book === "real" ? "real-money" : "play-money"} transactions`, body: "Deposits, stakes, wins and adjustments show up here." }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------- deposits

export function DepositsPanel({ rows }: { rows: AdminDeposit[] }) {
  const cols: Column<AdminDeposit>[] = [
    { key: "time", header: "Time", phone: "secondary", cell: (d) => <TimeAgo ts={d.createdAt} mode="date" className="text-ink-2" /> },
    { key: "bank", header: "Bank", phone: "secondary", cell: (d) => bankLabel(d.bank) },
    {
      key: "ref",
      header: "Reference",
      phone: "secondary",
      cell: (d) => (
        <CopyButton value={d.reference} label="Copy reference" className="whitespace-nowrap">
          {shortId(d.reference, 8, 4)}
        </CopyButton>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      primary: true,
      cell: (d) => {
        const a = depositAmount(d);
        return a.amount == null ? (
          dash
        ) : (
          <div className="leading-tight">
            <Money santim={a.amount} />
            {a.review && <div className="text-[11.5px] font-normal text-ink-3">to review</div>}
          </div>
        );
      },
    },
    { key: "status", header: "Status", primary: true, cell: (d) => <StatusPill status={d.status} /> },
    { key: "payer", header: "Payer name", cell: (d) => d.payerName || dash },
    { key: "sender", header: "Sender on receipt", cell: (d) => d.senderName || dash },
    {
      key: "why",
      header: "Review reason",
      className: "md:max-w-[260px]",
      cell: (d) => {
        const why = d.reviewWhy || d.reason;
        return why ? (
          <span className="line-clamp-2 text-[13px] leading-snug text-ink-2" title={why}>
            {why}
          </span>
        ) : (
          dash
        );
      },
    },
    {
      key: "closed",
      header: "Closed",
      cell: (d) =>
        d.closedAt ? (
          <div className="leading-tight">
            <TimeAgo ts={d.closedAt} mode="date" className="text-ink-2" />
            {d.closedBy && <div className="text-[12px] text-ink-3">by {d.closedBy}</div>}
          </div>
        ) : (
          dash
        ),
    },
  ];
  return (
    <Card title={`Deposits (${num(rows.length)})`} info="The newest 20 deposits of this player. Receipt details are for moderators only." bodyClassName="" actions={<ButtonLink href="/admin/deposits" size="sm" variant="secondary" iconRight="chevronRight">All deposits</ButtonLink>}>
      <DataTable caption="Deposits of this player" rows={rows} columns={cols} rowKey={(d) => d.id} empty={{ title: "No deposits", body: "This player has not tried to deposit." }} />
    </Card>
  );
}

// ---------------------------------------------------------------- withdrawals

function Flags({ w }: { w: AdminWithdrawal }) {
  const flags: { key: string; label: string; detail?: string; tone: string }[] = [];
  if (w.forced) flags.push({ key: "forced", label: "Forced", detail: `${w.forced.by}: ${w.forced.reason}`, tone: "border-pending/50 text-pending" });
  if (w.unverified) flags.push({ key: "unv", label: "Unverified", detail: w.unverified.why, tone: "border-mismatch/50 text-mismatch" });
  if (w.approval && w.status === "pending") flags.push({ key: "appr", label: "Waiting for second approval", detail: `first by ${w.approval.by}`, tone: "border-accent/50 text-accent" });
  if (!flags.length) return dash;
  return (
    <ul className="space-y-1.5">
      {flags.map((f) => (
        <li key={f.key} className="min-w-0 text-left">
          <span className={`inline-flex h-5 items-center rounded-full border px-2 text-[11.5px] font-medium ${f.tone}`}>{f.label}</span>
          {f.detail && (
            <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-ink-3" title={f.detail}>
              {f.detail}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function WithdrawalsPanel({ rows }: { rows: AdminWithdrawal[] }) {
  const cols: Column<AdminWithdrawal>[] = [
    { key: "time", header: "Time", phone: "secondary", cell: (w) => <TimeAgo ts={w.createdAt} mode="date" className="text-ink-2" /> },
    { key: "bank", header: "Bank", phone: "secondary", cell: (w) => bankLabel(w.bank) },
    {
      key: "account",
      header: "Account",
      phone: "secondary",
      cell: (w) => (
        <CopyButton value={w.account} label="Copy account" className="whitespace-nowrap">
          {w.account}
        </CopyButton>
      ),
    },
    { key: "payto", header: "Pay-to name", cell: (w) => w.payToName || dash },
    { key: "amount", header: "Amount", align: "right", primary: true, cell: (w) => <Money santim={w.amount} /> },
    { key: "status", header: "Status", primary: true, cell: (w) => <StatusPill status={w.status} /> },
    {
      key: "ref",
      header: "Payout reference",
      cell: (w) =>
        w.reference ? (
          <CopyButton value={w.reference} label="Copy payout reference" className="whitespace-nowrap">
            {shortId(w.reference, 8, 4)}
          </CopyButton>
        ) : (
          dash
        ),
    },
    { key: "picked", header: "Picked up by", cell: (w) => w.pickedUpBy || dash },
    {
      key: "closed",
      header: "Closed",
      cell: (w) =>
        w.closedAt ? (
          <div className="leading-tight">
            <TimeAgo ts={w.closedAt} mode="date" className="text-ink-2" />
            {w.closedBy && <div className="text-[12px] text-ink-3">by {w.closedBy}</div>}
          </div>
        ) : (
          dash
        ),
    },
    { key: "flags", header: "Flags", className: "md:max-w-[240px]", cell: (w) => <Flags w={w} /> },
  ];
  return (
    <Card
      title={`Withdrawals (${num(rows.length)})`}
      info="The newest 20 withdrawals of this player. Payouts are made by moderators in Telegram; this view is read only."
      bodyClassName=""
      actions={<ButtonLink href="/admin/withdrawals" size="sm" variant="secondary" iconRight="chevronRight">All withdrawals</ButtonLink>}
    >
      <DataTable caption="Withdrawals of this player" rows={rows} columns={cols} rowKey={(w) => w.id} empty={{ title: "No withdrawals", body: "This player has not asked for a payout." }} />
    </Card>
  );
}

