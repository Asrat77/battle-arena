"use client";

// The Ctrl/Cmd+K search. Players (name, @username or id prefix), deposits and
// withdrawals (reference, payer or account name, id), ledger transactions (txn
// id or reference) and a match (its full id) are looked up through the admin
// API as you type; Enter or a click opens the hit on its own screen.

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAdminQuery } from "@/lib/admin/api";
import { birr, dateShort, shortId, unitFor } from "@/lib/admin/format";
import { useAdminPrefs } from "@/lib/admin/prefs";
import { bankLabel } from "@/lib/admin/players";
import type { AdminDeposit, AdminWithdrawal, Page, TxnPage, UserRow } from "@/lib/admin/types";
import { Icon, type IconName } from "./icons";
import { Scrim, useFocusTrap, useScrollLock } from "./Overlay";
import { AdminAvatar } from "./PlayerCell";
import { StatusPill } from "./StatusPill";

/** What GET matches/:id returns that the search needs (recorded or live). */
interface FoundMatch {
  matchId: string;
  gameName: string;
  live?: boolean;
}

interface Hit {
  key: string;
  group: string;
  href: string;
  icon: IconName | null;
  /** Avatar for a player hit. */
  player?: UserRow;
  title: string;
  sub: string;
  status?: string;
}

/** A match id is 16 hex characters; only then is the match looked up (it needs the whole id). */
export const looksLikeMatchId = (q: string): boolean => /^[0-9a-f]{16}$/i.test(q);

const who = (p: { name: string | null; username: string | null }) => p.name ?? (p.username ? `@${p.username}` : "Player");

/** Everything the dialog can find for `q`, grouped in a fixed order. */
function useHits(q: string, enabled: boolean): { hits: Hit[]; loading: boolean; error: string | null } {
  const { book } = useAdminPrefs();
  const long = enabled && q.length >= 3;
  const users = useAdminQuery<Page<UserRow>>(enabled && q ? "users" : null, { q, limit: 6 });
  const deposits = useAdminQuery<Page<AdminDeposit>>(long ? "deposits" : null, { q, limit: 4 });
  const withdrawals = useAdminQuery<Page<AdminWithdrawal>>(long ? "withdrawals" : null, { q, limit: 4 });
  const txns = useAdminQuery<TxnPage>(long ? "wallet/transactions" : null, { q, book, limit: 4 });
  const match = useAdminQuery<FoundMatch>(long && looksLikeMatchId(q) ? `matches/${encodeURIComponent(q)}` : null);

  const hits = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    for (const u of users.data?.rows ?? []) {
      out.push({ key: `u:${u.id}`, group: "Players", href: `/admin/players/${encodeURIComponent(u.id)}`, icon: null, player: u, title: u.name, sub: `@${u.username}`, status: u.status });
    }
    if (match.data?.matchId) {
      const m = match.data;
      out.push({ key: `m:${m.matchId}`, group: "Matches", href: `/admin/matches?open=${encodeURIComponent(m.matchId)}`, icon: "matches", title: `${m.gameName} match`, sub: shortId(m.matchId, 10, 6), status: m.live ? "live" : undefined });
    }
    for (const d of deposits.data?.rows ?? []) {
      out.push({ key: `d:${d.id}`, group: "Deposits", href: `/admin/deposits?tab=all&open=${encodeURIComponent(d.id)}`, icon: "deposits", title: `${bankLabel(d.bank)} ${d.reference}`, sub: `${who(d.player)} · ${d.amount != null ? `${birr(d.amount)} ETB · ` : ""}${dateShort(d.createdAt)}`, status: d.status });
    }
    for (const w of withdrawals.data?.rows ?? []) {
      out.push({ key: `w:${w.id}`, group: "Withdrawals", href: `/admin/withdrawals?tab=all&open=${encodeURIComponent(w.id)}`, icon: "withdrawals", title: `${bankLabel(w.bank)} ${w.account}`, sub: `${who(w.player)} · ${birr(w.amount)} ETB · ${dateShort(w.createdAt)}`, status: w.status });
    }
    for (const t of txns.data?.rows ?? []) {
      out.push({ key: `t:${t.book}:${t.id}`, group: "Transactions", href: `/admin/wallet?q=${encodeURIComponent(t.id)}`, icon: "wallet", title: `${t.kind} ${birr(t.amount)} ${unitFor(t.book)}`, sub: `${t.profileId === "platform" ? "Platform" : who(t)} · ${shortId(t.id, 10, 4)}${t.ref ? ` · ${t.ref}` : ""}` });
    }
    return out;
  }, [users.data, deposits.data, withdrawals.data, txns.data, match.data]);

  const loading = [users, deposits, withdrawals, txns, match].some((x) => x.loading);
  return { hits, loading, error: users.error?.message ?? null };
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const listId = useId();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  useFocusTrap(ref, open, onClose);
  useScrollLock(open);

  useEffect(() => {
    if (!open) {
      setText("");
      setQ("");
    }
  }, [open]);
  useEffect(() => {
    const t = window.setTimeout(() => setQ(text.trim()), 200);
    return () => window.clearTimeout(t);
  }, [text]);

  const { hits, loading, error } = useHits(q, open);
  const rows = q ? hits : [];
  useEffect(() => setCursor(0), [q, hits]);

  if (!open) return null;

  const go = (hit: Hit) => {
    onClose();
    router.push(hit.href);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-3 pt-[10vh] sm:pt-[14vh]">
      <Scrim onClose={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Search" className="anim-pop relative w-full max-w-[600px] overflow-hidden rounded-xl border border-line bg-sf shadow-[0_24px_60px_rgb(0_0_0/.5)]">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Icon name="search" size={18} className="text-ink-3" />
          <input
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(rows.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter" && rows[cursor]) {
                e.preventDefault();
                go(rows[cursor]);
              }
            }}
            placeholder="Player, deposit reference, match id, transaction"
            aria-label="Search the admin site"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-activedescendant={rows[cursor] ? `${listId}-${cursor}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
          {loading && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-ink-3 border-r-transparent" />}
          <kbd className="hidden h-6 items-center rounded border border-line bg-sf-2 px-1.5 font-mono text-[11px] text-ink-3 sm:flex">Esc</kbd>
          <button type="button" onClick={onClose} aria-label="Close search" className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-ink-2 sm:hidden">
            <Icon name="close" size={18} />
          </button>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[55vh] overflow-y-auto p-1.5">
          {rows.map((r, i) => (
            <li key={r.key} role="presentation">
              {(i === 0 || rows[i - 1].group !== r.group) && <p className="label px-2.5 pb-1 pt-2.5 !text-[10.5px]">{r.group}</p>}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r)}
                className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 ${i === cursor ? "bg-sf-2" : ""}`}
              >
                {r.player ? (
                  <AdminAvatar id={r.player.id} avatar={r.player.avatar} size={30} />
                ) : (
                  <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-sf-3 text-ink-2">{r.icon && <Icon name={r.icon} size={16} />}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{r.title}</span>
                  <span className="block truncate font-mono text-[12px] text-ink-3">{r.sub}</span>
                </span>
                {r.status && <StatusPill status={r.status} />}
                {i === cursor && <Icon name="chevronRight" size={16} className="text-ink-3" />}
              </div>
            </li>
          ))}
        </ul>
        {q && !loading && rows.length === 0 && (
          <p className="px-4 pb-5 pt-3 text-center text-[13px] text-ink-2">{error ? error : `Nothing matches “${q}”.`}</p>
        )}
        {!q && (
          <p className="px-4 pb-4 pt-1 text-[12.5px] text-ink-3">
            Type a player name, @username or id, a deposit reference or payer name, a withdrawal account, a transaction id, or a full match id.
          </p>
        )}
      </div>
    </div>
  );
}
