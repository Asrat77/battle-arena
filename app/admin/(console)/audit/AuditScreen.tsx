"use client";

// The admin audit log: every sign-in (and failed one), sign-out, balance
// adjustment and deposit decision, newest first, with the reason the admin wrote.
// Filter chips by action and a search over admin name, target and IP live in the
// URL; a row opens a drawer (?open=<id>) with every field; CSV exports the lot.

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { Card } from "@/components/admin/Card";
import { CopyButton } from "@/components/admin/CopyButton";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Drawer } from "@/components/admin/Drawer";
import { ExportButton } from "@/components/admin/ExportButton";
import { FilterChips } from "@/components/admin/FilterChips";
import { PageHeader } from "@/components/admin/PageHeader";
import { SearchInput } from "@/components/admin/SearchInput";
import { StatusPill } from "@/components/admin/StatusPill";
import { TimeAgo } from "@/components/admin/TimeAgo";
import { adminGet, useAdminQuery } from "@/lib/admin/api";
import {
  AUDIT_FILTERS,
  AUDIT_FILTER_ACTIONS,
  AUDIT_FILTER_LABELS,
  AUDIT_PAGE_SIZE,
  actionLabel,
  actionStatus,
  auditFacts,
  auditSummary,
  auditTargetHref,
  parseAuditFilter,
  type AuditFilter,
} from "@/lib/admin/audit";
import { AUDIT_CSV_COLUMNS, exportFilename } from "@/lib/admin/exports";
import { fullDate, num } from "@/lib/admin/format";
import { collectAll } from "@/lib/admin/players";
import type { AuditEntry, Page } from "@/lib/admin/types";

const dash = <span className="text-ink-3">–</span>;

function Target({ e }: { e: AuditEntry }) {
  if (!e.target) return dash;
  const href = auditTargetHref(e);
  const label = <span className="num font-normal">{e.target.length > 14 ? `${e.target.slice(0, 8)}…${e.target.slice(-4)}` : e.target}</span>;
  return href ? (
    <Link href={href} onClick={(ev) => ev.stopPropagation()} className="text-accent hover:underline">
      {label}
    </Link>
  ) : (
    label
  );
}

function EntryDrawer({ entry, onClose }: { entry: AuditEntry | null; onClose(): void }) {
  const facts = entry ? auditFacts(entry) : [];
  const href = entry ? auditTargetHref(entry) : null;
  const row = (label: string, value: React.ReactNode) => (
    <div key={label} className="min-w-0">
      <dt className="label !text-[10.5px]">{label}</dt>
      <dd className="mt-1 break-words text-[13.5px] text-ink">{value}</dd>
    </div>
  );
  return (
    <Drawer open={Boolean(entry)} onClose={onClose} title={entry ? actionLabel(entry.action) : "Audit entry"} subtitle={entry ? fullDate(entry.ts) : undefined}>
      {entry && (
        <dl className="space-y-4 p-4">
          {row("Admin", entry.actor)}
          {row("Action", <StatusPill status={actionStatus(entry.action)}>{actionLabel(entry.action)}</StatusPill>)}
          {entry.target && row("Target", href ? <Link href={href} className="text-accent hover:underline">{entry.target}</Link> : entry.target)}
          {facts.map((f) => row(f.label, f.value))}
          {entry.ip && row("IP address", <span className="num font-normal">{entry.ip}</span>)}
          {row("Entry id", <CopyButton value={entry.id}>{entry.id}</CopyButton>)}
        </dl>
      )}
    </Drawer>
  );
}

export function AuditScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = parseAuditFilter(params.get("type"));
  const action = AUDIT_FILTER_ACTIONS[filter];
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

  const list = useAdminQuery<Page<AuditEntry>>("audit", { action, q, page, limit: AUDIT_PAGE_SIZE });
  const open = openId ? list.data?.rows.find((r) => r.id === openId) ?? null : null;

  const columns = useMemo<Column<AuditEntry>[]>(
    () => [
      { key: "time", header: "When", phone: "secondary", cell: (e) => <TimeAgo ts={e.ts} mode="date" className="whitespace-nowrap" /> },
      { key: "admin", header: "Admin", phone: "primary", cell: (e) => <span className="font-medium text-ink">{e.actor}</span> },
      { key: "action", header: "Action", phone: "primary", cell: (e) => <StatusPill status={actionStatus(e.action)}>{actionLabel(e.action)}</StatusPill> },
      { key: "target", header: "Target", phone: "secondary", cell: (e) => <Target e={e} /> },
      {
        key: "summary",
        header: "What and why",
        phone: "secondary",
        className: "min-w-[220px] max-w-[420px]",
        cell: (e) => {
          const s = auditSummary(e);
          return s ? <span className="line-clamp-2 break-words text-ink-2">{s}</span> : dash;
        },
      },
      { key: "ip", header: "IP", cell: (e) => (e.ip ? <span className="num font-normal text-ink-2">{e.ip}</span> : dash) },
    ],
    [],
  );

  const filtered = filter !== "all" || q !== "";
  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Who did what as admin, and why. The newest 2,000 entries are kept."
        actions={
          <ExportButton<AuditEntry>
            filename={exportFilename("audit", [filter === "all" ? null : filter, q ? "search" : null])}
            columns={AUDIT_CSV_COLUMNS}
            disabled={!list.data || list.data.total === 0}
            load={(onProgress, isCancelled) => collectAll<AuditEntry>((p, limit) => adminGet<Page<AuditEntry>>("audit", { action, q, page: p, limit }), { onProgress, isCancelled })}
          />
        }
      />
      <Card
        bodyClassName=""
        title={<span className="flex items-center gap-2">{filtered ? "Matching entries" : "All entries"}{list.data && <span className="num text-ink-3">{num(list.data.total)}</span>}</span>}
        actions={<SearchInput value={q} onChange={(v) => setParams({ q: v || null })} label="Search audit log" placeholder="Admin name, target or IP" className="w-full sm:w-[260px]" />}
      >
        <div className="border-b border-line px-4 py-3">
          <FilterChips<AuditFilter>
            label="Filter by action"
            value={filter}
            onChange={(v) => setParams({ type: v === "all" ? null : v })}
            options={AUDIT_FILTERS.map((f) => ({ value: f, label: AUDIT_FILTER_LABELS[f] }))}
          />
        </div>
        <DataTable
          caption="Audit log"
          rows={list.data?.rows}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          columns={columns}
          rowKey={(e) => e.id}
          onRowClick={(e) => setParams({ open: e.id }, true)}
          skeletonRows={8}
          empty={{
            title: filtered ? "No entries match" : "Nothing recorded yet",
            body: filtered ? "Try another action or search." : "Sign-ins, balance adjustments and deposit decisions are written here.",
          }}
          pager={list.data ? { page, pageSize: AUDIT_PAGE_SIZE, total: list.data.total, onPage: (n) => setParams({ page: n > 0 ? String(n + 1) : null }) } : undefined}
        />
      </Card>
      <EntryDrawer entry={open} onClose={() => setParams({ open: null })} />
    </>
  );
}
