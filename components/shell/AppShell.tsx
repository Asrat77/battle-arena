"use client";

// The app chrome. Mobile: a slim top bar (wordmark, points, friends) and a
// floating glass dock with the five tabs. Desktop (md+): one sticky top bar
// with the same tabs, labelled. Signed out, only the wordmark shows.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { CountDot } from "@/components/ui/Button";
import { useInviteToasts } from "@/components/room/useInviteToasts";
import { Icon3D } from "@/components/ui/Icon3D";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { activeTab, BARE_ON_MOBILE, hasDock, TABS } from "./nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { profile } = useSession();
  const { points, online } = useShellCounts();
  useInviteToasts();
  const dock = Boolean(profile) && hasDock(pathname);
  const bareMobile = BARE_ON_MOBILE.some((p) => pathname.startsWith(p));
  const current = activeTab(pathname);

  return (
    <>
      <header
        className={`sticky top-0 z-30 border-b border-white/[.07] bg-bg/80 backdrop-blur-[18px] [.light_&]:border-black/[.08] ${
          bareMobile ? "hidden md:block" : ""
        }`}
      >
        <div className="mx-auto flex min-h-[60px] max-w-[1280px] items-center gap-5 px-3 pl-4 md:min-h-[68px] md:px-6">
          <Link href="/" className="flex items-center gap-2 text-[18px] font-semibold tracking-[-.04em] md:text-[19px]">
            <Icon3D name="swords" size={28} />
            Battle Arena
          </Link>
          {profile && (
            <nav aria-label="Main" className="hidden flex-1 gap-1 md:flex">
              {TABS.map((t) => {
                const on = t === current;
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    aria-current={on ? "page" : undefined}
                    className={`group flex h-11 items-center gap-2 rounded-[14px] pl-2 pr-3.5 text-[14.5px] font-semibold ${
                      on ? "bg-sf-2 text-ink" : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    <Icon3D name={t.icon} size={28} className={on ? "" : "opacity-75 grayscale-[.9] group-hover:grayscale-0"} />
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          )}
          {profile && (
            <div className="ml-auto flex items-center gap-2 md:ml-0">
              <Link
                href="/profile"
                aria-label={points === null ? "Points" : `${points} points`}
                className="inline-flex h-[38px] items-center gap-1.5 rounded-chip bg-sf pl-1.5 pr-3 font-mono text-sm font-semibold tabular-nums md:bg-sf-2"
              >
                <Icon3D name="token" size={26} />
                {points ?? "–"}
              </Link>
              <Link
                href="/friends"
                aria-label={online ? `Friends, ${online} online` : "Friends"}
                className="relative inline-flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-sf md:bg-sf-2"
              >
                <Icon3D name="handshake" size={28} />
                {online > 0 && <CountDot count={online} />}
              </Link>
              <Link href="/profile" aria-label={`Profile: ${profile.name}`} className="hidden md:block">
                <Avatar3D id={profile.id} />
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className={`mx-auto w-full max-w-[1280px] px-4 pt-6 md:px-6 md:pb-12 ${dock ? "pb-28" : "pb-8"}`}>{children}</main>

      {dock && (
        <nav
          aria-label="Main"
          className="glass fixed inset-x-3 bottom-3 z-30 mx-auto flex h-[66px] max-w-[480px] items-center justify-between rounded-[24px] px-2 md:hidden"
        >
          {TABS.map((t) => {
            const on = t === current;
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-label={t.label}
                aria-current={on ? "page" : undefined}
                className={`flex h-[50px] min-w-[50px] items-center justify-center gap-2 rounded-[17px] text-sm font-semibold ${
                  on ? "bg-sf-2 pl-3 pr-4 text-ink" : "text-ink-2"
                }`}
              >
                <Icon3D name={t.icon} size={30} className={on ? "" : "opacity-70 brightness-[.8] grayscale-[.9]"} />
                {on && <span>{t.short}</span>}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}

interface Presence {
  profileId: string;
  status: string;
}

/** Points for the pill and friends online for the dot, kept live over the socket. */
function useShellCounts() {
  const { profile, socket } = useSession();
  const [points, setPoints] = useState<number | null>(null);
  const [online, setOnline] = useState(0);

  useEffect(() => {
    if (!profile) {
      setPoints(null);
      return;
    }
    let live = true;
    const load = () =>
      api
        .rewards(profile.id)
        .then((r) => live && setPoints(r.points))
        .catch(() => {});
    load();
    const onNotify = (n: { kind?: string }) => n?.kind === "points" && load();
    socket?.on("notify", onNotify);
    return () => {
      live = false;
      socket?.off("notify", onNotify);
    };
  }, [profile, socket]);

  useEffect(() => {
    if (!socket) {
      setOnline(0);
      return;
    }
    const status = new Map<string, string>();
    const count = () => setOnline([...status.values()].filter((s) => s !== "offline").length);
    const onFriends = (p: { friends?: Presence[] }) => {
      status.clear();
      for (const f of p?.friends ?? []) status.set(f.profileId, f.status);
      count();
    };
    const onPresence = (f: Presence) => {
      if (!status.has(f.profileId)) return;
      status.set(f.profileId, f.status);
      count();
    };
    socket.on("friends", onFriends);
    socket.on("presence", onPresence);
    return () => {
      socket.off("friends", onFriends);
      socket.off("presence", onPresence);
    };
  }, [socket]);

  return { points, online };
}
