"use client";

// The wallet screen's tables: transactions (from the hash-chained log, with
// filters kept in the URL and a CSV export of the whole filtered set), the same
// list preset to adjustments, and the escrows of staked matches.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { CopyButton } from "@/components/admin/CopyButton";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { controlClass } from "@/components/admin/Field";
import { FilterChips } from "@/components/admin/FilterChips";
import { Icon } from "@/components/admin/icons";
import { Money } from "@/components/admin/Money";
import { PlayerCell } from "@/components/admin/PlayerCell";
import { SearchInput } from "@/components/admin/SearchInput";
import { StatusPill } from "@/components/admin/StatusPill";
import { TimeAgo } from "@/components/admin/TimeAgo";
import { Tooltip } from "@/components/admin/Tooltip";
import { adminGet, type AdminQuery } from "@/lib/admin/api";
import { downloadCsv } from "@/lib/admin/csv";
import { num, shortId, type Book } from "@/lib/admin/format";
import {
  ESCROW_FILTERS,
  LEDGER_PAGE_SIZE,
  TXN_CSV_COLUMNS,
  TXN_KINDS,
  addisToday,
  ledgerFilename,
  ledgerFiltered,
  type EscrowFilter,
  type LedgerParams,
} from "@/lib/admin/money";
import { kindLabel, kindTone } from "@/lib/admin/overview";
import { collectAll } from "@/lib/admin/players";
import type { EscrowRow, Page, TxnPage, TxnRow, UserRow } from "@/lib/admin/types";

const dash = <span className="text-ink-3">–</span>;

type SetParams = (changes: Record<string, string | null>) => void;

function SourceBadge({ source }: { source: "log" | "store" | undefined }) {
  if (!source) return null;
  const log = source === "log";
  return (
    <Tooltip
      content={
        log
          ? "Every row comes from the append-only wallet log, where each entry carries the hash of the one before it. New rows can take up to 5 seconds to show."
          : "The log has no transactions for this book yet, so these rows come from the stored history (game rows are trimmed per player)."
      }
    >
      <span tabIndex={0} className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium ${log ? "border-recorded/40 text-recorded" : "border-pending/50 text-pending"}`}>
        <Icon name={log ? "shield" : "layers"} size={13} />
        {log ? "From the hash-chained log" : "From stored history"}
      </span>
    </Tooltip>
  );
}

/** "@username" (or "Platform") for the player filter chip. */
function useAccountLabel(id: string): string {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    setLabel(null);
    if (!id || id === "platform") return;
    const ctrl = new AbortController();
    adminGet<Page<UserRow>>("users", { q: id, limit: 5 }, ctrl.signal).then(
      (r) => {
        const u = r.rows.find((x) => x.id === id);
        if (u && !ctrl.signal.aborted) setLabel(`@${u.username}`);
      },
      () => undefined,
    );
    return () => ctrl.abort();
  }, [id]);
  if (id === "platform") return "Platform";
  return label ?? shortId(id, 8, 4);
}

function AccountChip({ id, onRemove }: { id: string; onRemove(): void }) {
  const label = useAccountLabel(id);
  return (
    <span className="inline-flex h-9 flex-none items-center gap-1 rounded-full border border-accent/60 bg-accent/10 pl-3 pr-1 text-[13px] font-medium text-accent lg:h-8">
      {id === "platform" ? (
        <span>{label}</span>
      ) : (
        <Link href={`/admin/players/${encodeURIComponent(id)}`} className="font-mono hover:underline">
          {label}
        </Link>
      )}
      <button type="button" aria-label={`Remove account filter ${label}`} onClick={onRemove} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-accent/20 lg:h-6 lg:w-6">
        <Icon name="close" size={14} />
      </button>
    </span>
  );
}

function DateField({ label, value, onChange, min, max }: { label: string; value: string; onChange(v: string): void; min?: string; max?: string }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
      <span className="label !text-[10.5px]">{label}</span>
      <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} className={`${controlClass} h-11 sm:w-[150px] lg:h-9 lg:text-[13px] [color-scheme:dark]`} />
    </label>
  );
}

function txnColumns(book: Book, adjustments: boolean): Column<TxnRow>[] {
  const note: Column<TxnRow> = {
    key: "note",
    header: adjustments ? "Reason / by" : "Note / by",
    phone: adjustments ? "secondary" : undefined,
    className: adjustments ? "md:min-w-[280px] md:max-w-[420px]" : "md:max-w-[280px]",
    cell: (t) =>
      t.note || t.by ? (
        <div className="min-w-0 text-[13px] leading-snug">
          {t.note && (
            <p className={`${adjustments ? "" : "line-clamp-2"} text-ink`} title={t.note}>
              {t.note}
            </p>
          )}
          {t.by && <p className="font-mono text-[12px] text-ink-3">by {t.by}</p>}
        </div>
      ) : (
        dash
      ),
  };
  return [
    { key: "time", header: "Time", phone: "secondary", cell: (t) => <TimeAgo ts={t.ts} mode="date" className="whitespace-nowrap text-ink-2" /> },
    { key: "seq", header: "Seq", align: "right", cell: (t) => (t.seq == null ? dash : <span className="num font-normal text-ink-3">#{t.seq}</span>) },
    { key: "player", header: "Player", primary: true, cell: (t) => <PlayerCell id={t.profileId} name={t.name} username={t.username} /> },
    { key: "kind", header: "Kind", phone: adjustments ? undefined : "secondary", cell: (t) => <StatusPill tone={kindTone(t.kind)}>{kindLabel(t.kind)}</StatusPill> },
    { key: "amount", header: "Amount", align: "right", primary: true, cell: (t) => <Money santim={t.amount} book={book} signed unit={false} /> },
    { key: "balance", header: "Balance after", align: "right", phone: adjustments ? undefined : "secondary", phoneLabel: "after", cell: (t) => <Money santim={t.balance} book={book} unit={false} className="!text-ink-2" /> },
    {
      key: "ref",
      header: "Ref",
      cell: (t) =>
        t.ref ? (
          <CopyButton value={t.ref} label="Copy reference" className="whitespace-nowrap">
            {shortId(t.ref, 6, 4)}
          </CopyButton>
        ) : (
          <CopyButton value={t.id} label="Copy transaction id" className="whitespace-nowrap !text-ink-3">
            {shortId(t.id, 6, 4)}
          </CopyButton>
        ),
    },
    note,
  ];
}

export function TransactionsPanel({ p, book, query, setParams }: { p: LedgerParams; book: Book; query: AdminQuery<TxnPage> & { params: Record<string, string | number> }; setParams: SetParams }) {
  const { data, error, loading, reload } = query;
  const adjustments = p.tab === "adjustments";
  const columns = useMemo(() => txnColumns(book, adjustments), [book, adjustments]);
  const filtered = ledgerFiltered(p);

  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const exportCsv = async () => {
    setExportError(null);
    setExporting({ done: 0, total: data?.total ?? 0 });
    try {
      const rows = await collectAll<TxnRow>((page, limit) => adminGet<TxnPage>("wallet/transactions", { ...query.params, page, limit }), {
        onProgress: (done, total) => alive.current && setExporting({ done, total }),
        isCancelled: () => !alive.current,
      });
      if (alive.current) downloadCsv(ledgerFilename(p, book), rows, TXN_CSV_COLUMNS);
    } catch (e) {
      if (alive.current) setExportError(e instanceof Error ? e.message : "The export failed");
    } finally {
      if (alive.current) setExporting(null);
    }
  };

  const today = addisToday();
  return (
    <Card
      bodyClassName=""
      title={
        <span className="flex items-center gap-2">
          {adjustments ? "Adjustments" : filtered ? "Matching transactions" : "Transactions"}
          {data && <span className="num text-ink-3">{num(data.total)}</span>}
        </span>
      }
      actions={
        <>
          <SourceBadge source={data?.source} />
          {exporting && (
            <span role="status" className="num text-[12.5px] font-normal text-ink-2">
              {num(exporting.done)} of {num(exporting.total)}
            </span>
          )}
          <Button size="sm" icon="download" onClick={exportCsv} loading={Boolean(exporting)} disabled={!data || data.total === 0}>
            {exporting ? "Exporting" : "Export CSV"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <SearchInput value={p.q} onChange={(v) => setParams({ q: v || null })} label="Search transactions" placeholder="Player, @username, txn id or ref" className="sm:w-[280px]" />
          <div className="flex gap-3">
            <DateField label="From (Addis day)" value={p.from} max={p.to || today} onChange={(v) => setParams({ from: v || null })} />
            <DateField label="To" value={p.to} min={p.from || undefined} max={today} onChange={(v) => setParams({ to: v || null })} />
          </div>
          {p.profileId && <AccountChip id={p.profileId} onRemove={() => setParams({ profileId: null })} />}
          {filtered && (
            <Button size="sm" variant="ghost" icon="close" onClick={() => setParams({ q: null, from: null, to: null, profileId: null, kind: null })}>
              Clear filters
            </Button>
          )}
        </div>
        {!adjustments && (
          <div className="flex min-w-0 flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-2.5">
            <span className="label !text-[10.5px]" aria-hidden>
              Kind
            </span>
            <FilterChips<string>
              multiple
              label="Transaction kinds"
              value={p.kinds}
              onChange={(v) => setParams({ kind: v.length ? v.join(",") : null })}
              options={TXN_KINDS.filter((k) => book === "play" || k !== "faucet").map((k) => ({ value: k, label: kindLabel(k) }))}
            />
          </div>
        )}
      </div>
      {exportError && (
        <p role="alert" className="border-b border-line px-4 py-2 text-[13px] text-mismatch">
          Export failed: {exportError}
        </p>
      )}
      <DataTable
        caption={adjustments ? "Adjustments" : "Wallet transactions"}
        rows={data?.rows}
        loading={loading}
        error={error}
        onRetry={reload}
        columns={columns}
        rowKey={(t) => `${t.seq ?? "s"}:${t.id}`}
        skeletonRows={10}
        empty={
          adjustments
            ? { title: filtered ? "No adjustments match" : "No adjustments yet", body: filtered ? "Try another search or date range." : "Manual credits and debits made here are listed with their reason and who made them." }
            : { title: filtered ? "No transactions match" : "No transactions yet", body: filtered ? "Try another kind, date range or search." : "Deposits, stakes, wins, fees and adjustments are listed here." }
        }
        pager={data ? { page: p.page, pageSize: LEDGER_PAGE_SIZE, total: data.total, onPage: (n) => setParams({ page: n > 0 ? String(n + 1) : null }) } : undefined}
      />
    </Card>
  );
}

const ESCROW_LABELS: Record<EscrowFilter, string> = { all: "All", held: "Held", settled: "Settled", refunded: "Refunded" };

export function EscrowsPanel({ p, book, query, setParams }: { p: LedgerParams; book: Book; query: AdminQuery<Page<EscrowRow>>; setParams: SetParams }) {
  const { data, error, loading, reload } = query;
  const columns = useMemo<Column<EscrowRow>[]>(
    () => [
      { key: "created", header: "Created", phone: "secondary", cell: (e) => <TimeAgo ts={e.createdAt} mode="date" className="whitespace-nowrap text-ink-2" /> },
      {
        key: "players",
        header: "Players",
        primary: true,
        cell: (e) => (
          <ul className="space-y-1">
            {e.players.map((w, i) => (
              <li key={`${w.id}:${i}`} className="flex min-w-0 items-center gap-2">
                <PlayerCell id={w.id} name={w.name} username={w.username} size="sm" />
                {e.winner === i && (
                  <span className="inline-flex h-5 flex-none items-center rounded-full border border-recorded/40 px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-recorded">Winner</span>
                )}
              </li>
            ))}
          </ul>
        ),
      },
      { key: "stake", header: "Stake", align: "right", phone: "secondary", phoneLabel: "each", cell: (e) => <Money santim={e.stake} book={book} unit={false} /> },
      { key: "pot", header: "Pot", align: "right", cell: (e) => <Money santim={e.pot} book={book} unit={false} className="!text-ink-2" /> },
      { key: "prize", header: "Prize", align: "right", cell: (e) => (e.prize ? <Money santim={e.prize} book={book} unit={false} /> : dash) },
      { key: "fee", header: "Fee", align: "right", cell: (e) => (e.fee ? <Money santim={e.fee} book={book} unit={false} className="!text-ink-2" /> : dash) },
      { key: "status", header: "Status", primary: true, cell: (e) => <StatusPill status={e.status} /> },
      {
        key: "match",
        header: "Match",
        phone: "secondary",
        cell: (e) =>
          e.matchId ? (
            <Link href={`/admin/matches?open=${encodeURIComponent(e.matchId)}`} className="inline-flex items-center gap-1 font-mono text-[12.5px] text-ink-2 hover:text-accent">
              {shortId(e.matchId, 6, 4)}
              <Icon name="arrowUpRight" size={13} />
            </Link>
          ) : (
            <span className="text-[12.5px] text-ink-3">Never started</span>
          ),
      },
      { key: "closed", header: "Closed", cell: (e) => (e.closedAt ? <TimeAgo ts={e.closedAt} mode="date" className="whitespace-nowrap text-ink-2" /> : dash) },
    ],
    [book],
  );
  return (
    <Card
      bodyClassName=""
      title={
        <span className="flex items-center gap-2">
          Escrows {data && <span className="num text-ink-3">{num(data.total)}</span>}
        </span>
      }
      info="Each staked match holds both stakes here. A win pays the pot minus the fee to the winner; a draw or a match that never started refunds both."
    >
      <div className="border-b border-line px-4 py-3">
        <FilterChips<EscrowFilter> label="Escrow status" value={p.status} onChange={(v) => setParams({ status: v === "all" ? null : v })} options={ESCROW_FILTERS.map((s) => ({ value: s, label: ESCROW_LABELS[s] }))} />
      </div>
      <DataTable
        caption="Escrows"
        rows={data?.rows}
        loading={loading}
        error={error}
        onRetry={reload}
        columns={columns}
        rowKey={(e) => e.id}
        skeletonRows={8}
        empty={{ title: p.status === "all" ? "No staked matches yet" : `No ${ESCROW_LABELS[p.status].toLowerCase()} escrows`, body: "Escrows appear when two players stake on a match." }}
        pager={data ? { page: p.page, pageSize: LEDGER_PAGE_SIZE, total: data.total, onPage: (n) => setParams({ page: n > 0 ? String(n + 1) : null }) } : undefined}
      />
    </Card>
  );
}
