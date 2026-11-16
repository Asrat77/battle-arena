"use client";

// The sticky bar over every console screen: menu button (phones), breadcrumb,
// the search field (opens the Ctrl/Cmd+K search) and the Real / Play book switch.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAdminPrefs } from "@/lib/admin/prefs";
import { Icon } from "./icons";
import { crumbsFor } from "./nav";
import { Segmented } from "./Tabs";

export function TopBar({ onOpenMenu, onOpenSearch, leaf }: { onOpenMenu(): void; onOpenSearch(): void; leaf: string | null }) {
  const pathname = usePathname() ?? "/admin";
  const crumbs = crumbsFor(pathname, leaf);
  const { book, setBook } = useAdminPrefs();
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-4 lg:h-[60px] lg:gap-3 lg:px-6">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="-ml-2 flex h-11 w-11 flex-none items-center justify-center rounded-lg text-ink-2 hover:bg-sf-2 hover:text-ink lg:hidden"
        >
          <Icon name="menu" size={20} />
        </button>

        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={i} className={`flex min-w-0 items-center gap-1.5 ${!last && i === 0 ? "hidden sm:flex" : ""} ${last ? "" : "flex-none"}`}>
                  {c.href && !last ? (
                    <Link href={c.href} className="text-ink-3 hover:text-ink">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current={last ? "page" : undefined} className={`truncate ${last ? "font-medium text-accent" : "text-ink-3"}`}>
                      {c.label}
                    </span>
                  )}
                  {!last && <Icon name="chevronRight" size={14} className="text-ink-3" />}
                </li>
              );
            })}
          </ol>
        </nav>

        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search players"
          aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-lg text-ink-2 hover:bg-sf-2 hover:text-ink md:h-9 md:w-[260px] md:justify-start md:gap-2 md:border md:border-line md:bg-sf md:px-3 md:text-left md:text-[13px] md:text-ink-3 lg:w-[300px]"
        >
          <Icon name="search" size={16} />
          <span className="hidden flex-1 md:inline">Search players…</span>
          <span className="hidden items-center gap-1 md:flex" aria-hidden>
            <kbd className="flex h-5 min-w-[20px] items-center justify-center rounded border border-line bg-sf-2 px-1 font-mono text-[10.5px] text-ink-2">{mac ? "⌘" : "Ctrl"}</kbd>
            <kbd className="flex h-5 min-w-[20px] items-center justify-center rounded border border-line bg-sf-2 px-1 font-mono text-[10.5px] text-ink-2">K</kbd>
          </span>
        </button>

        <Segmented
          label="Wallet book"
          size="sm"
          value={book}
          onChange={setBook}
          items={[
            { value: "real", label: "Real" },
            { value: "play", label: "Play" },
          ]}
        />
      </div>
    </header>
  );
}
