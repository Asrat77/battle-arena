"use client";

// The confirm step before a write: an accessible modal (labelled, focus
// trapped, Escape closes) with an optional "type X to confirm" field. The
// confirm handler may be async; its error shows inside the dialog.

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./Button";
import { Icon } from "./icons";
import { Scrim, useFocusTrap, useScrollLock } from "./Overlay";

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  confirmText,
  confirmTextLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  /** When set, the admin must type exactly this before Confirm enables. */
  confirmText?: string;
  confirmTextLabel?: string;
  /** May return a promise; a thrown Error's message is shown and the dialog stays open. */
  onConfirm(): void | Promise<void>;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTyped("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const close = () => !busy && onClose();
  useFocusTrap(ref, open, close);
  useScrollLock(open);
  if (!open) return null;

  const ready = !confirmText || typed.trim() === confirmText;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <Scrim onClose={close} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={children ? bodyId : undefined}
        className="anim-dialog relative w-full max-w-[440px] rounded-t-2xl border border-line bg-sf pb-[env(safe-area-inset-bottom)] sm:rounded-xl"
      >
        <form onSubmit={submit}>
          <div className="flex items-start gap-3 px-5 pt-5">
            {tone === "danger" && (
              <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-mismatch-soft text-mismatch">
                <Icon name="alert" size={16} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[16px] font-semibold text-ink">
                {title}
              </h2>
              {children && (
                <div id={bodyId} className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                  {children}
                </div>
              )}
            </div>
          </div>
          {confirmText && (
            <label className="mt-4 block px-5">
              <span className="text-[13px] text-ink-2">
                {confirmTextLabel ?? (
                  <>
                    Type <span className="num rounded bg-sf-2 px-1 py-0.5 text-ink">{confirmText}</span> to confirm
                  </>
                )}
              </span>
              <input
                data-autofocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="num mt-1.5 h-11 w-full rounded-lg border border-line bg-sf-2 px-3 text-[14px] text-ink outline-none focus:border-accent lg:h-10"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="mx-5 mt-4 rounded-lg border border-mismatch/40 bg-mismatch-soft px-3 py-2 text-[13px] text-mismatch">
              {error}
            </p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={close} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant={tone === "danger" ? "danger" : "primary"} disabled={!ready} loading={busy}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
