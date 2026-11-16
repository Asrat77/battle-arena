"use client";

// A detail panel: slides in from the right on desktop, a bottom sheet on
// phones. Labelled by its title, focus trapped, Escape and the scrim close it.

import { useId, useRef } from "react";
import { Button } from "./Button";
import { Scrim, useFocusTrap, useScrollLock } from "./Overlay";

export function Drawer({
  open,
  title,
  subtitle,
  children,
  footer,
  onClose,
  width = "md",
}: {
  open: boolean;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  /** Sticky actions at the bottom. */
  footer?: React.ReactNode;
  onClose(): void;
  width?: "md" | "lg";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open, onClose);
  useScrollLock(open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]">
      <Scrim onClose={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`anim-sheet absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-line bg-sf outline-none md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-full md:rounded-none md:border-l md:border-t-0 ${
          width === "lg" ? "md:max-w-[640px]" : "md:max-w-[480px]"
        }`}
      >
        <div className="mx-auto mt-2 h-1 w-10 flex-none rounded-full bg-sf-3 md:hidden" aria-hidden />
        <header className="flex flex-none items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-[16px] font-semibold text-ink">
              {title}
            </h2>
            {subtitle && <div className="mt-0.5 text-[13px] text-ink-2">{subtitle}</div>}
          </div>
          <Button variant="ghost" size="sm" icon="close" aria-label="Close" onClick={onClose} className="-mr-2 -mt-1" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-none flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</footer>}
      </div>
    </div>
  );
}
