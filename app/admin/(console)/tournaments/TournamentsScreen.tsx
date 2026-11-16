"use client";

// The tournaments list: three stat cards, status chips (client side: the list is
// small, but it is still fetched page by page, 200 at a time) and a table with
// a link to each tournament on the player app. State lives in the URL.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/admin/Card";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { FilterChips } from "@/components/admin/FilterChips";
import { ExportButton } from "@/components/admin/ExportButton";
import { PageHeader } from "@/components/admin/PageHeader";
import { PlayerCell } from "@/components/admin/PlayerCell";
import { Skeleton } from "@/components/admin/Skeleton";
import { StatusPill, statusLabel } from "@/components/admin/StatusPill";
import { TimeAgo } from "@/components/admin/TimeAgo";
import { adminGet, AdminApiError } from "@/lib/admin/api";
import { num } from "@/lib/admin/format";
import {
  TOURNAMENT_STATUSES,
  filterTournaments,
  tournamentCounts,
  tournamentDuration,
  tournamentFormat,
  tournamentPlayers,
  type TournamentStatusFilter,
} from "@/lib/admin/matches";
import { TOURNAMENT_CSV_COLUMNS, exportFilename } from "@/lib/admin/exports";
import { collectAll } from "@/lib/admin/players";
import type { Page, TournamentRow } from "@/lib/admin/types";

const PAGE_SIZE = 25;
const dash = <span className="text-ink-3">–</span>;

function Stat({ label, value, sub, loading }: { label: string; value: number; sub: string; loading: boolean }) {
  return (
    <section className="min-w-0 rounded-[10px] border border-line bg-sf px-3.5 py-3 sm:px-4">
      <h3 className="label truncate">{label}</h3>
      {loading ? <Skeleton className="mt-2.5 h-7 w-12" /> : <p className="num mt-2 text-[24px] leading-none tracking-[-0.02em] text-ink">{num(value)}</p>}
      <p className="mt-1.5 truncate text-[12px] text-ink-3">{sub}</p>
    </section>
  );
}

/** Every tournament, fetched 200 per request. */
function useTournaments() {
  const [rows, setRows] = useState<TournamentRow[] | null>(null);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    collectAll<TournamentRow>((p, limit) => adminGet<Page<TournamentRow>>("tournaments", { page: p, limit }), { isCancelled: () => !alive }).then(
      (r) => alive && setRows(r),
      (e) => alive && setError(e instanceof AdminApiError ? e : new AdminApiError(0, String(e))),
    );
    return () => {
      alive = false;
    };
  }, [tick]);
  return { rows, error, loading: rows === null && error === null, reload: useCallback(() => setTick((t) => t + 1), []) };
}

export function TournamentsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const rawStatus = params.get("status");
  const status: TournamentStatusFilter = (TOURNAMENT_STATUSES as readonly string[]).includes(rawStatus ?? "") ? (rawStatus as TournamentStatusFilter) : "all";
  const rawPage = Number.parseInt(params.get("page") ?? "", 10);
  const page = Number.isFinite(rawPage) && rawPage > 1 ? rawPage - 1 : 0;

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!("page" in changes)) next.delete("page");
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const { rows, error, loading, reload } = useTournaments();
  const counts = useMemo(() => tournamentCounts(rows ?? []), [rows]);
  const shown = useMemo(() => filterTournaments(rows ?? [], status), [rows, status]);
  const lastPage = Math.max(0, Math.ceil(shown.length / PAGE_SIZE) - 1);
  const safePage = Math.min(page, lastPage);
  const pageRows = shown.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const columns = useMemo<Column<TournamentRow>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        primary: true,
        cell: (t) => (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-ink">{t.name}</span>
            {t.visibility === "link" && (
              <span title="Only people with the link can see it" className="flex-none rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                Link only
              </span>
            )}
          </div>
        ),
      },
      { key: "game", header: "Game", phone: "secondary", cell: (t) => <span className="whitespace-nowrap">{t.gameName}</span> },
      { key: "format", header: "Format", cell: (t) => (
          <div className="whitespace-nowrap leading-tight" title={tournamentFormat(t)}>
            <span className="text-ink">Best of {t.bestOf}</span>
            <div className="text-[12px] text-ink-3">{t.size} seats</div>
          </div>
        ),
      },
      { key: "status", header: "Status", primary: true, cell: (t) => <StatusPill status={t.status}>{statusLabel(t.status)}</StatusPill> },
      { key: "players", header: "Players", phone: "secondary", cell: (t) => <span className="whitespace-nowrap">{tournamentPlayers(t)}</span> },
      { key: "host", header: "Host", cell: (t) => (t.host ? <PlayerCell id={t.host.id} name={t.host.name} size="sm" /> : <span className="text-ink-3">System</span>) },
      {
        key: "champion",
        header: "Champion",
        cell: (t) => (t.champion ? <PlayerCell id={t.champion.id} name={t.champion.bot ? "Bot" : t.champion.name} bot={t.champion.bot} size="sm" /> : dash),
      },
      { key: "created", header: "Created", phone: "secondary", cell: (t) => <TimeAgo ts={t.createdAt} mode="date" className="text-ink-2" /> },
      {
        key: "duration",
        header: "Duration",
        align: "right",
        cell: (t) => {
          const d = tournamentDuration(t);
          return d ? <span className="num font-normal text-ink-2">{d}</span> : dash;
        },
      },
    ],
    [],
  );

  const chipCounts: Record<TournamentStatusFilter, number | null> = { all: rows ? counts.total : null, open: rows ? counts.open : null, running: rows ? counts.running : null, finished: rows ? counts.finished : null };

  return (
    <>
      <PageHeader
        title="Tournaments"
        subtitle="Every tournament, open, running or finished."
        actions={
          <ExportButton<TournamentRow>
            filename={exportFilename("tournaments", [status === "all" ? null : status])}
            columns={TOURNAMENT_CSV_COLUMNS}
            disabled={shown.length === 0}
            load={async () => shown}
          />
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-2.5 sm:gap-4 lg:mb-5">
        <Stat label="Total" value={counts.total} sub="all time" loading={loading} />
        <Stat label="Active" value={counts.open + counts.running} sub={`${counts.open} open, ${counts.running} live`} loading={loading} />
        <Stat label="Finished" value={counts.finished} sub="completed" loading={loading} />
      </div>
      <Card bodyClassName="" title="All tournaments">
        <div className="border-b border-line px-4 py-3">
          <FilterChips<TournamentStatusFilter>
            label="Filter by status"
            value={status}
            onChange={(v) => setParams({ status: v === "all" ? null : v })}
            options={TOURNAMENT_STATUSES.map((s) => ({ value: s, label: s === "all" ? "All" : statusLabel(s), count: chipCounts[s] }))}
          />
        </div>
        <DataTable
          caption="Tournaments"
          rows={pageRows}
          loading={loading}
          error={error}
          onRetry={reload}
          columns={columns}
          rowKey={(t) => t.id}
          onRowClick={(t) => window.open(t.link, "_blank", "noopener,noreferrer")} // the row arrow is the "Open" link (player app, new tab)
          skeletonRows={6}
          empty={{ title: status === "all" ? "No tournaments yet" : `No ${status} tournaments`, body: status === "all" ? "Tournaments created on the player app show up here." : "Pick another status." }}
          pager={rows ? { page: safePage, pageSize: PAGE_SIZE, total: shown.length, onPage: (p) => setParams({ page: p > 0 ? String(p + 1) : null }) } : undefined}
        />
      </Card>
    </>
  );
}
