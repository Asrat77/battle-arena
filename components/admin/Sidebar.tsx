"use client";

// The console's left sidebar: brand and wallet mode on top, the three nav
// groups with live badges, and the signed-in admin with the time left in the
// session and Sign out at the bottom. The same component fills the phone drawer.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { duration, num } from "@/lib/admin/format";
import { useAdminSession } from "./AdminContext";
import { Icon } from "./icons";
import { NAV, navItemFor } from "./nav";
import { useNow } from "./TimeAgo";

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size }} className="flex flex-none items-center justify-center rounded-lg bg-accent text-white">
      <Icon name="matches" size={Math.round(size * 0.56)} strokeWidth={1.8} />
    </span>
  );
}

export function ModePill({ mode }: { mode: "real" | "play" | null }) {
  if (!mode) return <span className="skeleton h-[18px] w-[74px] rounded" aria-hidden />;
  return (
    <span
      className={`inline-flex h-[18px] items-center rounded border px-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] ${
        mode === "real" ? "border-accent/50 bg-accent/10 text-accent" : "border-line bg-sf-2 text-ink-2"
      }`}
    >
      {mode === "real" ? "Real money" : "Play money"}
    </span>
  );
}

export function Sidebar({ onNavigate, onClose }: { onNavigate?(): void; /** In the phone drawer: shows a close button beside the brand. */ onClose?(): void }) {
  const pathname = usePathname() ?? "/admin";
  const { name, expiresAt, mode, now, signOut } = useAdminSession();
  const current = navItemFor(pathname);
  const clock = useNow();
  const [leaving, setLeaving] = useState(false);
  const left = expiresAt ? expiresAt - clock : null;

  const badge = (kind?: "deposits" | "withdrawals") => {
    if (!kind || !now) return null;
    const n = kind === "deposits" ? now.depositsInReview.count : now.pendingWithdrawals.count;
    if (!n) return null;
    return (
      <span
        aria-label={kind === "deposits" ? `${n} in review` : `${n} pending`}
        className={`num ml-auto min-w-[20px] rounded-full px-1.5 text-center text-[11px] leading-5 ${
          kind === "deposits" ? "bg-accent/15 text-accent" : "bg-pending/15 text-pending"
        }`}
      >
        {num(n)}
      </span>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-none px-3 pt-3">
        <div className="flex items-center gap-2">
        <Link href="/admin" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] border border-line bg-sf-2/60 px-3 py-2.5 hover:bg-sf-2">
          <BrandMark />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold leading-tight text-ink">Battle Arena</span>
            <span className="mt-0.5 flex items-center gap-1.5">
              <span className="text-[12px] text-ink-3">Admin console</span>
            </span>
          </span>
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-lg text-ink-2 hover:bg-sf-2 hover:text-ink"
          >
            <Icon name="close" size={20} />
          </button>
        )}
        </div>
        <div className="mt-2.5 flex items-center justify-between px-1">
          <span className="label !text-[10px] !text-ink-3">Wallet</span>
          <ModePill mode={mode} />
        </div>
      </div>

      <nav aria-label="Admin" className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((group) => (
          <div key={group.label} className="border-t border-line pt-3 first:border-0 first:pt-1 [&+&]:mt-3">
            <p className="mb-1.5 px-2.5 text-[12px] font-medium text-ink-3">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const on = current?.href === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={on ? "page" : undefined}
                      className={`flex h-11 items-center gap-3 rounded-lg px-2.5 text-[14px] transition-colors lg:h-9 lg:text-[13.5px] ${
                        on ? "bg-sf-2 font-medium text-accent" : "text-ink-2 hover:bg-sf-2/60 hover:text-ink"
                      }`}
                    >
                      <Icon name={item.icon} size={18} className={on ? "text-accent" : "text-ink-3"} />
                      <span className="truncate">{item.label}</span>
                      {badge(item.badge)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex-none border-t border-line p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-sf-2/60 px-3 py-2.5">
          <span className="relative flex h-8 w-8 flex-none items-center justify-center rounded-full bg-sf-3 text-[13px] font-semibold uppercase text-ink">
            {(name ?? "?").trim().charAt(0) || "?"}
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-sf bg-recorded" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium leading-tight text-ink">{name ?? "…"}</span>
            <span className="mt-0.5 block text-[12px] leading-snug text-ink-3" suppressHydrationWarning>
              {left === null ? "Signed in" : left > 0 ? `Session ends in ${duration(left).replace(/ 0?(\d+)s$/, "").replace(" ", "\u00a0")}` : "Session ended"}
            </span>
          </span>
          <button
            type="button"
            onClick={async () => {
              setLeaving(true);
              await signOut();
            }}
            disabled={leaving}
            aria-label="Sign out"
            title="Sign out"
            className="-mr-1 flex h-10 w-10 flex-none items-center justify-center rounded-lg text-ink-2 hover:bg-sf-3 hover:text-ink disabled:opacity-50 lg:h-8 lg:w-8"
          >
            <Icon name="logout" size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
