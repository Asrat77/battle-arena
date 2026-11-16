"use client";

// The console frame around every signed-in admin screen: loads who is signed
// in (a 401 goes to the login page), the wallet mode and the live badge counts
// (every 60 s, quietly), and lays out the sidebar (a drawer below lg), the
// sticky top bar and the page. Ctrl/Cmd+K opens the search.

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminGet, adminSession, toLogin } from "@/lib/admin/api";
import { AdminPrefsProvider } from "@/lib/admin/prefs";
import type { Book, Overview, WalletSummary } from "@/lib/admin/types";
import { AdminSessionContext, CrumbContext, type AdminSession } from "./AdminContext";
import { Scrim, useFocusTrap, useScrollLock } from "./Overlay";
import { SearchDialog } from "./SearchDialog";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const POLL_MS = 60_000;

function useConsoleData() {
  const [who, setWho] = useState<{ name: string | null; expiresAt: number | null }>({ name: null, expiresAt: null });
  const [mode, setMode] = useState<Book | null>(null);
  const [now, setNow] = useState<Overview["now"] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    adminSession.whoami(ctrl.signal).then(
      (w) => setWho(w),
      () => {}, // a 401 already went to the login page
    );
    adminGet<WalletSummary>("wallet/summary", undefined, ctrl.signal).then(
      (s) => setMode(s.mode),
      () => {},
    );
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    let ctrl = new AbortController();
    const load = () => {
      ctrl.abort();
      ctrl = new AbortController();
      adminGet<Overview>("overview", { days: 1 }, ctrl.signal).then(
        (o) => setNow(o.now),
        () => {}, // badges fail quietly
      );
    };
    load();
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => {
      ctrl.abort();
      window.clearInterval(id);
    };
  }, []);

  // Back to the login page the moment the session ends.
  useEffect(() => {
    if (!who.expiresAt) return;
    const ms = who.expiresAt - Date.now();
    if (ms > 2 ** 31 - 1) return;
    const t = window.setTimeout(toLogin, Math.max(0, ms));
    return () => window.clearTimeout(t);
  }, [who.expiresAt]);

  return { who, mode, now };
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { who, mode, now } = useConsoleData();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [leaf, setLeaf] = useState<string | null>(null);
  const drawer = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenu(false), []);
  useFocusTrap(drawer, menu, closeMenu);
  useScrollLock(menu);
  useEffect(() => setMenu(false), [pathname]);

  // Close the drawer if the window grows to desktop.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => mq.matches && setMenu(false);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenu(false);
        setSearch((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const session = useMemo<AdminSession>(
    () => ({
      name: who.name,
      expiresAt: who.expiresAt,
      mode,
      now,
      signOut: async () => {
        try {
          await adminSession.signOut();
        } catch {
          // the cookie is cleared server side either way
        }
        window.location.assign("/admin/login");
      },
    }),
    [who, mode, now],
  );

  return (
    <AdminSessionContext.Provider value={session}>
      <AdminPrefsProvider defaultBook={mode}>
        <CrumbContext.Provider value={setLeaf}>
          <a href="#admin-main" className="sr-only z-[90] rounded-lg bg-accent px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
            Skip to content
          </a>
          <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:bg-[linear-gradient(to_right,rgb(var(--sf))_247px,rgb(var(--ln))_247px,rgb(var(--ln))_248px,transparent_248px)]">
            <aside className="sticky top-0 hidden h-screen border-r border-line bg-sf lg:block">
              <Sidebar />
            </aside>

            {menu && (
              <div className="fixed inset-0 z-50 lg:hidden">
                <Scrim onClose={closeMenu} />
                <div
                  ref={drawer}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Admin menu"
                  className="anim-left absolute inset-y-0 left-0 flex w-[min(300px,86vw)] flex-col border-r border-line bg-sf"
                >
                  <div className="min-h-0 flex-1">
                    <Sidebar onNavigate={closeMenu} onClose={closeMenu} />
                  </div>
                </div>
              </div>
            )}

            <div className="flex min-h-screen min-w-0 flex-col">
              <TopBar onOpenMenu={() => setMenu(true)} onOpenSearch={() => setSearch(true)} leaf={leaf} />
              <main id="admin-main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-16 pt-5 outline-none lg:px-6 lg:pt-6">
                {children}
              </main>
            </div>
          </div>
          <SearchDialog open={search} onClose={() => setSearch(false)} />
        </CrumbContext.Provider>
      </AdminPrefsProvider>
    </AdminSessionContext.Provider>
  );
}
