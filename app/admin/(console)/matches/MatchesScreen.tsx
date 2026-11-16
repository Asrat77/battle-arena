"use client";

// The matches screen: "Live now" on top, then the recorded matches with filters
// kept in the URL (game, type, stake, player, page), a CSV export of everything
// that matches, and a drawer for one match (?open=<id>, so other screens can link).

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Select } from "@/components/admin/Field";
import { FilterChips } from "@/components/admin/FilterChips";
import { Icon } from "@/components/admin/icons";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { TimeAgo } from "@/components/admin/TimeAgo";
import { adminGet, useAdminQuery } from "@/lib/admin/api";
import { downloadCsv } from "@/lib/admin/csv";
import { duration, num, shortId } from "@/lib/admin/format";
import {
  MATCH_CSV_COLUMNS,
  MATCH_PAGE_SIZE,
  STAKES,
  STAKE_LABELS,
  TYPES,
  TYPE_LABELS,
  gameOptions,
  isFiltered,
  matchExportFilename,
  matchQuery,
  parseMatchParams,
  type MatchType,
  type StakeFilter,
} from "@/lib/admin/matches";
import { collectAll } from "@/lib/admin/players";
import type { LiveMatchRow, MatchRow, Overview, Page, UserRow } from "@/lib/admin/types";
import { LiveCard } from "./LiveCard";
import { MatchDrawer } from "./MatchDrawer";
import { PlayersPair, ResultCell, StakeCell } from "./MatchParts";

/** The @username for the player chip (users?q=<id> matches ids by prefix). */
function usePlayerLabel(id: string): string {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    setLabel(null);
    if (!id) return;
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
  return label ?? shortId(id, 8, 4);
}

function PlayerChip({ id, onRemove }: { id: string; onRemove(): void }) {
  const label = usePlayerLabel(id);
  return (
    <span className="inline-flex h-9 items-center gap-1 rounded-full border border-accent/60 bg-accent/10 pl-3 pr-1 text-[13px] font-medium text-accent lg:h-8">
      <Link href={`/admin/players/${encodeURIComponent(id)}`} className="font-mono hover:underline">
        {label}
      </Link>
      <button type="button" aria-label={`Remove player filter ${label}`} onClick={onRemove} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-accent/20 lg:h-6 lg:w-6">
        <Icon name="close" size={14} />
      </button>
    </span>
  );
}

export function MatchesScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = parseMatchParams((k) => params.get(k));
  const { game, type, stake, player, page, open } = state;

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

  const query = matchQuery(state);
  const { data, error, loading, reload } = useAdminQuery<Page<MatchRow>>("matches", { ...query, page, limit: MATCH_PAGE_SIZE });
  const live = useAdminQuery<{ rows: LiveMatchRow[] }>("matches/live", undefined, { refreshMs: 15_000 });
  const overview = useAdminQuery<Overview>("overview", { days: 90 });
  const games = useMemo(() => gameOptions(overview.data?.byGame), [overview.data]);

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
      const rows = await collectAll<MatchRow>((p, limit) => adminGet<Page<MatchRow>>("matches", { ...query, page: p, limit }), {
        onProgress: (done, total) => alive.current && setExporting({ done, total }),
        isCancelled: () => !alive.current,
      });
      if (alive.current) downloadCsv(matchExportFilename(state), rows, MATCH_CSV_COLUMNS);
    } catch (e) {
      if (alive.current) setExportError(e instanceof Error ? e.message : "The export failed");
    } finally {
      if (alive.current) setExporting(null);
    }
  };

  const columns = useMemo<Column<MatchRow>[]>(
    () => [
      { key: "ended", header: "Ended", phone: "secondary", cell: (m) => <TimeAgo ts={m.endedAt} mode="date" className="text-ink-2" /> },
      { key: "game", header: "Game", phone: "secondary", cell: (m) => <span className="whitespace-nowrap font-medium text-ink">{m.gameName}</span> },
      { key: "players", header: "Players", primary: true, cell: (m) => <PlayersPair m={m} /> },
      { key: "result", header: "Result", primary: true, cell: (m) => <ResultCell m={m} /> },
      { key: "duration", header: "Duration", align: "right", cell: (m) => <span className="num font-normal text-ink-2">{duration(m.durationMs)}</span> },
      { key: "moves", header: "Moves", align: "right", cell: (m) => <span className="num font-normal text-ink-2">{num(m.moves)}</span> },
      { key: "stake", header: "Stake", phone: "secondary", align: "right", cell: (m) => <StakeCell stake={m.stake} /> },
      {
        key: "ledger",
        header: "Ledger",
        cell: (m) => (
          <StatusPill status={m.status}>
            {m.status === "recorded" ? "Recorded" : "Pending"}
            {m.resultIndex != null && <span className="num font-normal text-ink-3">#{m.resultIndex}</span>}
          </StatusPill>
        ),
      },
    ],
    [],
  );

  const filtered = isFiltered(state);
  const total = data?.total;
  const subtitle =
    total == null ? "Live matches and every recorded match." : `${num(total)} ${filtered ? "matching " : "recorded "}${total === 1 ? "match" : "matches"}`;

  return (
    <>
      <PageHeader
        title="Matches"
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

      <LiveCard query={live} onOpen={(id) => setParams({ open: id }, true)} />

      <Card bodyClassName="" title={<span className="flex items-center gap-2">{filtered ? "Matching matches" : "Recorded matches"}{data && <span className="num text-ink-3">{num(data.total)}</span>}</span>}>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-x-5">
          <Select label="Game" hideLabel value={game} options={games} onChange={(v) => setParams({ game: v || null })} className="lg:w-[190px]" />
          <div className="flex min-w-0 flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-2.5">
            <span className="label !text-[10.5px]" aria-hidden>Opponent</span>
            <FilterChips<MatchType> label="Opponent type" value={type} onChange={(v) => setParams({ type: v === "all" ? null : v })} options={TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-2.5">
            <span className="label !text-[10.5px]" aria-hidden>Stake</span>
            <FilterChips<StakeFilter> label="Stake" value={stake} onChange={(v) => setParams({ stake: v === "all" ? null : v })} options={STAKES.map((s) => ({ value: s, label: STAKE_LABELS[s] }))} />
          </div>
          {player && <PlayerChip id={player} onRemove={() => setParams({ player: null })} />}
        </div>
        <DataTable
          caption="Recorded matches"
          rows={data?.rows}
          loading={loading}
          error={error}
          onRetry={reload}
          columns={columns}
          rowKey={(m) => m.matchId}
          onRowClick={(m) => setParams({ open: m.matchId }, true)}
          skeletonRows={10}
          empty={{
            title: filtered ? "No matches match" : "No matches yet",
            body: filtered ? "Try another game or clear a filter." : "Finished matches are listed here.",
          }}
          pager={data ? { page, pageSize: MATCH_PAGE_SIZE, total: data.total, onPage: (p) => setParams({ page: p > 0 ? String(p + 1) : null }) } : undefined}
        />
      </Card>

      <MatchDrawer id={open || null} onClose={() => setParams({ open: null })} />
    </>
  );
}
