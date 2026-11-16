"use client";

// The admin table. Desktop (md+): a dense table with mono uppercase headers,
// optional controlled sorting and a row link. Phones: each row is a compact
// card (about 80 px): line 1 holds the `primary` columns (first on the left,
// the others on the right), line 2 up to three `secondary` values inline in
// small muted text separated by middots. Everything else is hidden on phones.
// Handles loading (skeleton rows), empty, error (with retry) and paging.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { num } from "@/lib/admin/format";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { Icon } from "./icons";
import { Skeleton } from "./Skeleton";

export type PhoneRole = "primary" | "secondary" | "hidden";

/** The phone role of a column; the older `primary` and `hideOnMobile` flags still count. */
export function phoneRole<T>(c: Pick<Column<T>, "phone" | "primary" | "hideOnMobile">): PhoneRole {
  return c.phone ?? (c.primary ? "primary" : "hidden");
}

export interface Column<T> {
  key: string;
  header: string;
  cell(row: T): React.ReactNode;
  /** Numbers and money: right aligned. */
  align?: "left" | "right";
  /** Sortable: the API sort key this column stands for. */
  sortKey?: string;
  /**
   * Where the column goes on a phone card: "primary" (line 1: the first on the left, the rest on the right),
   * "secondary" (line 2, small and muted, at most three per card) or "hidden" (the default).
   */
  phone?: PhoneRole;
  /** Short text before a secondary value on the phone card, e.g. "moves" gives "12 moves". */
  phoneLabel?: string;
  /** Same as phone: "primary". */
  primary?: boolean;
  /** Same as phone: "hidden". */
  hideOnMobile?: boolean;
  /** Extra classes for th and td, e.g. a width ("w-[140px]"). */
  className?: string;
}

export interface SortState {
  key: string;
  dir: "asc" | "desc";
}

export interface PagerState {
  page: number;
  pageSize: number;
  total: number;
  onPage(page: number): void;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
  loading = false,
  error,
  onRetry,
  empty,
  sort,
  onSort,
  onRowClick,
  rowHref,
  pager,
  skeletonRows = 6,
  className = "",
}: {
  rows: readonly T[] | null | undefined;
  columns: readonly Column<T>[];
  rowKey(row: T): string;
  /** For screen readers. */
  caption: string;
  loading?: boolean;
  error?: { message: string } | string | null;
  onRetry?(): void;
  /** What to show when there are no rows: a node, or a title and a line. */
  empty?: React.ReactNode | { title: string; body?: string };
  sort?: SortState | null;
  onSort?(next: SortState): void;
  onRowClick?(row: T): void;
  /** Rows open this page (row click, plus an explicit arrow link for keyboard users). */
  rowHref?(row: T): string | null;
  pager?: PagerState;
  skeletonRows?: number;
  className?: string;
}) {
  const router = useRouter();
  const list = rows ?? [];
  const showSkeleton = loading && list.length === 0 && !error;
  const errorText = typeof error === "string" ? error : error?.message;
  const linked = Boolean(rowHref || onRowClick);
  const [first, ...otherPrimary] = columns.filter((c) => phoneRole(c) === "primary");
  const secondary = columns.filter((c) => phoneRole(c) === "secondary").slice(0, 3);

  const open = (row: T, e: React.MouseEvent) => {
    // Let links and buttons inside the row do their own thing.
    if ((e.target as HTMLElement).closest("a,button,input,select,textarea")) return;
    if (onRowClick) onRowClick(row);
    else {
      const href = rowHref?.(row);
      if (href) router.push(href);
    }
  };

  const toggleSort = (c: Column<T>) => {
    if (!c.sortKey || !onSort) return;
    const same = sort?.key === c.sortKey;
    onSort({ key: c.sortKey, dir: same && sort?.dir === "desc" ? "asc" : "desc" });
  };

  const rowAction = (row: T) => {
    const href = rowHref?.(row);
    if (href)
      return (
        <Link href={href} aria-label="Open" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 hover:bg-sf-3 hover:text-ink">
          <Icon name="chevronRight" size={16} />
        </Link>
      );
    if (onRowClick)
      return (
        <button type="button" aria-label="Open" onClick={() => onRowClick(row)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 hover:bg-sf-3 hover:text-ink">
          <Icon name="chevronRight" size={16} />
        </button>
      );
    return null;
  };

  let body: React.ReactNode = null;
  if (errorText && list.length === 0) {
    body = (
      <EmptyState icon="alert" tone="error" title="Couldn't load this" action={onRetry && <Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button>}>
        {errorText}
      </EmptyState>
    );
  } else if (!showSkeleton && list.length === 0 && !loading) {
    body =
      empty && typeof empty === "object" && "title" in (empty as object) ? (
        <EmptyState title={(empty as { title: string }).title}>{(empty as { body?: string }).body}</EmptyState>
      ) : (
        (empty as React.ReactNode) ?? <EmptyState title="Nothing here yet" />
      );
  }

  return (
    <div className={`min-w-0 ${className}`}>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-[13.5px]" aria-busy={loading || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line">
              {columns.map((c) => {
                const active = sort?.key === c.sortKey && c.sortKey;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={`label h-10 whitespace-nowrap px-4 font-medium first:pl-5 last:pr-5 ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}
                  >
                    {c.sortKey && onSort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c)}
                        className={`inline-flex items-center gap-1 uppercase tracking-[inherit] hover:text-ink ${active ? "text-ink" : ""} ${c.align === "right" ? "flex-row-reverse" : ""}`}
                      >
                        {c.header}
                        <Icon name={active ? (sort?.dir === "asc" ? "arrowUp" : "arrowDown") : "chevronUpDown"} size={12} className={active ? "text-accent" : "text-ink-3"} />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {linked && (
                <th scope="col" className="w-12 pr-5">
                  <span className="sr-only">Open</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {showSkeleton &&
              Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={i} className="border-b border-line/70 last:border-0">
                  {columns.map((c, j) => (
                    <td key={c.key} className="h-[52px] px-4 first:pl-5 last:pr-5">
                      <Skeleton className={`h-3.5 ${c.align === "right" ? "ml-auto w-16" : j === 0 ? "w-36" : "w-20"}`} />
                    </td>
                  ))}
                  {linked && <td />}
                </tr>
              ))}
            {list.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={linked ? (e) => open(row, e) : undefined}
                className={`border-b border-line/70 transition-colors last:border-0 ${linked ? "cursor-pointer hover:bg-sf-2/70" : ""} ${loading ? "opacity-60" : ""}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`h-[52px] px-4 py-2 align-middle first:pl-5 last:pr-5 ${c.align === "right" ? "text-right" : ""} ${c.className ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
                {linked && <td className="w-12 pr-5 text-right">{rowAction(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {body}
      </div>

      {/* Phone cards */}
      <ul className="divide-y divide-line md:hidden" aria-label={caption} aria-busy={loading || undefined}>
        {showSkeleton &&
          Array.from({ length: Math.min(skeletonRows, 6) }, (_, i) => (
            <li key={i} className="space-y-2 px-4 py-3">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-3 w-48" />
            </li>
          ))}
        {list.map((row) => (
          <li
            key={rowKey(row)}
            onClick={linked ? (e) => open(row, e) : undefined}
            className={`px-4 py-2.5 ${linked ? "cursor-pointer active:bg-sf-2" : ""} ${loading ? "opacity-60" : ""}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0 flex-1">{first?.cell(row)}</div>
              {otherPrimary.length > 0 && (
                <div className="flex flex-none items-center gap-2 text-right">
                  {otherPrimary.map((c) => (
                    <div key={c.key}>{c.cell(row)}</div>
                  ))}
                </div>
              )}
              {linked && <div className="-mr-1 flex-none">{rowAction(row)}</div>}
            </div>
            {secondary.length > 0 && (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] leading-[18px] text-ink-3 [&_*]:!text-[12px]">
                {secondary.map((c, i) => (
                  <span key={c.key} className="inline-flex min-w-0 items-center gap-1.5">
                    {i > 0 && <span aria-hidden>·</span>}
                    <span className="min-w-0 truncate text-ink-2 [&_.num]:font-normal">{c.cell(row)}</span>
                    {c.phoneLabel && <span className="-ml-0.5">{c.phoneLabel}</span>}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="md:hidden">{body}</div>

      {errorText && list.length > 0 && (
        <p role="alert" className="flex items-center gap-2 border-t border-line px-5 py-2.5 text-[13px] text-mismatch">
          <Icon name="alert" size={14} /> {errorText}
          {onRetry && (
            <button type="button" onClick={onRetry} className="ml-auto font-medium underline underline-offset-2">
              Retry
            </button>
          )}
        </p>
      )}

      {pager && pager.total > 0 && <Pager {...pager} loading={loading} />}
    </div>
  );
}

/** "1–50 of 598" with previous / next. */
export function Pager({ page, pageSize, total, onPage, loading }: PagerState & { loading?: boolean }) {
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 md:px-5">
      <p className="num text-[12.5px] font-normal text-ink-2" aria-live="polite">
        {num(from)}–{num(to)} <span className="text-ink-3">of</span> {num(total)}
      </p>
      <div className="flex gap-1.5">
        <Button size="sm" icon="chevronLeft" aria-label="Previous page" disabled={page <= 0 || loading} onClick={() => onPage(page - 1)} />
        <Button size="sm" icon="chevronRight" aria-label="Next page" disabled={page >= last || loading} onClick={() => onPage(page + 1)} />
      </div>
    </nav>
  );
}
