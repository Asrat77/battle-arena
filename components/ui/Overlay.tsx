"use client";

// Dialog (centred, for anything destructive: forfeit, leave room, remove
// friend; never window.confirm) and Sheet (floating bottom sheet for rules,
// chat, friends). Both close on Escape and on the scrim.

import { useEffect, useId, useRef } from "react";
import { Icon3D, type Icon3DName } from "./Icon3D";

function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("button, a[href], input, [tabindex]");
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [open, onClose]);
  return ref;
}

function Scrim({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      tabIndex={-1}
      className="fixed inset-0 z-40 cursor-default"
      style={{ background: "var(--scrim)" }}
      onClick={onClose}
    />
  );
}

export function Dialog({
  open,
  onClose,
  icon,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  icon?: Icon3DName;
  title: string;
  children?: React.ReactNode;
  /** Usually two Buttons: the safe choice first, the destructive one second. */
  actions: React.ReactNode;
}) {
  const ref = useModal(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <>
      <Scrim onClose={onClose} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 animate-pop flex-col gap-3.5 rounded-sheet bg-sf p-6 shadow-float"
      >
        {icon && <Icon3D name={icon} size={64} />}
        <h2 id={titleId} className="text-[22px] font-semibold leading-[1.15] tracking-[-.03em]">
          {title}
        </h2>
        {children && <div className="text-ink-2">{children}</div>}
        <div className="flex items-center gap-2 [&>*]:flex-1">{actions}</div>
      </div>
    </>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useModal(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <>
      <Scrim onClose={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-x-2 bottom-2 z-50 mx-auto flex max-h-[85vh] max-w-[560px] animate-slide flex-col gap-3.5 overflow-y-auto rounded-sheet bg-sf px-[18px] pb-5 pt-2.5 shadow-float"
      >
        <span className="h-[5px] w-10 self-center rounded bg-sf-3" aria-hidden />
        <h2 id={titleId} className="text-h2">
          {title}
        </h2>
        {children}
      </div>
    </>
  );
}
