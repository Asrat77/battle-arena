"use client";

// The "Needs attention" strip under the overview header: amber and red chips for
// what needs the owner (deposits in review, pending withdrawals, books that do
// not balance, unsaved writes), then calm chips (books balance, live now). When
// nothing needs action it says so in one quiet row. The logic is in lib/admin/overview.ts.

import Link from "next/link";
import { Icon } from "@/components/admin/icons";
import { Skeleton } from "@/components/admin/Skeleton";
import { attentionItems, calmItems, type AttentionItem, type AttentionTone, type ReconcileLite } from "@/lib/admin/overview";
import type { Overview } from "@/lib/admin/types";

const CHIP: Record<AttentionTone, string> = {
  alert: "border-mismatch/50 bg-mismatch-soft hover:border-mismatch",
  warn: "border-pending/50 bg-pending-soft hover:border-pending",
  ok: "border-line bg-sf-2 hover:border-ink-3",
  neutral: "border-line bg-sf-2 hover:border-ink-3",
};
const DOT: Record<AttentionTone, string> = {
  alert: "bg-mismatch",
  warn: "bg-pending",
  ok: "bg-recorded",
  neutral: "bg-ink-3",
};

function Chip({ item, live = false }: { item: AttentionItem; live?: boolean }) {
  return (
    <Link
      href={item.href}
      className={`group flex min-h-[44px] min-w-0 items-center gap-2 rounded-lg border px-2.5 transition-colors lg:min-h-[40px] ${CHIP[item.tone]}`}
    >
      <span className={`relative h-2 w-2 flex-none rounded-full text-recorded ${DOT[item.tone]} ${live ? "ping" : ""}`} aria-hidden />
      {item.label && <span className="label !text-[10.5px]">{item.label}</span>}
      <span className={`num truncate text-[13px] ${item.tone === "alert" ? "text-mismatch" : item.tone === "warn" ? "text-pending" : "text-ink"}`}>{item.text}</span>
      {item.detail && <span className="truncate text-[12.5px] text-ink-2">{item.detail}</span>}
      <Icon name="chevronRight" size={14} className="ml-auto flex-none text-ink-3 transition-transform group-hover:translate-x-0.5 lg:hidden xl:block" />
    </Link>
  );
}

export function AttentionStrip({
  now,
  reconcile,
  reconcileFailed,
}: {
  now: Overview["now"] | null;
  reconcile: ReconcileLite | null;
  reconcileFailed: boolean;
}) {
  if (!now) {
    return (
      <div className="mb-4 rounded-[10px] border border-line bg-sf p-2 lg:mb-5" aria-busy>
        <Skeleton className="h-10 w-full" label="Loading what needs attention" />
      </div>
    );
  }
  const need = attentionItems(now, reconcile);
  const calm = calmItems(now, reconcile);
  return (
    <section aria-label="Needs attention" className="mb-4 flex flex-col gap-2 rounded-[10px] border border-line bg-sf p-2 lg:mb-5 lg:flex-row lg:flex-wrap lg:items-center">
      <h2 className="label px-2 py-1 lg:sr-only">{need.length ? "Needs attention" : "All clear"}</h2>
      {need.length === 0 && (
        <p className="flex min-h-[44px] items-center gap-2 px-1 text-[13.5px] text-ink lg:min-h-[40px]">
          <Icon name="check" size={16} className="text-recorded" />
          Nothing needs you right now
        </p>
      )}
      {need.map((item) => (
        <Chip key={item.id} item={item} />
      ))}
      {calm.map((item) => (
        <Chip key={item.id} item={item} live={item.id === "live" && now.liveMatches > 0} />
      ))}
      {reconcileFailed && !reconcile && (
        <Chip item={{ id: "books", tone: "neutral", label: "Books", text: "Check unavailable", href: "/admin/reconcile" }} />
      )}
    </section>
  );
}
