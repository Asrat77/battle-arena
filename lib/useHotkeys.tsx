"use client";

// Desktop keyboard play: one window listener for a match screen. Keys are
// ignored while typing in a field, with Ctrl/Cmd/Alt held, or while a dialog
// or sheet is open. Enter and Space also leave a focused button or link alone,
// so they keep their native click (the keypad opts out: Enter there submits).

import { useEffect, useRef, type ReactNode } from "react";

/** Returns true when the key was used (the event is then cancelled). */
export type HotkeyHandler = (e: KeyboardEvent) => boolean;

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function onControl(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el?.closest?.("button, a[href], [role=button]") && !el?.closest?.("[data-keypad]");
}

export function useHotkeys(handler: HotkeyHandler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (typing(e.target) || document.querySelector("[role=dialog], [aria-modal=true]")) return;
      if ((e.key === "Enter" || e.key === " ") && onControl(e.target)) return;
      if (ref.current(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** Small key label, shown only where there is a physical keyboard. */
export const KEY_HINT_CLASS = "hidden [@media(hover:hover)_and_(pointer:fine)]:inline-flex";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className={`${KEY_HINT_CLASS} mono ml-1.5 items-center rounded-[5px] bg-black/15 px-1.5 py-px text-[11px] font-medium opacity-70`}>
      {children}
    </kbd>
  );
}
