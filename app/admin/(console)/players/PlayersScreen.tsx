"use client";

// The players list: search (name, @username or id), filter chips with counts,
// a sortable table, paging and a CSV export of everything that matches. All of
// the state lives in the URL. The top bar's Real/Play switch decides which
// balance is shown big and what "balance" sorts by.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { FilterChips } from "@/components/admin/FilterChips";
import { Money } from "@/components/admin/Money";
import { PageHeader } from "@/components/admin/PageHeader";
import { PlayerCell } from "@/components/admin/PlayerCell";
import { SearchInput } from "@/components/admin/SearchInput";
import { StatusPill } from "@/components/admin/StatusPill";
import { TimeAgo } from "@/components/admin/TimeAgo";
import { adminGet, useAdminQuery } from "@/lib/admin/api";
import { downloadCsv } from "@/lib/admin/csv";
import { dateShort, num } from "@/lib/admin/format";
import {
  FILTERS,
  FILTER_LABELS,
  PAGE_SIZE,
  PLAYER_CSV_COLUMNS,
  collectAll,
  defaultDir,
  exportFilename,
  listQuery,
  parseListParams,
  type PlayerFilter,
  type PlayerSort,
} from "@/lib/admin/players";
import { useAdminPrefs } from "@/lib/admin/prefs";
import type { Book, Page, UserRow } from "@/lib/admin/types";

/** The player's presence as a pill; "in-match" pulses. */
export function PresencePill({ status }: { status: UserRow["status"] }) {
  return <StatusPill status={status} />;
}

/** Counts for the filter chips: one limit=1 request per chip, for the current search and book. */
function useChipCounts(q: string, book: Book) {
  const [counts, setCounts] = useState<Partial<Record<PlayerFilter, number>>>({});
  useEffect(() => {
    const ctrl = new AbortController();
    setCounts({});
    for (const f of FILTERS) {
      adminGet<Page<UserRow>>("users", { q, filter: f, book, limit: 1 }, ctrl.signal).then(
        (r) => !ctrl.signal.aborted && setCounts((c) => ({ ...c, [f]: r.total })),
        () => undefined, // counts are a nicety: the chip just shows no number
      );
    }
    return () => ctrl.abort();
  }, [q, book]);
  return counts;
}

export function PlayersScreen() {
  const { book } = useAdminPrefs();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = parseListParams((k) => params.get(k));
  const { q, filter, sort, dir, page } = state;

  // Change several URL params at once; anything but the page resets the page.
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

  const { data, error, loading, reload } = useAdminQuery<Page<UserRow>>("users", { ...listQuery(state, book), page, limit: PAGE_SIZE });
  const counts = useChipCounts(q, book);

  // Export: every row matching the filters, 200 per request.
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
      const rows = await collectAll<UserRow>((p, limit) => adminGet<Page<UserRow>>("users", { ...listQuery(state, book), page: p, limit }), {
        onProgress: (done, total) => alive.current && setExporting({ done, total }),
        isCancelled: () => !alive.current,
      });
      if (alive.current) downloadCsv(exportFilename(state), rows, PLAYER_CSV_COLUMNS);
    } catch (e) {
      if (alive.current) setExportError(e instanceof Error ? e.message : "The export failed");
    } finally {
      if (alive.current) setExporting(null);
    }
  };

  const real = book === "real";
  const columns = useMemo<Column<UserRow>[]>(
    () => [
      {
        key: "player",
        header: "Player",
        primary: true,
        sortKey: "name",
        cell: (u) => (
          <PlayerCell id={u.id} name={u.name} username={u.username} avatar={u.avatar} />
        ),
      },
      { key: "status", header: "Status", phone: "secondary", cell: (u) => <PresencePill status={u.status} /> },
      {
        key: "type",
        header: "Type",
        phone: "secondary",
        cell: (u) => <span className={u.hasPassword ? "text-ink" : "text-ink-3"}>{u.hasPassword ? "Registered" : "Guest"}</span>,
      },
      {
        key: "balance",
        header: real ? "Real balance" : "Play balance",
        align: "right",
        primary: true,
        sortKey: "balance",
        cell: (u) => (
          <div className="leading-tight">
            <Money santim={u.balance[book]} book={book} unit={false} className="text-[14px]" />
            <div className="num mt-0.5 text-[11.5px] font-normal text-ink-3 max-md:hidden">
              {real ? "play" : "real"} <Money santim={u.balance[real ? "play" : "real"]} book={real ? "play" : "real"} unit={false} className="!text-ink-3" />
            </div>
          </div>
        ),
      },
      { key: "matches", header: "Matches", phone: "secondary", phoneLabel: "matches", align: "right", sortKey: "matches", cell: (u) => <span className="num">{num(u.matches)}</span> },
      { key: "lastMatch", header: "Last match", phone: "secondary", sortKey: "lastMatch", cell: (u) => <TimeAgo ts={u.lastMatchAt} className="text-ink-2" /> },
      { key: "signin", header: "Last sign-in", cell: (u) => <TimeAgo ts={u.lastSignInAt} className="text-ink-2" /> },
      { key: "joined", header: "Joined", sortKey: "joined", cell: (u) => <span className="whitespace-nowrap text-ink-2">{dateShort(u.createdAt, true)}</span> },
    ],
    [book, real],
  );

  const filtered = filter !== "all" || q !== "";
  const total = data?.total;
  const subtitle =
    total == null
      ? "Everyone who has played, with balances and activity."
      : filtered
        ? `${num(total)} matching ${total === 1 ? "player" : "players"}`
        : `${num(total)} ${total === 1 ? "player" : "players"} in total`;

  return (
    <>
      <PageHeader
        title="Players"
        subtitle={subtitle}
        actions={
          <>
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
      />
      {exportError && (
        <p role="alert" className="mb-3 text-[13px] text-mismatch">
          Export failed: {exportError}
        </p>
      )}

      <Card
        bodyClassName=""
        title={
          <span className="flex items-center gap-2">
            {filtered ? "Matching players" : "All players"}
            {data && <span className="num text-ink-3">{num(data.total)}</span>}
          </span>
        }
        actions={<SearchInput value={q} onChange={(v) => setParams({ q: v || null })} label="Search players" placeholder="Name, @username or id" className="w-full sm:w-[280px]" />}
      >
        <div className="border-b border-line px-4 py-3">
          <FilterChips<PlayerFilter>
            label="Filter players"
            value={filter}
            onChange={(v) => setParams({ filter: v === "all" ? null : v })}
            options={FILTERS.map((f) => ({ value: f, label: FILTER_LABELS[f], count: counts[f] ?? null }))}
          />
        </div>
        <DataTable
          caption="Players"
          rows={data?.rows}
          loading={loading}
          error={error}
          onRetry={reload}
          columns={columns}
          rowKey={(u) => u.id}
          rowHref={(u) => `/admin/players/${encodeURIComponent(u.id)}`}
          skeletonRows={10}
          sort={{ key: sort, dir }}
          onSort={(s) => {
            const key = s.key as PlayerSort;
            // The first click on a column takes the API's natural direction (names A to Z).
            const changed = key !== sort;
            const nextDir = changed ? defaultDir(key) : s.dir;
            setParams({ sort: key === "joined" ? null : key, dir: nextDir === defaultDir(key) ? null : nextDir });
          }}
          empty={{
            title: filtered ? "No players match" : "No players yet",
            body: filtered ? "Try another name, @username or id, or pick a different filter." : "Players appear here as soon as someone signs in.",
          }}
          pager={data ? { page, pageSize: PAGE_SIZE, total: data.total, onPage: (p) => setParams({ page: p > 0 ? String(p + 1) : null }) } : undefined}
        />
      </Card>
    </>
  );
}
