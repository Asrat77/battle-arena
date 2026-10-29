"use client";

// Glass toasts. Mobile: stacked under the top bar; desktop: top right. A toast
// should always lead somewhere (`href` or an action button).

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Avatar3D } from "./Avatar3D";
import { Icon3D, type Icon3DName } from "./Icon3D";

export interface ToastInput {
  /** 3D icon on the left; or `avatar` for a person. */
  icon?: Icon3DName;
  avatar?: { id: string; bot?: boolean };
  body: React.ReactNode;
  href?: string;
  action?: { label: string; onClick?: () => void; href?: string; primary?: boolean };
  tone?: "default" | "reward" | "warn";
  /** ms; 0 keeps it until dismissed. Default 5 s. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<{ show(t: ToastInput): number; dismiss(id: number): void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (t: ToastInput) => {
      const id = next.current++;
      setItems((xs) => [...xs.slice(-2), { ...t, id }]);
      const ms = t.duration ?? 5000;
      if (ms) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-2.5 top-[66px] z-[60] flex flex-col gap-2 md:left-auto md:right-6 md:top-[84px] md:w-[380px]"
      >
        {items.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const look =
    toast.tone === "reward"
      ? { background: "linear-gradient(90deg, rgb(243 181 66 / .22), rgb(243 181 66 / .06)), var(--glass)" }
      : toast.tone === "warn"
        ? { boxShadow: "var(--sh), inset 0 0 0 1px rgb(240 146 141 / .45)" }
        : undefined;
  const lead = toast.avatar ? (
    <Avatar3D id={toast.avatar.id} bot={toast.avatar.bot} size="sm" />
  ) : toast.icon ? (
    <Icon3D name={toast.icon} size={36} />
  ) : null;
  const body = <div className="min-w-0 flex-1">{toast.body}</div>;
  const a = toast.action;
  return (
    <div
      role="status"
      className="glass pointer-events-auto flex min-h-[60px] animate-drop items-center gap-3 rounded-[20px] py-2 pl-2.5 pr-2 text-sm"
      style={look}
    >
      {lead}
      {toast.href ? (
        <Link href={toast.href} className="min-w-0 flex-1" onClick={onDismiss}>
          {toast.body}
        </Link>
      ) : (
        body
      )}
      {a &&
        (a.href ? (
          <Link href={a.href} onClick={onDismiss} className={`btn btn-sm ${a.primary ? "btn-act" : "btn-sec"}`}>
            {a.label}
          </Link>
        ) : (
          <button
            type="button"
            className={`btn btn-sm ${a.primary ? "btn-act" : "btn-sec"}`}
            onClick={() => {
              a.onClick?.();
              onDismiss();
            }}
          >
            {a.label}
          </button>
        ))}
      <button
        type="button"
        aria-label="Dismiss"
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] text-base leading-none text-ink-3"
        onClick={onDismiss}
      >
        <span aria-hidden>✕</span>
      </button>
    </div>
  );
}
