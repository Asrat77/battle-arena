import type { Icon3DName } from "@/components/ui/Icon3D";

export interface Tab {
  href: string;
  /** Desktop top bar label. */
  label: string;
  /** Mobile dock label (shown on the active tab only). */
  short: string;
  icon: Icon3DName;
}

export const TABS: Tab[] = [
  { href: "/", label: "Play", short: "Play", icon: "controller" },
  { href: "/leaderboard", label: "Leaderboard", short: "Ranks", icon: "podium" },
  { href: "/tournaments", label: "Tournaments", short: "Cups", icon: "trophy" },
  { href: "/ledger", label: "Ledger", short: "Ledger", icon: "blockchain" },
  { href: "/profile", label: "Profile", short: "Me", icon: "idcard" },
];

export function activeTab(pathname: string): Tab | undefined {
  return TABS.find((t) => (t.href === "/" ? pathname === "/" : pathname === t.href || pathname.startsWith(`${t.href}/`)));
}

/** Screens that also get the mobile dock: the tabs plus friends. */
export function hasDock(pathname: string): boolean {
  return Boolean(activeTab(pathname)) || pathname.startsWith("/friends");
}

/**
 * Full-screen flows that draw their own header on mobile (MatchFrame, replay,
 * room, queue). Add a prefix here once its screen ships its own header.
 */
export const BARE_ON_MOBILE: string[] = [];
