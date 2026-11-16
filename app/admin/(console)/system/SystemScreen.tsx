"use client";

// System health: a verdict banner, one card per check (storage, wallet log chain,
// match ledger, Telegram, receipt checks, real money), then the server, wallet
// settings, withdrawal limits, verify.et budget and record counts. Refreshes
// every 15 s while the tab is visible. Counts and on/off flags only: the API
// never sends tokens, keys, account numbers or chat ids.

import Link from "next/link";
import { Button } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { EmptyState } from "@/components/admin/EmptyState";
import { Icon } from "@/components/admin/icons";
import { PageHeader } from "@/components/admin/PageHeader";
import { Skeleton } from "@/components/admin/Skeleton";
import { TimeAgo } from "@/components/admin/TimeAgo";
import { useAdminQuery } from "@/lib/admin/api";
import { birr, count, dateTime, num } from "@/lib/admin/format";
import { OVERALL_TEXT, budgetShare, healthChecks, overall, uptimeText, type Check, type CheckState } from "@/lib/admin/system";
import type { SystemInfo, WalletSummary } from "@/lib/admin/types";

const TONE: Record<CheckState, { dot: string; border: string; label: string }> = {
  ok: { dot: "bg-recorded", border: "border-line", label: "OK" },
  warn: { dot: "bg-pending", border: "border-pending/50", label: "WATCH" },
  alert: { dot: "bg-mismatch", border: "border-mismatch/50", label: "PROBLEM" },
  off: { dot: "bg-ink-3", border: "border-line", label: "OFF" },
};

function CheckCard({ c }: { c: Check }) {
  const t = TONE[c.state];
  return (
    <li className={`flex min-w-0 flex-col rounded-[10px] border bg-sf px-4 py-3.5 ${t.border}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 flex-none rounded-full ${t.dot}`} aria-hidden />
        <h3 className="label truncate">{c.label}</h3>
        <span className="num ml-auto text-[11px] text-ink-3">{t.label}</span>
      </div>
      <p className="mt-2 text-[13.5px] leading-snug text-ink-2">{c.text}</p>
    </li>
  );
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-h-[44px] items-center justify-between gap-4 px-4 py-2 lg:min-h-[38px]">
          <dt className="text-[13px] text-ink-2">{k}</dt>
          <dd className="num min-w-0 truncate text-right text-[13.5px] font-normal text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const share = budgetShare(used, limit);
  const pct = share === null ? 0 : Math.min(100, Math.round(share * 100));
  const bar = share !== null && share >= 1 ? "bg-mismatch" : share !== null && share >= 0.8 ? "bg-pending" : "bg-accent";
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-ink-2">{label}</span>
        <span className="num font-normal text-ink">{num(used)}{limit ? ` of ${num(limit)}` : " (no limit)"}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sf-3" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit ?? undefined} aria-valuenow={used}>
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading system health">
      <Skeleton className="h-14 w-full rounded-[10px]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] w-full rounded-[10px]" />
        ))}
      </div>
    </div>
  );
}

export function SystemScreen() {
  const { data: s, error, loading, reload } = useAdminQuery<SystemInfo>("system", undefined, { refreshMs: 15_000 });
  // GET system carries the short wallet config; the deposit settings come from the wallet summary.
  const summary = useAdminQuery<WalletSummary>("wallet/summary", { book: "real" });
  const dep = summary.data?.config;
  const checks = s ? healthChecks(s) : [];
  const verdict = overall(checks);
  const v = verdict === "off" ? "ok" : verdict;

  return (
    <>
      <PageHeader
        title="System health"
        subtitle="Store, ledger, wallet log and configuration. Counts and on/off flags only, never secrets."
        actions={
          <>
            {s && (
              <span className="text-[12.5px] text-ink-3">
                Server time <TimeAgo ts={s.time} mode="date" />
              </span>
            )}
            <Button size="sm" icon="refresh" onClick={reload} loading={loading && !s}>
              Refresh
            </Button>
          </>
        }
      />

      {error && !s && (
        <Card>
          <EmptyState tone="error" icon="alert" title="Couldn't load system health" action={<Button size="sm" icon="refresh" onClick={reload}>Try again</Button>}>
            {error.message}
          </EmptyState>
        </Card>
      )}
      {loading && !s && !error && <Loading />}

      {s && (
        <div className="space-y-4 lg:space-y-5">
          <div
            role="status"
            className={`flex items-center gap-3 rounded-[10px] border px-4 py-3.5 ${v === "alert" ? "border-mismatch/50 bg-mismatch-soft" : v === "warn" ? "border-pending/50 bg-pending/10" : "border-recorded/40 bg-recorded/10"}`}
          >
            <Icon name={v === "ok" ? "check" : "alert"} size={18} className={v === "alert" ? "text-mismatch" : v === "warn" ? "text-pending" : "text-recorded"} />
            <p className="min-w-0 flex-1 text-[14px] font-medium text-ink">
              {OVERALL_TEXT[v]}
              <span className="ml-2 font-normal text-ink-2">
                {checks.filter((c) => c.state === "alert" || c.state === "warn").length > 0
                  ? `${count(checks.filter((c) => c.state === "alert" || c.state === "warn").length, "check")} to look at.`
                  : `Up for ${uptimeText(s.uptimeMs)}.`}
              </span>
            </p>
            {error && <span className="text-[12px] text-pending">Refresh failed, showing the last answer.</span>}
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {checks.map((c) => (
              <CheckCard key={c.id} c={c} />
            ))}
          </ul>

          <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
            <Card title="Server" bodyClassName="">
              <Facts
                rows={[
                  ["Up for", uptimeText(s.uptimeMs)],
                  ["Started", dateTime(s.time - s.uptimeMs)],
                  ["Node", s.node],
                  ["Storage", s.store.kind === "postgres" ? "Postgres" : s.store.kind === "file" ? "Data file" : "Memory"],
                  ["Database", s.database === "ok" ? "Answering" : s.database === "none" ? "Not used" : "Not answering"],
                  ["Unsaved writes", num(s.store.pendingWrites)],
                  ["Open sockets", num(s.counts.sockets)],
                ]}
              />
            </Card>
            <Card title="Wallet settings" bodyClassName="">
              <Facts
                rows={[
                  ["Mode", s.wallet.mode === "real" ? "Real money" : "Play money"],
                  ["Platform fee", `${(s.wallet.config.feeBps / 100).toFixed(2).replace(/\.00$/, "")}%`],
                  ["Stake range", `${birr(s.wallet.config.minStake)} to ${birr(s.wallet.config.maxStake)}`],
                  ["Play-money top-up", birr(s.wallet.config.faucetAmount)],
                  ["Deposits", s.deposits.enabled ? `On, ${count(s.deposits.accounts, "bank")}` : "Off"],
                  ["Minimum deposit", dep ? birr(dep.minDeposit) : "–"],
                  ["Deposit hold", dep ? `${Math.round(dep.depositHoldMs / 3_600_000)} h` : "–"],
                ]}
              />
            </Card>
            <Card title="Withdrawals" bodyClassName="">
              <Facts
                rows={[
                  ["Payouts", s.withdrawals.enabled ? "On" : "Off"],
                  ["Minimum", birr(s.withdrawals.minAmount)],
                  ["Per request", birr(s.withdrawals.perRequest)],
                  ["Per day", birr(s.withdrawals.perDay)],
                  ["Second approval above", s.withdrawals.secondApprovalAbove == null ? "Never" : birr(s.withdrawals.secondApprovalAbove)],
                ]}
              />
            </Card>
            <Card title="Receipt checks (verify.et)" bodyClassName="" info="How many receipts were checked with the paid verify.et service. The limits are set on the server.">
              {s.verifyBudget ? (
                <div className="divide-y divide-line">
                  <Meter label="Today" used={s.verifyBudget.used.day} limit={s.verifyBudget.limits.daily} />
                  <Meter label="This month" used={s.verifyBudget.used.month} limit={s.verifyBudget.limits.monthly} />
                </div>
              ) : (
                <EmptyState icon="system" title="Not set up">verify.et is off, so receipts cannot be checked automatically.</EmptyState>
              )}
            </Card>
            <Card title="Records" bodyClassName="">
              <Facts
                rows={[
                  ["Players", num(s.counts.profiles)],
                  ["Recorded matches", num(s.counts.matches)],
                  ["Live matches", num(s.counts.liveMatches)],
                  ["Tournaments", num(s.counts.tournaments)],
                  ["Deposits", num(s.counts.deposits)],
                  ["Withdrawals", num(s.counts.withdrawals)],
                  ["Ledger blocks", num(s.ledger.blocks)],
                  ["Wallet log entries", num(s.wallet.logEntries)],
                ]}
              />
            </Card>
            <Card title="Admin" bodyClassName="">
              <Facts
                rows={[
                  ["Signed-in admins", num(s.admin.liveSessions)],
                  ["Audit entries", <Link key="a" href="/admin/audit" className="text-accent hover:underline">{num(s.admin.auditEntries)}</Link>],
                  ["Telegram bot", s.telegram.configured ? "Configured" : "Not configured"],
                  ["Moderator chat", s.telegram.moderatorChat ? "Set" : "Not set"],
                  ["Moderators", num(s.telegram.moderators)],
                ]}
              />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
