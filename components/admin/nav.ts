// The admin sidebar's groups and items (plan section 5), and the breadcrumb
// trail for a path. One list so the sidebar, top bar and titles agree.

import type { IconName } from "./icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Live count shown as a badge: deposits in review, withdrawals pending. */
  badge?: "deposits" | "withdrawals";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Main",
    items: [
      { href: "/admin", label: "Overview", icon: "overview" },
      { href: "/admin/activity", label: "Activity", icon: "activity" },
      { href: "/admin/players", label: "Players", icon: "players" },
      { href: "/admin/matches", label: "Matches", icon: "matches" },
      { href: "/admin/tournaments", label: "Tournaments", icon: "tournaments" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/admin/wallet", label: "Wallet and ledger", icon: "wallet" },
      { href: "/admin/deposits", label: "Deposits", icon: "deposits", badge: "deposits" },
      { href: "/admin/withdrawals", label: "Withdrawals", icon: "withdrawals", badge: "withdrawals" },
      { href: "/admin/reconcile", label: "Reconcile and fees", icon: "reconcile" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/audit", label: "Audit log", icon: "audit" },
      { href: "/admin/system", label: "System health", icon: "system" },
    ],
  },
];

const EXTRA: NavItem[] = [{ href: "/admin/kit", label: "UI kit", icon: "layers" }];

/** The nav item a path belongs to (longest matching prefix). */
export function navItemFor(pathname: string): NavItem | null {
  const all = [...NAV.flatMap((g) => g.items), ...EXTRA];
  let best: NavItem | null = null;
  for (const item of all) {
    const hit = item.href === "/admin" ? pathname === "/admin" : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

export interface Crumb {
  label: string;
  href?: string;
}

/** "Admin > Players > @abebe": `leaf` names the last step on a detail page. */
export function crumbsFor(pathname: string, leaf?: string | null): Crumb[] {
  const item = navItemFor(pathname);
  const out: Crumb[] = [{ label: "Admin", href: "/admin" }];
  if (!item) return out;
  if (item.href === "/admin") return [{ label: "Admin", href: "/admin" }, { label: "Overview" }];
  const deeper = pathname.length > item.href.length + 1;
  out.push(deeper ? { label: item.label, href: item.href } : { label: item.label });
  if (deeper) out.push({ label: leaf ?? decodeURIComponent(pathname.slice(item.href.length + 1).split("/")[0]) });
  return out;
}
