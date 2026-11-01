"use client";

// Desktop header avatar: opens a small account menu (profile, settings, sign
// out). Guests have no way back in, so their "Sign out" goes to Settings where
// the warning lives.

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { useSession } from "@/lib/session";

export function AccountMenu() {
  const { profile, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = (restore: boolean) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };

  // Menu pattern: focus lands on the first item, arrows/Home/End move, Escape and Tab leave.
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Tab") setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close(true);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!profile) return null;
  const item =
    "flex h-10 w-full items-center rounded-[10px] px-3 text-left text-sm text-ink-2 transition-colors hover:bg-sf-3 hover:text-ink";
  return (
    <div ref={ref} className="relative hidden md:block">
      <button
        type="button"
        ref={trigger}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu: ${profile.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-[14px] transition-opacity hover:opacity-85"
      >
        <Avatar3D id={profile.id} className="lg:h-12 lg:w-12" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
          className="glass absolute right-0 top-[calc(100%+8px)] z-40 w-56 animate-drop rounded-[16px] p-1.5"
          onClick={() => setOpen(false)}
        >
          <div className="px-3 pb-2 pt-1.5">
            <div className="truncate text-sm font-semibold">{profile.name}</div>
            {profile.username && <div className="truncate text-xs text-ink-3">@{profile.username}</div>}
          </div>
          <Link role="menuitem" href="/profile" className={item}>
            View profile
          </Link>
          <Link role="menuitem" href="/settings" className={item}>
            Settings
          </Link>
          {profile.hasPassword ? (
            <button type="button" role="menuitem" className={item} onClick={signOut}>
              Sign out
            </button>
          ) : (
            <Link role="menuitem" href="/settings" className={item}>
              Sign out…
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
