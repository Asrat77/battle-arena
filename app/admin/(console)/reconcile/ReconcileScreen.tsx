"use client";

// Reconcile and fees. Reconcile replays the hash-chained wallet log and compares
// what each account should hold with what is stored, and checks every escrow's
// money adds up; it runs on load and on "Run reconcile". The fee card shows the
// platform account: balance, collected, fees per UTC day for 30 days, and what was
// taken out ("Take fees out" opens the adjustment dialog as a platform debit).

import { useEffect, useMemo, useState } from "react";
import { AdjustDialog } from "@/components/admin/AdjustDialog";
import { Button } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { ThinBars } from "@/components/admin/charts/ThinBars";
import { CopyButton } from "@/components/admin/CopyButton";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { EmptyState } from "@/components/admin/EmptyState";
import { Icon } from "@/components/admin/icons";
import { Money } from "@/components/admin/Money";
import { PageHeader } from "@/components/admin/PageHeader";
import { PlayerById } from "@/components/admin/PlayerById";
import { Skeleton } from "@/components/admin/Skeleton";
import { StatusPill } from "@/components/admin/StatusPill";
import { TimeAgo } from "@/components/admin/TimeAgo";
import { useAdminQuery } from "@/lib/admin/api";
import { birr, dateTime, dayLabel, fullDate, num, shortId, unitFor, type Book } from "@/lib/admin/format";
import { feeDays, reconcileSummary, type ReconcileEscrowProblem, type ReconcileMismatch } from "@/lib/admin/money";
import { useAdminPrefs } from "@/lib/admin/prefs";
import type { FeeReport, Reconcile } from "@/lib/admin/types";

const dash = <span className="text-ink-3">–</span>;

function AllGood({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 px-4 pb-4 pt-2 text-[13px] text-ink-2">
      <Icon name="check" size={15} className="text-recorded" />
      {children}
    </p>
  );
}

function BookResult({ b }: { b: Reconcile["books"][number] }) {
  const mismatchCols: Column<ReconcileMismatch>[] = [
    { key: "player", header: "Account", primary: true, cell: (m) => <PlayerById id={m.profileId} size="sm" /> },
    { key: "stored", header: "Stored", align: "right", phone: "secondary", phoneLabel: "stored", cell: (m) => <Money santim={m.stored} book={b.book} unit={false} /> },
    { key: "logged", header: "Logged", align: "right", phone: "secondary", phoneLabel: "logged", cell: (m) => <Money santim={m.logged} book={b.book} unit={false} /> },
    { key: "diff", header: "Difference", align: "right", primary: true, cell: (m) => <Money santim={m.stored - m.logged} book={b.book} signed unit={false} /> },
  ];
  const escrowCols: Column<ReconcileEscrowProblem>[] = [
    {
      key: "id",
      header: "Escrow",
      primary: true,
      cell: (e) => (
        <CopyButton value={e.id} label="Copy escrow id">
          {shortId(e.id, 8, 4)}
        </CopyButton>
      ),
    },
    { key: "status", header: "Status", phone: "secondary", cell: (e) => <StatusPill status={e.status} /> },
    { key: "off", header: "Off by", align: "right", primary: true, cell: (e) => <Money santim={e.off} book={b.book} signed unit={false} /> },
  ];
  return (
    <section className="rounded-lg border border-line bg-bg/60">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
        <h3 className="text-[14px] font-semibold text-ink">{b.book === "real" ? "Real money" : "Play money"}</h3>
        <StatusPill tone={b.ok ? "success" : "rejected"}>{b.ok ? "OK" : "Problems"}</StatusPill>
        <dl className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
          <div className="flex gap-1.5">
            <dt className="text-ink-3">Txns replayed</dt>
            <dd className="num text-ink">{num(b.txns)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-ink-3">Total balances</dt>
            <dd><Money santim={b.total} book={b.book} /></dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-ink-3">Held</dt>
            <dd><Money santim={b.held} book={b.book} /></dd>
          </div>
        </dl>
      </header>
      <div className="grid gap-px bg-line lg:grid-cols-2">
        <div className="bg-sf">
          <p className="label px-4 pb-1 pt-3">Balance mismatches</p>
          {b.mismatches.length ? (
            <DataTable caption={`${b.book} balance mismatches`} rows={b.mismatches} columns={mismatchCols} rowKey={(m) => m.profileId} />
          ) : (
            <AllGood>Every stored balance matches the log.</AllGood>
          )}
        </div>
        <div className="bg-sf">
          <p className="label px-4 pb-1 pt-3">Escrow problems</p>
          {b.escrows.length ? <DataTable caption={`${b.book} escrow problems`} rows={b.escrows} columns={escrowCols} rowKey={(e) => e.id} /> : <AllGood>Every escrow&apos;s money adds up.</AllGood>}
        </div>
      </div>
    </section>
  );
}

function ReconcileCard() {
  const r = useAdminQuery<Reconcile>("wallet/reconcile");
  const [ranAt, setRanAt] = useState<number | null>(null);
  useEffect(() => {
    if (r.data) setRanAt(Date.now());
  }, [r.data]);
  const s = r.data ? reconcileSummary(r.data) : null;
  const running = r.loading;
  return (
    <Card
      className="mb-4 lg:mb-5"
      title="Reconcile"
      info="Reconcile replays every transaction in the hash-chained wallet log, works out what each account should hold, and compares that with the balances the app has stored. It also checks that every escrow paid out exactly what it took in."
      actions={
        <>
          {ranAt && (
            <span className="text-[12px] text-ink-3" title={fullDate(ranAt)}>
              Ran {dateTime(ranAt)}
            </span>
          )}
          <Button size="sm" variant="primary" icon="refresh" onClick={r.reload} loading={running}>
            Run reconcile
          </Button>
        </>
      }
    >
      <p className="mb-4 text-[13px] text-ink-2">It compares the balances the app stores with the ones the append-only log says they should be, for both books.</p>
      {r.error && !r.data ? (
        <EmptyState icon="alert" tone="error" title="Couldn't run reconcile" action={<Button size="sm" icon="refresh" onClick={r.reload}>Try again</Button>}>
          {r.error.message}
        </EmptyState>
      ) : !r.data || !s ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className={`space-y-4 transition-opacity ${running ? "opacity-60" : ""}`} aria-busy={running || undefined}>
          <div role="status" className={`flex flex-wrap items-center gap-4 rounded-lg border px-4 py-4 ${s.ok ? "border-recorded/40 bg-recorded/10" : "border-mismatch/50 bg-mismatch-soft"}`}>
            <div className="flex min-w-0 basis-full items-start gap-4 sm:basis-auto sm:flex-1 sm:items-center">
            <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-full ${s.ok ? "bg-recorded/20 text-recorded" : "bg-mismatch/20 text-mismatch"}`}>
              <Icon name={s.ok ? "shield" : "alert"} size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[20px] font-semibold tracking-[-0.01em] ${s.ok ? "text-recorded" : "text-mismatch"}`}>{s.headline}</p>
              {s.problems.length ? (
                <ul className="mt-1 list-disc pl-4 text-[13px] text-ink">
                  {s.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 text-[13px] text-ink-2">Every balance matches the log and every escrow adds up.</p>
              )}
            </div>
            </div>
            <dl className="flex gap-6 pl-[60px] text-[12.5px] sm:pl-0">
              <div>
                <dt className="text-ink-3">Log entries</dt>
                <dd className="num text-[15px] text-ink">{num(r.data.entries)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Chain</dt>
                <dd className={`text-[14px] font-medium ${r.data.chain === "intact" ? "text-recorded" : "text-mismatch"}`}>{r.data.chain === "intact" ? "Intact" : `Broken at ${r.data.chain.at}`}</dd>
              </div>
            </dl>
          </div>
          {[...r.data.books].sort((a, b) => (a.book === "real" ? -1 : b.book === "real" ? 1 : 0)).map((b) => (
            <BookResult key={b.book} b={b} />
          ))}
        </div>
      )}
    </Card>
  );
}

function FeesCard({ book }: { book: Book }) {
  const q = useAdminQuery<FeeReport>("wallet/fees", { book });
  const [taking, setTaking] = useState(false);
  const data = q.data && q.data.book === book ? q.data : null;
  const days = useMemo(() => feeDays(data?.byDay, Date.now(), 30), [data]);
  const last30 = days.reduce((s, d) => s + d.fees, 0);
  const unit = unitFor(book);
  const takenOut = [...(data?.adjustments ?? [])].sort((a, b) => b.ts - a.ts);
  type Out = (typeof takenOut)[number];
  const cols: Column<Out>[] = [
    { key: "ts", header: "When", phone: "secondary", cell: (a) => <TimeAgo ts={a.ts} mode="date" className="whitespace-nowrap text-ink-2" /> },
    { key: "amount", header: "Amount", align: "right", primary: true, cell: (a) => <Money santim={a.amount} book={book} signed unit={false} /> },
    { key: "note", header: "Reason", primary: true, className: "md:max-w-[420px]", cell: (a) => (a.note ? <span className="line-clamp-2 text-[13px] text-ink" title={a.note}>{a.note}</span> : dash) },
    { key: "by", header: "By", phone: "secondary", cell: (a) => (a.by ? <span className="font-mono text-[12.5px] text-ink-2">{a.by}</span> : dash) },
  ];
  return (
    <Card
      title={`Platform fees · ${book === "real" ? "real" : "play"} money`}
      info="The platform account collects the fee of every staked match. Fees stay there until an admin takes them out with a platform debit, which is listed below."
      bodyClassName=""
      actions={
        <Button size="sm" variant="secondary" icon="minus" onClick={() => setTaking(true)} disabled={!data || data.balance <= 0}>
          Take fees out
        </Button>
      }
    >
      {q.error && !data ? (
        <EmptyState icon="alert" tone="error" title="Couldn't load the fee report" action={<Button size="sm" icon="refresh" onClick={q.reload}>Try again</Button>}>
          {q.error.message}
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-px border-b border-line bg-line sm:grid-cols-3">
            {[
              { label: "Fee balance now", value: data?.balance },
              { label: "Collected, all time", value: data?.collected },
              { label: "Last 30 days", value: data ? last30 : undefined },
            ].map((k) => (
              <div key={k.label} className="bg-sf px-4 py-3.5">
                <p className="label">{k.label}</p>
                {k.value === undefined ? <Skeleton className="mt-2.5 h-6 w-24" /> : <p className="mt-2"><Money santim={k.value} book={book} className="text-[20px]" /></p>}
              </div>
            ))}
          </div>
          <div className="px-4 py-4">
            <p className="mb-3 text-[12px] text-ink-3">Fees per day, last 30 days. Days are UTC (the fee report counts by UTC day), so a day starts at 03:00 in Addis Ababa.</p>
            {data ? (
              <ThinBars
                title={`Platform fees per UTC day, last 30 days (${unit})`}
                data={days.map((d) => ({ label: `${dayLabel(d.day)} UTC`, value: d.fees, note: `${num(d.matches)} ${d.matches === 1 ? "match" : "matches"}` }))}
                format={(v) => `${birr(v)} ${unit}`}
                height={180}
              />
            ) : (
              <Skeleton className="h-[180px] w-full" label="Loading fees" />
            )}
          </div>
          <div className="border-t border-line">
            <p className="label px-4 pb-1 pt-3">Fees taken out</p>
            <DataTable
              caption="Fees taken out"
              rows={data ? takenOut : undefined}
              loading={q.loading}
              columns={cols}
              rowKey={(a) => `${a.ts}:${a.amount}`}
              empty={{ title: "Nothing taken out yet", body: "Platform debits made with “Take fees out” are listed here with their reason." }}
            />
          </div>
        </>
      )}
      <AdjustDialog
        open={taking}
        preset={{ book, profileId: "platform", lockAccount: true, direction: "debit" }}
        onClose={() => setTaking(false)}
        onDone={() => {
          q.reload();
          window.setTimeout(q.reload, 5500);
        }}
      />
    </Card>
  );
}

export function ReconcileScreen() {
  const { book } = useAdminPrefs();
  return (
    <>
      <PageHeader title="Reconcile and fees" subtitle="Check the books against the wallet log, and see what the platform has earned." />
      <ReconcileCard />
      <FeesCard book={book} />
    </>
  );
}
