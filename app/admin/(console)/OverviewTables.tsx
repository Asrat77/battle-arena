"use client";

// The lower half of the overview: recent wallet transactions (searchable via the
// API), the recent activity feed and the players card (registered vs guests).

import Link from "next/link";
import { Button, ButtonLink } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { CopyButton } from "@/components/admin/CopyButton";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { EmptyState } from "@/components/admin/EmptyState";
import { Icon, type IconName } from "@/components/admin/icons";
import { Money } from "@/components/admin/Money";
import { PlayerCell } from "@/components/admin/PlayerCell";
import { SearchInput } from "@/components/admin/SearchInput";
import { Skeleton } from "@/components/admin/Skeleton";
import { StatusPill } from "@/components/admin/StatusPill";
import { TimeAgo } from "@/components/admin/TimeAgo";
import type { AdminQuery } from "@/lib/admin/api";
import { birr, num, shortId, type Book } from "@/lib/admin/format";
import { kindLabel, kindTone, playerSplit } from "@/lib/admin/overview";
import type { ActivityRow, Overview, Page, TxnPage, TxnRow } from "@/lib/admin/types";

export function TransactionsCard({
  query,
  book,
  q,
  onSearch,
}: {
  query: AdminQuery<TxnPage>;
  book: Book;
  q: string;
  onSearch(v: string): void;
}) {
  const { data, error, loading, reload } = query;
  const cols: Column<TxnRow>[] = [
    { key: "ts", header: "Time", phone: "secondary", cell: (t) => <TimeAgo ts={t.ts} mode="date" className="text-ink-2" /> },
    {
      key: "player",
      header: "Player",
      primary: true,
      cell: (t) => <PlayerCell id={t.profileId} name={t.name} username={t.username} />,
    },
    { key: "kind", header: "Kind", phone: "secondary", cell: (t) => <StatusPill tone={kindTone(t.kind)}>{kindLabel(t.kind)}</StatusPill> },
    { key: "amount", header: "Amount", align: "right", primary: true, cell: (t) => <Money santim={t.amount} book={book} signed unit={false} /> },
    { key: "balance", header: "Balance", align: "right", cell: (t) => <Money santim={t.balance} book={book} unit={false} className="text-ink-2" /> },
    {
      key: "ref",
      header: "Ref",
      phone: "secondary",
      cell: (t) =>
        t.ref ? (
          <CopyButton value={t.ref} label="Copy reference" className="whitespace-nowrap">
            {shortId(t.ref, 4, 4)}
          </CopyButton>
        ) : (
          <span className="text-ink-3">–</span>
        ),
    },
  ];
  return (
    <Card
      title="Recent transactions"
      info="The newest wallet movements in the current book: deposits, stakes, wins, fees and adjustments."
      bodyClassName=""
      actions={
        <>
          <SearchInput value={q} onChange={onSearch} label="Search transactions" placeholder="Player, @username or ref" className="w-full sm:w-[230px]" />
          <ButtonLink href="/admin/wallet" size="sm" variant="secondary" iconRight="chevronRight">
            View all
          </ButtonLink>
        </>
      }
    >
      <DataTable
        caption="Recent transactions"
        rows={data?.rows}
        loading={loading}
        error={error}
        onRetry={reload}
        columns={cols}
        rowKey={(t) => `${t.book}:${t.id}`}
        rowHref={(t) => (t.profileId === "platform" ? null : `/admin/players/${encodeURIComponent(t.profileId)}`)}
        skeletonRows={8}
        empty={
          q
            ? { title: "No transactions match", body: `Nothing found for "${q}". Try a name, @username or a reference.` }
            : { title: "No transactions yet", body: "Deposits, stakes and wins show up here as they happen." }
        }
      />
    </Card>
  );
}

const ICONS: Record<ActivityRow["type"], IconName> = {
  signup: "players",
  match: "matches",
  deposit: "deposits",
  withdrawal: "withdrawals",
  adjust: "wallet",
  tournament: "tournaments",
  admin: "shield",
};

function ActivityItem({ row }: { row: ActivityRow }) {
  const body = (
    <>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-line bg-sf-2 text-ink-2">
        <Icon name={ICONS[row.type]} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13px] leading-snug text-ink">{row.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-3">
          <TimeAgo ts={row.ts} />
          {row.amount != null && <span className="num text-ink-2">{birr(row.amount)}</span>}
        </span>
      </span>
    </>
  );
  const cls = "flex min-h-[52px] items-center gap-3 px-4 py-2";
  return row.link ? (
    <Link href={row.link} className={`${cls} transition-colors hover:bg-sf-2/70`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function ActivityCard({ query, className = "" }: { query: AdminQuery<Page<ActivityRow>>; className?: string }) {
  const { data, error, loading, reload } = query;
  return (
    <Card
      title="Recent activity"
      info="Sign-ups, finished matches, deposits, withdrawals, adjustments, tournaments and admin actions, newest first."
      bodyClassName="flex-1"
      className={`flex flex-col ${className}`}
      actions={
        <ButtonLink href="/admin/activity" size="sm" variant="ghost" iconRight="chevronRight">
          View all
        </ButtonLink>
      }
    >
      {error && !data ? (
        <EmptyState icon="alert" tone="error" title="Couldn't load activity" className="!py-8" action={<Button size="sm" icon="refresh" onClick={reload}>Try again</Button>}>
          {error.message}
        </EmptyState>
      ) : !data && loading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : data && data.rows.length === 0 ? (
        <EmptyState icon="activity" title="Nothing yet" className="!py-8">
          Activity appears here as people sign up and play.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line/70">
          {data?.rows.map((r) => (
            <li key={r.id}>
              <ActivityItem row={r} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PlayersCard({ totals }: { totals: Overview["totals"] | null }) {
  if (!totals) {
    return (
      <Card title="Players">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="mt-4 h-2 w-full" />
        <Skeleton className="mt-4 h-4 w-full" />
      </Card>
    );
  }
  const s = playerSplit(totals);
  const pct = Math.round(s.registeredShare * 100);
  return (
    <Card title="Players" info="Everyone with a profile. Registered players have a password; guests play without one.">
      <div className="flex items-baseline justify-between gap-3">
        <p className="num text-[26px] leading-none tracking-[-0.02em] text-ink">{num(s.total)}</p>
        <Link href="/admin/players" className="text-[12.5px] text-ink-2 underline-offset-2 hover:text-accent hover:underline">
          View players
        </Link>
      </div>
      <div
        role="img"
        aria-label={`${num(s.registered)} registered and ${num(s.guests)} guests`}
        className="mt-4 flex h-2 overflow-hidden rounded-full bg-sf-3"
      >
        <span className="h-full bg-accent" style={{ width: `${s.registeredShare * 100}%` }} />
        <span className="h-full bg-ink-3/70" style={{ width: s.total ? `${100 - s.registeredShare * 100}%` : 0 }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
        <div>
          <dt className="label flex items-center gap-1.5 !text-[10.5px]">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Registered
          </dt>
          <dd className="num mt-1 text-ink">
            {num(s.registered)} <span className="font-normal text-ink-3">{s.total ? `${pct}%` : ""}</span>
          </dd>
        </div>
        <div>
          <dt className="label flex items-center gap-1.5 !text-[10.5px]">
            <span className="h-1.5 w-1.5 rounded-full bg-ink-3" /> Guests
          </dt>
          <dd className="num mt-1 text-ink">
            {num(s.guests)} <span className="font-normal text-ink-3">{s.total ? `${100 - pct}%` : ""}</span>
          </dd>
        </div>
      </dl>
      <Link href="/admin/tournaments" className="mt-4 flex min-h-[44px] items-center justify-between border-t border-line pt-3 text-[13px] text-ink-2 hover:text-ink lg:min-h-0">
        <span className="label">Tournaments</span>
        <span className="num text-ink">{num(totals.tournaments)}</span>
      </Link>
    </Card>
  );
}
