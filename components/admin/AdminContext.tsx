"use client";

// What the console shell knows and every screen may read: the signed-in
// admin (name, when the session ends), the wallet mode, the live counts from
// the overview (badges), sign-out, and the breadcrumb's last step.

import { createContext, useContext, useEffect } from "react";
import type { Book, Overview } from "@/lib/admin/types";

export interface AdminSession {
  name: string | null;
  expiresAt: number | null;
  /** The wallet's mode (real or play money), once known. */
  mode: Book | null;
  /** Live counts from GET overview `now`, refreshed every minute; null until loaded. */
  now: Overview["now"] | null;
  signOut(): Promise<void>;
}

export const AdminSessionContext = createContext<AdminSession | null>(null);

export function useAdminSession(): AdminSession {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error("useAdminSession outside the admin console layout");
  return ctx;
}

export const CrumbContext = createContext<((leaf: string | null) => void) | null>(null);

/** Name the breadcrumb's last step on a detail page, e.g. useAdminCrumb(player ? `@${player.username}` : null). */
export function useAdminCrumb(leaf: string | null | undefined) {
  const set = useContext(CrumbContext);
  useEffect(() => {
    set?.(leaf ?? null);
    return () => set?.(null);
  }, [leaf, set]);
}
