"use client";

// The top of the wallet screen: the book's totals, the liabilities check (real
// money that came in from outside vs where it sits now), and the legacy report
// of real money from before the book split, with an Adjust button per player.

import { useState } from "react";
import { Button } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { EmptyState } from "@/components/admin/EmptyState";
import { Icon } from "@/components/admin/icons";
import { Money } from "@/components/admin/Money";
import { PlayerById } from "@/components/admin/PlayerById";
import { Skeleton } from "@/components/admin/Skeleton";
import { InfoTip } from "@/components/admin/Tooltip";
import type { AdminQuery } from "@/lib/admin/api";
import { dateShort, dateTime, num, type Book } from "@/lib/admin/format";
import { legacyRows, liabilities, type LegacyRow } from "@/lib/admin/money";
import type { TxnPage, WalletSummary } from "@/lib/admin/types";

function Stat({ label, info, children, sub, loading, muted }: { label: string; info?: React.ReactNode; children: React.ReactNode; sub?: React.ReactNode; loading: boolean; muted?: boolean }) {
  return (
    <section className={`flex min-w-0 flex-col rounded-[10px] border border-line bg-sf px-3.5 py-3.5 sm:px-4 ${muted ? "opacity-55" : ""}`}>
      <h3 className="label flex items-center gap-1.5">
        <span className="truncate">{label}</span>
        {info && <InfoTip label={`About ${label}`}>{info}</InfoTip>}
      </h3>
      {loading ? <Skeleton className="mt-3 h-7 w-28" /> : <div className="mt-2.5 min-w-0 truncate text-[21px] leading-none tracking-[-0.02em] sm:text-[24px]">{children}</div>}
      <div className="mt-2 min-h-[18px] truncate text-[12.5px] text-ink-3">{loading ? <Skeleton className="h-3 w-24" /> : sub}</div>
    </section>
  );
}

export function SummaryCards({ query, book }: { query: AdminQuery<WalletSummary>; book: Book }) {
  const { data, error, reload } = query;
  if (error && !data) {
    return (
      <Card className="mb-4">
        <EmptyState icon="alert" tone="error" title="Couldn't load the wallet summary" action={<Button size="sm" icon="refresh" onClick={reload}>Try again</Button>}>
          {error.message}
        </EmptyState>
      </Card>
    );
  }
  const s = data && data.book === book ? data : null;
  const loading = !s;
  const real = book === "real";
  const net = s ? s.deposits.amount - s.withdrawals.paid.amount : 0;
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:mb-5 lg:gap-4 xl:grid-cols-3 2xl:grid-cols-6">
      <Stat label="Player balances" loading={loading} info="Everything players hold in this book right now, the platform account left out." sub="What players can spend">
        {s && <Money santim={s.playerBalances} book={book} />}
      </Stat>
      <Stat label="Platform balance" loading={loading} info="Match fees collected and not yet taken out. Fees are taken out with a platform debit." sub="Fees not yet taken out">
        {s && <Money santim={s.platformBalance} book={book} />}
      </Stat>
      <Stat label="Held in escrow" loading={loading} info="Both stakes of every match that is being played right now. They go to the winner (minus the fee) or back to both players." sub={s ? `${num(s.heldEscrows)} ${s.heldEscrows === 1 ? "match" : "matches"} in play` : ""}>
        {s && <Money santim={s.heldInEscrow} book={book} />}
      </Stat>
      <Stat
        label="Net deposits"
        loading={loading}
        muted={!real}
        info="Credited deposits minus paid withdrawals: the real money players have put in and not taken out. Real money only."
        sub={real && s ? `${num(s.deposits.count)} in, ${num(s.withdrawals.paid.count)} paid out` : "Real money only"}
      >
        {s && (real ? <Money santim={net} book={book} /> : <span className="num text-ink-3">–</span>)}
      </Stat>
      <Stat
        label="Pending withdrawals"
        loading={loading}
        muted={!real}
        info="Payouts players asked for that moderators have not paid yet. The money has already left their balance."
        sub={real && s ? `${num(s.withdrawals.pending.count)} waiting in Telegram` : "Real money only"}
      >
        {s && (real ? <Money santim={s.withdrawals.pending.amount} book={book} /> : <span className="num text-ink-3">–</span>)}
      </Stat>
      <Stat label="Adjustments" loading={loading} info="Manual credits and debits made by admins in this book, added up (debits count as minus)." sub={s ? `${num(s.adjustments.count)} made, net` : ""}>
        {s && <Money santim={s.adjustments.net} book={book} signed />}
      </Stat>
    </div>
  );
}

export function LiabilitiesLine({ summary, book }: { summary: WalletSummary | null; book: Book }) {
  if (!summary || summary.book !== book) return <Skeleton className="mb-4 h-12 w-full lg:mb-5" />;
  if (book !== "real") {
    return (
      <p className="mb-4 flex items-center gap-2 rounded-[10px] border border-line bg-sf px-4 py-3 text-[13px] text-ink-3 lg:mb-5">
        <Icon name="info" size={16} /> The liabilities check is for real money; play money is created by the faucet, so it has nothing to check against.
      </p>
    );
  }
  const l = liabilities(summary);
  const ok = l.difference === 0;
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border px-4 py-3 text-[13px] lg:mb-5 ${ok ? "border-line bg-sf" : "border-pending/50 bg-pending/10"}`}>
      <span className="flex items-center gap-1.5">
        <span className="label">Liabilities check</span>
        <InfoTip label="About the liabilities check">
          <span className="block">Money that came in from outside (credited deposits, minus paid withdrawals, plus admin adjustments) should equal where it sits now: player balances, the platform&apos;s fees, stakes held in escrow, and withdrawals waiting to be paid.</span>
          <span className="mt-1.5 block">A difference means money moved without a matching record. Run reconcile to see which balances differ from the log.</span>
        </InfoTip>
      </span>
      <span className="text-ink-2">
        Came in <Money santim={l.cameIn} className="!text-ink" />
      </span>
      <span className="text-ink-2">
        Held now <Money santim={l.heldNow} className="!text-ink" />
      </span>
      <span className={`ml-auto inline-flex items-center gap-1.5 font-medium ${ok ? "text-recorded" : "text-pending"}`}>
        <Icon name={ok ? "check" : "alert"} size={16} />
        {ok ? "Matches" : <>Off by <Money santim={l.difference} signed className="!text-pending" /></>}
      </span>
    </div>
  );
}

export function LegacyCard({ report, adjusts, onAdjust }: { report: unknown; adjusts: TxnPage | null; onAdjust(row: LegacyRow): void }) {
  const [open, setOpen] = useState(true);
  const { migratedAt, rows } = legacyRows(report);
  if (rows.length === 0) return null;
  // An adjust whose note mentions "legacy" counts as handled for that player.
  const handled = new Map<string, number>();
  for (const t of adjusts?.rows ?? []) if (t.note && /legacy/i.test(t.note) && !handled.has(t.profileId)) handled.set(t.profileId, t.ts);
  return (
    <section className="mb-4 rounded-[10px] border border-pending/50 bg-pending/[0.06] lg:mb-5">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-[48px] w-full items-center gap-3 px-4 py-2.5 text-left">
        <Icon name="alert" size={18} className="text-pending" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-ink">Legacy balances to credit manually</span>
          <span className="block text-[12.5px] text-ink-2">
            {num(rows.length)} {rows.length === 1 ? "player" : "players"} had real deposits in the old shared book{migratedAt ? ` (split on ${dateShort(migratedAt, true)})` : ""}. Their money went to play money; credit the real part back by hand.
          </span>
        </span>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={18} className="text-ink-3" />
      </button>
      {open && (
        <ul className="divide-y divide-line border-t border-pending/30">
          {rows.map((r) => {
            const done = handled.get(r.profileId);
            return (
              <li key={r.profileId} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
                <div className="min-w-0 md:w-[240px]">
                  <PlayerById id={r.profileId} />
                </div>
                <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-4">
                  <div>
                    <dt className="text-ink-3">Deposited</dt>
                    <dd><Money santim={r.deposited} unit={false} /></dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Withdrawn</dt>
                    <dd><Money santim={r.withdrawn} unit={false} /></dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Refunded</dt>
                    <dd><Money santim={r.refunded} unit={false} /></dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Old balance</dt>
                    <dd><Money santim={r.balance} unit={false} className="!text-ink-2" /></dd>
                  </div>
                </dl>
                <div className="flex items-center gap-3 md:flex-none">
                  <div className="text-right">
                    <p className="text-[11.5px] text-ink-3">Real money in</p>
                    <Money santim={r.netIn} className="text-[14px]" />
                  </div>
                  {done ? (
                    <span className="inline-flex h-8 items-center gap-1 rounded-full border border-recorded/40 px-2.5 text-[12px] font-medium text-recorded" title={`Adjusted ${dateTime(done)}`}>
                      <Icon name="check" size={14} /> Adjusted {dateShort(done)}
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" icon="wallet" onClick={() => onAdjust(r)} disabled={r.netIn <= 0}>
                      Adjust
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
