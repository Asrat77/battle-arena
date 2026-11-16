"use client";

// The activity feed: one timeline of everything that happens, grouped by Addis
// Ababa day, with type chips (kept in the URL), "Load more" paging and a live
// refresh of the first page every 30 s. New rows are prepended (deduplicated by
// id) and the scroll position is held steady, so reading is never interrupted.
// A Live indicator with a pause toggle controls the refresh.

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { EmptyState } from "@/components/admin/EmptyState";
import { FilterChips } from "@/components/admin/FilterChips";
import { Icon } from "@/components/admin/icons";
import { Money } from "@/components/admin/Money";
import { PageHeader } from "@/components/admin/PageHeader";
import { PlayerCell } from "@/components/admin/PlayerCell";
import { Skeleton } from "@/components/admin/Skeleton";
import { adminGet, AdminApiError } from "@/lib/admin/api";
import {
  FEED_FILTERS,
  FEED_LABELS,
  TYPE_ICONS,
  TYPE_NAMES,
  feedTypeParam,
  groupByDay,
  hhmm,
  isSignedAmount,
  mergeFeed,
  parseFeedFilter,
  prependFresh,
  rowBook,
  type FeedFilter,
} from "@/lib/admin/activity";
import { fullDate, num } from "@/lib/admin/format";
import { useAdminPrefs } from "@/lib/admin/prefs";
import type { ActivityRow, Page } from "@/lib/admin/types";

const PAGE_SIZE = 50;
const REFRESH_MS = 30_000;

function Actor({ row }: { row: ActivityRow }) {
  const a = row.actor;
  if (!a) return null;
  // The title already starts with who it is ("Live Tester joined", "Asrat signed in"): don't say it twice.
  if ((row.type === "signup" || row.type === "admin") && row.title.startsWith(a.name)) return null;
  if (a.id === "admin") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
        <Icon name="shield" size={14} className="text-ink-3" />
        {a.name}
      </span>
    );
  }
  return <PlayerCell id={a.id} name={a.name} username={a.username} size="sm" href={null} className="text-[12.5px]" />;
}

function FeedItem({ row, fresh, book }: { row: ActivityRow; fresh: boolean; book: "real" | "play" }) {
  const signed = isSignedAmount(row);
  const body = (
    <>
      <time dateTime={new Date(row.ts).toISOString()} title={fullDate(row.ts)} className="num w-11 flex-none pt-1.5 text-[12px] font-normal text-ink-3 max-sm:hidden">
        {hhmm(row.ts)}
      </time>
      <span title={TYPE_NAMES[row.type]} className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-line bg-sf-2 text-ink-2">
        <Icon name={TYPE_ICONS[row.type]} size={16} />
        <span className="sr-only">{TYPE_NAMES[row.type]}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] leading-snug text-ink">{row.title}</span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Actor row={row} />
          <time dateTime={new Date(row.ts).toISOString()} title={fullDate(row.ts)} className="num text-[12px] font-normal text-ink-3 sm:hidden">
            {hhmm(row.ts)}
          </time>
        </span>
      </span>
      {row.amount != null && <Money santim={row.amount} book={rowBook(row, book)} signed={signed} className="flex-none pt-1.5 text-[13.5px]" />}
      {row.link && <Icon name="chevronRight" size={16} className="mt-1.5 flex-none text-ink-3" />}
    </>
  );
  const cls = `flex min-h-[56px] items-start gap-3 px-4 py-3 ${fresh ? "anim-fade bg-accent/5" : ""}`;
  return row.link ? (
    <Link href={row.link} className={`${cls} transition-colors hover:bg-sf-2/70`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-busy aria-label="Loading activity">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ActivityScreen() {
  const { book } = useAdminPrefs();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = parseFeedFilter(params.get("type"));
  const typeParam = feedTypeParam(filter);

  const setFilter = (f: FeedFilter) => {
    const next = new URLSearchParams(window.location.search);
    if (f === "all") next.delete("type");
    else next.set("type", f);
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [nextPage, setNextPage] = useState(1);
  const [initial, setInitial] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [tick, setTick] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Scroll anchor: the page height before a prepend, to put the scroll position back after it.
  const rowsRef = useRef<ActivityRow[]>([]);
  rowsRef.current = rows;
  const anchor = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (anchor.current !== null) {
      const delta = document.documentElement.scrollHeight - anchor.current;
      if (delta > 0 && window.scrollY > 24) window.scrollBy(0, delta);
      anchor.current = null;
    }
  }, [rows]);

  // First page, again whenever the filter changes or "Try again" is pressed.
  useEffect(() => {
    const ctrl = new AbortController();
    setInitial(true);
    setError(null);
    setRows([]);
    setFresh(new Set());
    setNextPage(1);
    adminGet<Page<ActivityRow>>("activity", { type: typeParam, page: 0, limit: PAGE_SIZE }, ctrl.signal).then(
      (r) => {
        if (ctrl.signal.aborted) return;
        setRows(mergeFeed(r.rows));
        setTotal(r.total);
        setUpdatedAt(Date.now());
        setInitial(false);
      },
      (e) => {
        if (ctrl.signal.aborted || (e as Error)?.name === "AbortError") return;
        setError(e instanceof AdminApiError ? e : new AdminApiError(0, String(e)));
        setInitial(false);
      },
    );
    return () => ctrl.abort();
  }, [typeParam, tick]);

  // Live: refresh the first page every 30 s and prepend what is new.
  useEffect(() => {
    if (paused || initial || error) return;
    const ctrl = new AbortController();
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      adminGet<Page<ActivityRow>>("activity", { type: typeParam, page: 0, limit: PAGE_SIZE }, ctrl.signal).then(
        (r) => {
          if (ctrl.signal.aborted) return;
          setUpdatedAt(Date.now());
          setTotal(r.total);
          const merged = prependFresh(rowsRef.current, r.rows);
          if (merged.added === 0) return;
          const known = new Set(rowsRef.current.map((x) => x.id));
          anchor.current = document.documentElement.scrollHeight;
          setFresh(new Set(r.rows.filter((x) => !known.has(x.id)).map((x) => x.id)));
          window.setTimeout(() => setFresh(new Set()), 6000);
          setRows(merged.rows);
        },
        () => undefined, // a failed refresh keeps what is shown; the next one tries again
      );
    }, REFRESH_MS);
    return () => {
      window.clearInterval(id);
      ctrl.abort();
    };
  }, [paused, initial, error, typeParam]);

  const loadMore = async () => {
    setMore(true);
    setMoreError(null);
    try {
      const r = await adminGet<Page<ActivityRow>>("activity", { type: typeParam, page: nextPage, limit: PAGE_SIZE });
      setRows((cur) => mergeFeed(cur, r.rows));
      setTotal(r.total);
      setNextPage((p) => p + 1);
    } catch (e) {
      setMoreError(e instanceof Error ? e.message : "Couldn't load more");
    } finally {
      setMore(false);
    }
  };

  const groups = useMemo(() => groupByDay(rows), [rows]);
  const hasMore = rows.length < total;

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Sign-ups, matches, money, tournaments and admin actions, newest first."
        actions={
          <>
            <span role="status" className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-sf px-3 text-[12px] font-medium text-ink-2">
              <span className={`relative h-1.5 w-1.5 rounded-full bg-current ${paused ? "text-ink-3" : "ping text-recorded"}`} aria-hidden />
              {paused ? "Paused" : "Live"}
              {updatedAt && !paused && <span className="font-normal text-ink-3 max-sm:hidden">· every 30 s</span>}
            </span>
            <Button size="sm" icon={paused ? "refresh" : "clock"} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
              {paused ? "Resume" : "Pause"}
            </Button>
          </>
        }
      />
      <Card
        bodyClassName=""
        title={
          <span className="flex items-center gap-2">
            {filter === "all" ? "Everything" : FEED_LABELS[filter]}
            {!initial && !error && <span className="num text-ink-3">{num(total)}</span>}
          </span>
        }
      >
        <div className="border-b border-line px-4 py-3">
          <FilterChips<FeedFilter> label="Filter by type" value={filter} onChange={setFilter} options={FEED_FILTERS.map((f) => ({ value: f, label: FEED_LABELS[f] }))} />
        </div>
        {error ? (
          <EmptyState icon="alert" tone="error" title="Couldn't load activity" action={<Button size="sm" icon="refresh" onClick={() => setTick((t) => t + 1)}>Try again</Button>}>
            {error.message}
          </EmptyState>
        ) : initial ? (
          <FeedSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon="activity" title={filter === "all" ? "Nothing has happened yet" : `No ${FEED_LABELS[filter].toLowerCase()} yet`}>
            {filter === "all" ? "Activity appears here as people sign up and play." : "Pick another type to see more."}
          </EmptyState>
        ) : (
          <div>
            {groups.map((g) => (
              <section key={g.day} aria-label={g.heading}>
                <h2 className="label sticky top-0 z-[1] flex items-center gap-2 border-b border-line bg-sf-2 px-4 py-2 lg:top-0">
                  {g.heading}
                  <span className="num text-ink-3">{g.rows.length}</span>
                </h2>
                <ul className="divide-y divide-line/70">
                  {g.rows.map((r) => (
                    <li key={r.id}>
                      <FeedItem row={r} fresh={fresh.has(r.id)} book={book} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <div className="flex flex-col items-center gap-2 border-t border-line px-4 py-4">
              {moreError && (
                <p role="alert" className="text-[13px] text-mismatch">
                  {moreError}
                </p>
              )}
              {hasMore ? (
                <Button size="sm" icon="chevronDown" loading={more} onClick={loadMore}>
                  Load more
                </Button>
              ) : (
                <p className="text-[12.5px] text-ink-3">That is everything: {num(rows.length)} {rows.length === 1 ? "entry" : "entries"}.</p>
              )}
              {hasMore && <p className="num text-[12px] font-normal text-ink-3">{num(rows.length)} of {num(total)} shown</p>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
