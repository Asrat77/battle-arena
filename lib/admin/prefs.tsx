"use client";

// Admin-wide choices every screen shares: which wallet book to show (real or
// play money) and the range in days (7, 30 or 90). Kept per browser; storage
// may be missing (private mode), so every read and write is guarded.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Book } from "./format";

export type RangeDays = 7 | 30 | 90;
export const RANGE_DAYS: readonly RangeDays[] = [7, 30, 90];

interface Prefs {
  book: Book;
  days: RangeDays;
  setBook(b: Book): void;
  setDays(d: RangeDays): void;
}

const KEY = "admin.prefs";
const Ctx = createContext<Prefs | null>(null);

function read(): { book?: Book; days?: RangeDays } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { book?: unknown; days?: unknown };
    return {
      book: raw.book === "real" || raw.book === "play" ? raw.book : undefined,
      days: RANGE_DAYS.includes(raw.days as RangeDays) ? (raw.days as RangeDays) : undefined,
    };
  } catch {
    return {};
  }
}

function write(p: { book?: Book; days?: RangeDays }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...p }));
  } catch {
    // not remembered; fine
  }
}

/** `defaultBook` is the wallet mode, used until the admin picks a book. */
export function AdminPrefsProvider({ children, defaultBook }: { children: React.ReactNode; defaultBook?: Book | null }) {
  const [stored, setStored] = useState<{ book?: Book; days?: RangeDays }>({});
  useEffect(() => setStored(read()), []);

  const setBook = useCallback((book: Book) => {
    setStored((s) => ({ ...s, book }));
    write({ book });
  }, []);
  const setDays = useCallback((days: RangeDays) => {
    setStored((s) => ({ ...s, days }));
    write({ days });
  }, []);

  const value = useMemo<Prefs>(
    () => ({ book: stored.book ?? defaultBook ?? "real", days: stored.days ?? 30, setBook, setDays }),
    [stored, defaultBook, setBook, setDays],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminPrefs(): Prefs {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdminPrefs outside AdminPrefsProvider");
  return ctx;
}
