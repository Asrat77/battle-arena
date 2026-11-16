"use client";

// Deposits: tabs by status with counts (In review first when any), search, the
// list, and a drawer (?open=<id>) laid out for a decision on a deposit in review:
// payer name vs the receipt's sender, receiver, receipt time vs submitted time and
// why it went to review. Approve or Reject asks for a written reason; a 409 (already
// handled in Telegram, or real money off) is shown and the list reloads.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminSession } from "@/components/admin/AdminContext";
import { Button, ButtonLink } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { CopyButton } from "@/components/admin/CopyButton";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Drawer } from "@/components/admin/Drawer";
import { TextArea } from "@/components/admin/Field";
import { Icon } from "@/components/admin/icons";
import { Money } from "@/components/admin/Money";
import { ExportButton } from "@/components/admin/ExportButton";
import { PageHeader } from "@/components/admin/PageHeader";
import { PlayerCell } from "@/components/admin/PlayerCell";
import { SearchInput } from "@/components/admin/SearchInput";
import { Skeleton } from "@/components/admin/Skeleton";
import { StatusPill } from "@/components/admin/StatusPill";
import { Tabs } from "@/components/admin/Tabs";
import { TimeAgo } from "@/components/admin/TimeAgo";
import { AdminApiError, adminGet, adminPost, useAdminQuery } from "@/lib/admin/api";
import { birr, dateTime, duration, fullDate, num, shortId } from "@/lib/admin/format";
import {
  DEPOSIT_TABS,
  DEPOSIT_TAB_LABELS,
  LEDGER_PAGE_SIZE,
  NAME_MATCH_TEXT,
  RESOLVE_REASON_MAX,
  RESOLVE_REASON_MIN,
  nameMatch,
  pickTab,
  reasonError,
  type DepositTab,
  type NameMatch,
} from "@/lib/admin/money";
import { DEPOSIT_CSV_COLUMNS, exportFilename } from "@/lib/admin/exports";
import { bankLabel, collectAll, depositAmount } from "@/lib/admin/players";
import type { AdminDeposit, Page } from "@/lib/admin/types";

const dash = <span className="text-ink-3">–</span>;
type Notice = { tone: "ok" | "warn"; text: string } | null;

/** Row counts per status (one tiny request each), for the tabs. */
function useCounts(tick: number) {
  const [counts, setCounts] = useState<Partial<Record<DepositTab, number>>>({});
  useEffect(() => {
    const ctrl = new AbortController();
    for (const s of DEPOSIT_TABS) {
      adminGet<Page<AdminDeposit>>("deposits", { status: s === "all" ? null : s, limit: 1 }, ctrl.signal).then(
        (r) => setCounts((c) => ({ ...c, [s]: r.total })),
        () => undefined,
      );
    }
    return () => ctrl.abort();
  }, [tick]);
  return counts;
}

function NameCheck({ match }: { match: NameMatch }) {
  const cls =
    match === "same"
      ? "border-recorded/40 text-recorded"
      : match === "partial"
        ? "border-pending/50 text-pending"
        : match === "different"
          ? "border-mismatch/50 text-mismatch"
          : "border-line text-ink-3";
  return (
    <span className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[12px] font-medium ${cls}`}>
      <Icon name={match === "same" ? "check" : match === "unknown" ? "info" : "alert"} size={13} />
      {NAME_MATCH_TEXT[match]}
    </span>
  );
}

function Fact({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="label !text-[10.5px]">{label}</dt>
      <dd className="mt-1 break-words text-[13.5px] text-ink">{children}</dd>
    </div>
  );
}

function DepositDrawer({ d, loading, onClose, onDecide }: { d: AdminDeposit | null; loading: boolean; onClose(): void; onDecide(approve: boolean): void }) {
  const review = d?.status === "review";
  const a = d ? depositAmount(d) : null;
  const match = d ? nameMatch(d.payerName, d.senderName) : "unknown";
  const gap = d?.paidAt ? d.createdAt - d.paidAt : null;
  return (
    <Drawer
      open
      width="lg"
      onClose={onClose}
      title={d ? (review ? "Deposit to review" : "Deposit") : "Deposit"}
      subtitle={d ? <span className="font-mono">{d.reference}</span> : null}
      footer={
        review ? (
          <>
            <Button variant="danger" icon="close" onClick={() => onDecide(false)}>
              Reject
            </Button>
            <Button variant="primary" icon="check" onClick={() => onDecide(true)}>
              Approve
            </Button>
          </>
        ) : undefined
      }
    >
      {!d ? (
        loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <p className="text-[13.5px] text-ink-2">This deposit could not be found. It may have been mistyped in the link.</p>
        )
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PlayerCell id={d.player.id} name={d.player.name} username={d.player.username} />
            <div className="text-right">
              {a?.amount != null ? <Money santim={a.amount} className="text-[22px]" /> : dash}
              <div className="mt-1 flex items-center justify-end gap-2">
                <StatusPill status={d.status} />
                <span className="text-[12.5px] text-ink-3">{bankLabel(d.bank)}</span>
              </div>
            </div>
          </div>

          {review && d.reviewWhy && (
            <div role="note" className="flex gap-2.5 rounded-lg border border-pending/50 bg-pending/10 px-3 py-2.5 text-[13px] text-ink">
              <Icon name="alert" size={16} className="mt-0.5 text-pending" />
              <div className="min-w-0">
                <p className="label !text-[10.5px] !text-pending">Why it needs a person</p>
                <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{d.reviewWhy}</p>
              </div>
            </div>
          )}

          <section className="rounded-lg border border-line bg-bg/60 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="label">Who paid</h3>
              <NameCheck match={match} />
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="Payer name (from the player)">{d.payerName || dash}</Fact>
              <Fact label="Sender on the receipt">{d.senderName || dash}</Fact>
              <Fact label="Receiver on the receipt" className="sm:col-span-2">
                {d.receiverName || dash}
              </Fact>
            </dl>
            <p className="mt-2.5 text-[12px] text-ink-3">The name check compares words, ignoring case and order. It is a visual aid: read both names yourself.</p>
          </section>

          <section className="rounded-lg border border-line bg-bg/60 p-3">
            <h3 className="label mb-3">When</h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="Paid (receipt time)">{d.paidAt ? <span title={fullDate(d.paidAt)}>{dateTime(d.paidAt)}</span> : dash}</Fact>
              <Fact label="Submitted">
                <span title={fullDate(d.createdAt)}>{dateTime(d.createdAt)}</span>
                {gap !== null && <span className="ml-1.5 text-[12px] text-ink-3">{gap >= 0 ? `${duration(gap)} after paying` : `${duration(-gap)} before the receipt time`}</span>}
              </Fact>
              <Fact label="Reference">
                <CopyButton value={d.reference} label="Copy reference" className="-ml-1">
                  {d.reference}
                </CopyButton>
              </Fact>
              <Fact label="Closed">{d.closedAt ? `${dateTime(d.closedAt)}${d.closedBy ? ` by ${d.closedBy}` : ""}` : dash}</Fact>
              {d.reason && (
                <Fact label="Result shown to the player" className="sm:col-span-2">
                  {d.reason}
                </Fact>
              )}
            </dl>
          </section>

          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/admin/players/${encodeURIComponent(d.profileId)}`} size="sm" variant="secondary" iconRight="chevronRight">
              Player page
            </ButtonLink>
            <ButtonLink href={`/admin/deposits?tab=all&q=${encodeURIComponent(d.profileId)}`} size="sm" variant="secondary" iconRight="chevronRight">
              Their other deposits
            </ButtonLink>
          </div>
        </div>
      )}
    </Drawer>
  );
}

export function DepositsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { refreshCounts } = useAdminSession();
  const [tick, setTick] = useState(0);
  const counts = useCounts(tick);
  const tab = pickTab(params.get("tab"), DEPOSIT_TABS, "review", counts.review ?? null);
  const q = (params.get("q") ?? "").trim();
  const pageRaw = Number.parseInt(params.get("page") ?? "", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? pageRaw - 1 : 0;
  const openId = (params.get("open") ?? "").trim();

  const setParams = useCallback(
    (changes: Record<string, string | null>, push = false) => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!("page" in changes) && !("open" in changes)) next.delete("page");
      const s = next.toString();
      const url = s ? `${pathname}?${s}` : pathname;
      if (push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [router, pathname],
  );

  const list = useAdminQuery<Page<AdminDeposit>>("deposits", { status: tab === "all" ? null : tab, q, page, limit: LEDGER_PAGE_SIZE });

  // The drawer's deposit: from the page, or looked up by id for a link from elsewhere.
  const fromPage = openId ? list.data?.rows.find((r) => r.id === openId) : undefined;
  const lookup = useAdminQuery<Page<AdminDeposit>>(openId && !fromPage && !list.loading ? "deposits" : null, { q: openId, limit: 5 });
  const [fresh, setFresh] = useState<AdminDeposit | null>(null);
  const drawerRow = (fresh && fresh.id === openId ? fresh : null) ?? fromPage ?? lookup.data?.rows.find((r) => r.id === openId) ?? null;

  const [decide, setDecide] = useState<{ d: AdminDeposit; approve: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  const reloadAll = () => {
    list.reload();
    lookup.reload();
    setTick((t) => t + 1);
    refreshCounts();
  };

  const resolve = async () => {
    if (!decide) return;
    const { d, approve } = decide;
    try {
      const updated = await adminPost<AdminDeposit>(`deposits/${encodeURIComponent(d.id)}/resolve`, { approve, reason: reason.trim() });
      setFresh(updated);
      setDecide(null);
      const amount = depositAmount(d).amount;
      setNotice({
        tone: "ok",
        text: approve
          ? `Approved: ${birr(amount)} ETB credited to ${d.player.name ?? "the player"} (now ${updated.status}).`
          : `Rejected deposit ${d.reference} of ${d.player.name ?? "the player"}. They can't claim this reference again.`,
      });
      reloadAll();
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 409) {
        setDecide(null);
        setNotice({ tone: "warn", text: `Not changed: ${err.message}. The list has been reloaded.` });
        setFresh(null);
        reloadAll();
        return;
      }
      throw err;
    }
  };

  const columns = useMemo<Column<AdminDeposit>[]>(
    () => [
      { key: "time", header: "Time", phone: "secondary", cell: (d) => <TimeAgo ts={d.createdAt} mode="date" className="whitespace-nowrap text-ink-2" /> },
      { key: "player", header: "Player", primary: true, cell: (d) => <PlayerCell id={d.player.id} name={d.player.name} username={d.player.username} /> },
      {
        key: "ref",
        header: "Bank / reference",
        phone: "secondary",
        cell: (d) => (
          <div className="flex flex-col items-start leading-tight">
            <span className="hidden text-[13px] text-ink md:block">{bankLabel(d.bank)}</span>
            <CopyButton value={d.reference} label="Copy reference" className="-ml-1 whitespace-nowrap">
              {shortId(d.reference, 8, 4)}
            </CopyButton>
          </div>
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
      { key: "payer", header: "Payer name", cell: (d) => <span className="whitespace-nowrap">{d.payerName || dash}</span> },
      {
        key: "sender",
        header: "Receipt: sender / receiver",
        cell: (d) => (
          <div className="leading-tight">
            {d.senderName ? (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {d.senderName}
                {nameMatch(d.payerName, d.senderName) === "different" && <Icon name="alert" size={14} label="Differs from the payer name" className="text-mismatch" />}
              </span>
            ) : (
              dash
            )}
            {d.receiverName && <div className="max-w-[200px] truncate text-[12px] text-ink-3">to {d.receiverName}</div>}
          </div>
        ),
      },
      { key: "paid", header: "Paid at", cell: (d) => (d.paidAt ? <span className="whitespace-nowrap text-ink-2" title={fullDate(d.paidAt)}>{dateTime(d.paidAt)}</span> : dash) },
      {
        key: "closed",
        header: "Closed",
        cell: (d) =>
          d.closedAt ? (
            <div className="leading-tight">
              <TimeAgo ts={d.closedAt} mode="date" className="whitespace-nowrap text-ink-2" />
              {d.closedBy && <div className="max-w-[180px] truncate text-[12px] text-ink-3">by {d.closedBy}</div>}
            </div>
          ) : (
            dash
          ),
      },
    ],
    [],
  );

  const reasonErr = reasonError(reason, RESOLVE_REASON_MIN, RESOLVE_REASON_MAX);
  const dAmount = decide ? depositAmount(decide.d).amount : null;
  const empty =
    tab === "review"
      ? { title: q ? "No deposits in review match" : "Nothing to review", body: q ? "Try another search." : "Deposits that verify.et can't settle on its own wait here." }
      : { title: q ? "No deposits match" : `No ${tab === "all" ? "" : DEPOSIT_TAB_LABELS[tab].toLowerCase() + " "}deposits`, body: q ? "Search by reference, payer or sender name, player or deposit id." : "Deposits show up here as players submit receipts." };

  return (
    <>
      <PageHeader
        title="Deposits"
        subtitle={counts.review ? `${num(counts.review)} waiting for a decision.` : "Receipts players submitted, checked by verify.et."}
        actions={
          <ExportButton<AdminDeposit>
            filename={exportFilename("deposits", [tab === "all" ? null : tab, q ? "search" : null])}
            columns={DEPOSIT_CSV_COLUMNS}
            disabled={!list.data || list.data.total === 0}
            load={(onProgress, isCancelled) =>
              collectAll<AdminDeposit>((p, limit) => adminGet<Page<AdminDeposit>>("deposits", { status: tab === "all" ? null : tab, q, page: p, limit }), { onProgress, isCancelled })
            }
          />
        }
      />

      <p className="mb-4 flex items-start gap-2 rounded-[10px] border border-line bg-sf px-4 py-3 text-[13px] text-ink-2">
        <Icon name="info" size={16} className="mt-0.5 flex-none text-ink-3" />
        Deposits in review can also be handled in the Telegram moderators&apos; chat. Whichever happens first wins; the other side then shows it as closed.
      </p>

      {notice && (
        <div
          role="status"
          className={`mb-4 flex items-start gap-2 rounded-[10px] border px-4 py-3 text-[13.5px] ${notice.tone === "ok" ? "border-recorded/40 bg-recorded/10 text-ink" : "border-pending/50 bg-pending/10 text-ink"}`}
        >
          <Icon name={notice.tone === "ok" ? "check" : "alert"} size={16} className={`mt-0.5 flex-none ${notice.tone === "ok" ? "text-recorded" : "text-pending"}`} />
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="-my-1 -mr-1 flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:text-ink">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <Tabs<DepositTab>
        label="Deposit status"
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        items={DEPOSIT_TABS.map((t) => ({ value: t, label: DEPOSIT_TAB_LABELS[t], count: counts[t] ?? null }))}
        className="mb-4"
      />

      <Card
        bodyClassName=""
        title={
          <span className="flex items-center gap-2">
            {DEPOSIT_TAB_LABELS[tab]} {list.data && <span className="num text-ink-3">{num(list.data.total)}</span>}
          </span>
        }
        actions={<SearchInput value={q} onChange={(v) => setParams({ q: v || null })} label="Search deposits" placeholder="Reference, name, player or id" className="w-full sm:w-[260px]" />}
      >
        <DataTable
          caption="Deposits"
          rows={list.data?.rows}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          columns={columns}
          rowKey={(d) => d.id}
          onRowClick={(d) => {
            setFresh(null);
            setParams({ open: d.id }, true);
          }}
          skeletonRows={8}
          empty={empty}
          pager={list.data ? { page, pageSize: LEDGER_PAGE_SIZE, total: list.data.total, onPage: (n) => setParams({ page: n > 0 ? String(n + 1) : null }) } : undefined}
        />
      </Card>

      {openId && (
        <DepositDrawer
          d={drawerRow}
          loading={list.loading || lookup.loading}
          onClose={() => setParams({ open: null })}
          onDecide={(approve) => {
            if (!drawerRow) return;
            setReason("");
            setDecide({ d: drawerRow, approve });
          }}
        />
      )}

      <ConfirmDialog
        open={decide !== null}
        tone={decide?.approve ? "primary" : "danger"}
        title={decide ? (decide.approve ? `Credit ${birr(dAmount)} ETB to ${decide.d.player.name ?? "this player"}?` : "Reject this deposit?") : ""}
        confirmLabel={decide?.approve ? `Credit ${birr(dAmount)} ETB` : "Reject deposit"}
        confirmDisabled={Boolean(reasonErr)}
        onConfirm={resolve}
        onClose={() => setDecide(null)}
      >
        {decide && (
          <div className="space-y-3">
            <p>
              {decide.approve
                ? "The amount goes into the player's real balance at once and the deposit is closed as credited."
                : "The deposit is closed as rejected. The player can't claim this reference again; nothing is credited."}
            </p>
            <dl className="rounded-lg border border-line bg-bg/60 px-3 py-1 text-[13px]">
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-ink-3">Amount</dt>
                <dd>{dAmount != null ? <Money santim={dAmount} /> : "–"}</dd>
              </div>
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-ink-3">Player</dt>
                <dd className="truncate text-ink">
                  {decide.d.player.name ?? "Unknown"} {decide.d.player.username && <span className="font-mono text-ink-3">@{decide.d.player.username}</span>}
                </dd>
              </div>
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-ink-3">Reference</dt>
                <dd className="truncate font-mono text-ink">{decide.d.reference}</dd>
              </div>
            </dl>
            <TextArea
              label="Reason (kept in the audit log)"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={RESOLVE_REASON_MAX + 20}
              hint={`${reason.trim().length}/${RESOLVE_REASON_MAX} · at least ${RESOLVE_REASON_MIN} characters, e.g. "Names match on the receipt, amount checked".`}
              error={reason.trim().length > 0 && reasonErr ? reasonErr : null}
            />
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
