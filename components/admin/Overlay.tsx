"use client";

// Shared behaviour for everything that sits over the page (dialogs, drawers,
// the nav drawer, search): focus moves in and is trapped, Escape closes, the
// page behind stops scrolling, and focus goes back where it was on close.

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let locks = 0;

/** Stop the page scrolling while `active` (nested overlays share one lock). */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    if (locks++ === 0) {
      const gap = window.innerWidth - document.documentElement.clientWidth;
      body.dataset.adminLock = body.style.overflow;
      body.style.overflow = "hidden";
      if (gap > 0) body.style.paddingRight = `${gap}px`;
    }
    return () => {
      if (--locks === 0) {
        body.style.overflow = body.dataset.adminLock ?? "";
        body.style.paddingRight = "";
        delete body.dataset.adminLock;
      }
    };
  }, [active]);
}

/** Keep Tab inside `ref` while active, close on Escape, and restore focus after. */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void) {
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const before = document.activeElement as HTMLElement | null;
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? root.querySelector<HTMLElement>(FOCUSABLE) ?? root;
    first.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        escape.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === head || !root.contains(document.activeElement))) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (document.activeElement === tail || !root.contains(document.activeElement))) {
        e.preventDefault();
        head.focus();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

/** The dark scrim behind an overlay; clicking it calls onClose. */
export function Scrim({ onClose, className = "" }: { onClose(): void; className?: string }) {
  return <div aria-hidden className={`anim-fade fixed inset-0 bg-black/60 ${className}`} onClick={onClose} />;
}
