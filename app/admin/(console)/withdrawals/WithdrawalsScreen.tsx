"use client";

// Withdrawals, read only: payouts are made and confirmed by moderators in
// Telegram. Summary cards (pending with the oldest wait, paid today and in the
// last 7 days, the limits), tabs by status with counts, search, the list with
// waiting times on pending rows, and a drawer (?open=<id>) with every field and
// the player's withdrawable amount now.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ButtonLink } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { CopyButton } from "@/components/admin/CopyButton";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Drawer } from "@/components/admin/Drawer";
import { Icon } from "@/components/admin/icons";
import { Money } from "@/components/admin/Money";
import { PageHeader } from "@/components/admin/PageHeader";
import { PlayerCell } from "@/components/admin/PlayerCell";
import { SearchInput } from "@/components/admin/SearchInput";
import { Skeleton } from "@/components/admin/Skeleton";
import { StatusPill } from "@/components/admin/StatusPill";
import { Tabs } from "@/components/admin/Tabs";
import { TimeAgo, useNow } from "@/components/admin/TimeAgo";
import { InfoTip } from "@/components/admin/Tooltip";
import { adminGet, useAdminQuery } from "@/lib/admin/api";
import { birr, dateTime, duration, fullDate, num, shortId } from "@/lib/admin/format";
import { LEDGER_PAGE_SIZE, WITHDRAWAL_TABS, WITHDRAWAL_TAB_LABELS, oldest, pickTab, waitBucket, type WithdrawalTab } from "@/lib/admin/money";
import { bankLabel } from "@/lib/admin/players";
import type { AdminWithdrawal, Overview, Page, UserDetail, WalletSummary } from "@/lib/admin/types";
import { Flags } from "../players/[id]/PlayerPanels";

const dash = <span className="text-ink-3">–</span>;

function useCounts() {
  const [counts, setCounts] = useState<Partial<Record<WithdrawalTab, number>>>({});
  useEffect(() => {
    const ctrl = new AbortController();
    for (const s of WITHDRAWAL_TABS) {
      adminGet<Page<AdminWithdrawal>>("withdrawals", { status: s === "all" ? null : s, limit: 1 }, ctrl.signal).then(
        (r) => setCounts((c) => ({ ...c, [s]: r.total })),
        () => undefined,
      );
    }
    return () => ctrl.abort();
  }, []);
  return counts;
}

function Waited({ since }: { since: number }) {
  const now = useNow();
  const ms = Math.max(0, now - since);
  const b = waitBucket(ms);
  const cls = b === "red" ? "border-mismatch/50 text-mismatch" : b === "amber" ? "border-pending/50 text-pending" : "border-line text-ink-2";
  return (
    <span className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[12px] font-medium ${cls}`} title={`Waiting since ${fullDate(since)}`}>
      <Icon name="clock" size={13} />
      {duration(ms).replace(/ \d+s$/, "")}
    </span>
  );
}

function Stat({ label, info, children, sub, loading }: { label: string; info?: React.ReactNode; children: React.ReactNode; sub?: React.ReactNode; loading: boolean }) {
  return (
    <section className="flex min-w-0 flex-col rounded-[10px] border border-line bg-sf px-3.5 py-3.5 sm:px-4">
      <h3 className="label flex items-center gap-1.5">
        <span className="truncate">{label}</span>
        {info && <InfoTip label={`About ${label}`}>{info}</InfoTip>}
      </h3>
      {loading ? <Skeleton className="mt-3 h-7 w-28" /> : <div className="mt-2.5 min-w-0 truncate text-[21px] leading-none tracking-[-0.02em] sm:text-[24px]">{children}</div>}
      <div className="mt-2 min-h-[18px] text-[12.5px] text-ink-3">{loading ? <Skeleton className="h-3 w-24" /> : sub}</div>
    </section>
  );
}

function Summary() {
  const summary = useAdminQuery<WalletSummary>("wallet/summary", { book: "real" });
  const week = useAdminQuery<Overview>("overview", { days: 7, book: "real", tz: 180 });
  const pending = useAdminQuery<Page<AdminWithdrawal>>("withdrawals", { status: "pending", limit: 200 });
  const now = useNow();
  const s = summary.data;
  const series = week.data?.series ?? [];
  const today = series[series.length - 1];
  const weekAmount = series.reduce((t, d) => t + d.withdrawals, 0);
  const weekCount = series.reduce((t, d) => t + d.withdrawalCount, 0);
  const first = pending.data ? oldest(pending.data.rows) : null;
  const lim = s?.config.withdrawals;
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:mb-5 lg:gap-4 xl:grid-cols-4">
      <Stat label="Pending" loading={!s || !pending.data} info="Asked for and not paid yet. The money has already left the player's balance." sub={first ? <>{num(s?.withdrawals.pending.count ?? 0)} waiting · oldest {duration(Math.max(0, now - first)).replace(/ \d+s$/, "")}</> : "Nothing waiting"}>
        <Money santim={s?.withdrawals.pending.amount ?? 0} />
      </Stat>
      <Stat label="Paid today" loading={!today} info="Paid withdrawals by the time they were paid, Addis Ababa day." sub={today ? `${num(today.withdrawalCount)} ${today.withdrawalCount === 1 ? "payout" : "payouts"}` : ""}>
        <Money santim={today?.withdrawals ?? 0} />
      </Stat>
      <Stat label="Paid, last 7 days" loading={!week.data} info="Paid withdrawals in the last 7 Addis Ababa days, today included." sub={`${num(weekCount)} ${weekCount === 1 ? "payout" : "payouts"}`}>
        <Money santim={weekAmount} />
      </Stat>
      <Stat
        label={lim && !lim.enabled ? "Limits (payouts off)" : "Limits per request"}
        loading={!lim}
        info="Set on the server. The big number is the most one request may ask for. Above the second-approval amount a payout needs two moderators."
        sub={lim ? <>min {birr(lim.minAmount)} · per day {birr(lim.perDay)}{lim.secondApprovalAbove != null ? ` · 2nd approval above ${birr(lim.secondApprovalAbove)}` : ""}</> : ""}
      >
        {lim && <Money santim={lim.perRequest} />}
      </Stat>
    </div>
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

function WithdrawalDrawer({ w, loading, onClose }: { w: AdminWithdrawal | null; loading: boolean; onClose(): void }) {
  const user = useAdminQuery<UserDetail>(w ? `users/${encodeURIComponent(w.profileId)}` : null);
  return (
    <Drawer open width="lg" onClose={onClose} title="Withdrawal" subtitle={w ? <span className="font-mono">{shortId(w.id, 10, 6)}</span> : null}>
      {!w ? (
        loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <p className="text-[13.5px] text-ink-2">This withdrawal could not be found. It may have been mistyped in the link.</p>
        )
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PlayerCell id={w.player.id} name={w.player.name} username={w.player.username} />
            <div className="text-right">
              <Money santim={w.amount} className="text-[22px]" />
              <div className="mt-1 flex items-center justify-end gap-2">
                {w.status === "pending" && <Waited since={w.createdAt} />}
                <StatusPill status={w.status} />
              </div>
            </div>
          </div>
          <p className="flex items-start gap-2 rounded-lg border border-line bg-bg/60 px-3 py-2.5 text-[12.5px] text-ink-2">
            <Icon name="info" size={15} className="mt-0.5 flex-none text-ink-3" /> Read only. Moderators pay and confirm this in the Telegram chat.
          </p>
          <section className="rounded-lg border border-line bg-bg/60 p-3">
            <h3 className="label mb-3">Pay to</h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="Bank">{bankLabel(w.bank)}</Fact>
              <Fact label="Account">
                <CopyButton value={w.account} label="Copy account" className="-ml-1">
                  {w.account}
                </CopyButton>
              </Fact>
              <Fact label="Name on the account" className="sm:col-span-2">
                {w.payToName || dash}
              </Fact>
            </dl>
          </section>
          <section className="rounded-lg border border-line bg-bg/60 p-3">
            <h3 className="label mb-3">Progress</h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="Requested"><span title={fullDate(w.createdAt)}>{dateTime(w.createdAt)}</span></Fact>
              <Fact label="Picked up by">{w.pickedUpBy || dash}</Fact>
              <Fact label="Payout reference">
                {w.reference ? (
                  <CopyButton value={w.reference} label="Copy payout reference" className="-ml-1">
                    {w.reference}
                  </CopyButton>
                ) : (
                  dash
                )}
              </Fact>
              <Fact label="Closed">{w.closedAt ? `${dateTime(w.closedAt)}${w.closedBy ? ` by ${w.closedBy}` : ""}` : dash}</Fact>
              <Fact label="Flags" className="sm:col-span-2">
                <Flags w={w} />
              </Fact>
              {w.approval && (
                <Fact label="First approval" className="sm:col-span-2">
                  {w.approval.by}, payout reference <span className="font-mono">{w.approval.reference}</span>
                  {w.approval.forced && <span className="block text-[12.5px] text-ink-3">forced by {w.approval.forced.by}: {w.approval.forced.reason}</span>}
                </Fact>
              )}
            </dl>
          </section>
          <section className="rounded-lg border border-line bg-bg/60 p-3">
            <h3 className="label mb-3">The player now</h3>
            {user.data ? (
              <dl className="grid gap-3 sm:grid-cols-2">
                <Fact label="Real balance"><Money santim={user.data.balances.real} /></Fact>
                <Fact label="Withdrawable now">
                  <Money santim={user.data.withdrawable.amount} />
                  {user.data.withdrawable.held > 0 && (
                    <span className="block text-[12px] text-ink-3">
                      {birr(user.data.withdrawable.held)} held until {user.data.withdrawable.heldUntil ? dateTime(user.data.withdrawable.heldUntil) : "later"}
                    </span>
                  )}
                </Fact>
              </dl>
            ) : user.error ? (
              <p className="text-[13px] text-mismatch">{user.error.message}</p>
            ) : (
              <Skeleton className="h-10 w-full" />
            )}
          </section>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/admin/players/${encodeURIComponent(w.profileId)}`} size="sm" variant="secondary" iconRight="chevronRight">
              Player page
            </ButtonLink>
            <ButtonLink href={`/admin/wallet?profileId=${encodeURIComponent(w.profileId)}`} size="sm" variant="secondary" iconRight="chevronRight">
              Their ledger
            </ButtonLink>
          </div>
        </div>
      )}
    </Drawer>
  );
}

export function WithdrawalsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const counts = useCounts();
  const tab = pickTab(params.get("tab"), WITHDRAWAL_TABS, "pending", counts.pending ?? null);
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

  const list = useAdminQuery<Page<AdminWithdrawal>>("withdrawals", { status: tab === "all" ? null : tab, q, page, limit: LEDGER_PAGE_SIZE });
  const fromPage = openId ? list.data?.rows.find((r) => r.id === openId) : undefined;
  const lookup = useAdminQuery<Page<AdminWithdrawal>>(openId && !fromPage && !list.loading ? "withdrawals" : null, { q: openId, limit: 5 });
  const drawerRow = fromPage ?? lookup.data?.rows.find((r) => r.id === openId) ?? null;

  const columns = useMemo<Column<AdminWithdrawal>[]>(
    () => [
      {
        key: "requested",
        header: "Requested",
        phone: "secondary",
        cell: (w) => (
          <div className="flex flex-col items-start gap-1">
            <TimeAgo ts={w.createdAt} mode="date" className="whitespace-nowrap text-ink-2" />
            {w.status === "pending" && <Waited since={w.createdAt} />}
          </div>
        ),
      },
      { key: "player", header: "Player", primary: true, cell: (w) => <PlayerCell id={w.player.id} name={w.player.name} username={w.player.username} /> },
      {
        key: "account",
        header: "Bank / account",
        phone: "secondary",
        cell: (w) => (
          <div className="flex flex-col items-start leading-tight">
            <span className="text-[13px] text-ink">{bankLabel(w.bank)}</span>
            <CopyButton value={w.account} label="Copy account" className="-ml-1 whitespace-nowrap">
              {w.account}
            </CopyButton>
          </div>
        ),
      },
      { key: "payto", header: "Pay-to name", cell: (w) => <span className="whitespace-nowrap">{w.payToName || dash}</span> },
      { key: "amount", header: "Amount", align: "right", primary: true, cell: (w) => <Money santim={w.amount} /> },
      {
        key: "status",
        header: "Status / picked up by",
        primary: true,
        cell: (w) => (
          <div className="flex flex-col items-start gap-0.5">
            <StatusPill status={w.status} />
            {w.pickedUpBy && <span className="hidden max-w-[150px] truncate text-[12px] text-ink-3 md:block">by {w.pickedUpBy}</span>}
          </div>
        ),
      },
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
      {
        key: "closed",
        header: "Closed",
        cell: (w) =>
          w.closedAt ? (
            <div className="leading-tight">
              <TimeAgo ts={w.closedAt} mode="date" className="whitespace-nowrap text-ink-2" />
              {w.closedBy && <div className="max-w-[160px] truncate text-[12px] text-ink-3">by {w.closedBy}</div>}
            </div>
          ) : (
            dash
          ),
      },
      { key: "flags", header: "Flags", className: "md:min-w-[180px] md:max-w-[240px]", cell: (w) => <Flags w={w} /> },
    ],
    [],
  );

  return (
    <>
      <PageHeader title="Withdrawals" subtitle={counts.pending ? `${num(counts.pending)} waiting for a moderator.` : "Payouts players asked for."} />
      <p className="mb-4 flex items-start gap-2 rounded-[10px] border border-pending/40 bg-pending/[0.07] px-4 py-3 text-[13px] text-ink">
        <Icon name="info" size={16} className="mt-0.5 flex-none text-pending" />
        Payouts are made and confirmed in the Telegram moderators&apos; chat. This page is read-only.
      </p>
      <Summary />
      <Tabs<WithdrawalTab>
        label="Withdrawal status"
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        items={WITHDRAWAL_TABS.map((t) => ({ value: t, label: WITHDRAWAL_TAB_LABELS[t], count: counts[t] ?? null }))}
        className="mb-4"
      />
      <Card
        bodyClassName=""
        title={
          <span className="flex items-center gap-2">
            {WITHDRAWAL_TAB_LABELS[tab]} {list.data && <span className="num text-ink-3">{num(list.data.total)}</span>}
          </span>
        }
        actions={<SearchInput value={q} onChange={(v) => setParams({ q: v || null })} label="Search withdrawals" placeholder="Account, reference, name, player" className="w-full sm:w-[260px]" />}
      >
        <DataTable
          caption="Withdrawals"
          rows={list.data?.rows}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          columns={columns}
          rowKey={(w) => w.id}
          onRowClick={(w) => setParams({ open: w.id }, true)}
          skeletonRows={8}
          empty={
            tab === "pending"
              ? { title: q ? "No pending withdrawals match" : "Nothing waiting", body: q ? "Try another search." : "Every payout players asked for has been handled." }
              : { title: q ? "No withdrawals match" : `No ${tab === "all" ? "" : WITHDRAWAL_TAB_LABELS[tab].toLowerCase() + " "}withdrawals`, body: q ? "Search by account, payout reference, pay-to name, player or id." : "Withdrawals show up here when players ask for a payout." }
          }
          pager={list.data ? { page, pageSize: LEDGER_PAGE_SIZE, total: list.data.total, onPage: (n) => setParams({ page: n > 0 ? String(n + 1) : null }) } : undefined}
        />
      </Card>
      {openId && <WithdrawalDrawer w={drawerRow} loading={list.loading || lookup.loading} onClose={() => setParams({ open: null })} />}
    </>
  );
}
