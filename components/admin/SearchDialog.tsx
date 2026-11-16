"use client";

// The Ctrl/Cmd+K search. For now it finds players (name, @username or id
// prefix) through GET users?q= and opens the player page; matches and
// deposit references are added in a later task.

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useAdminQuery } from "@/lib/admin/api";
import type { Page, UserRow } from "@/lib/admin/types";
import { Icon } from "./icons";
import { Scrim, useFocusTrap, useScrollLock } from "./Overlay";
import { AdminAvatar } from "./PlayerCell";
import { StatusPill } from "./StatusPill";

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

  const { data, loading, error } = useAdminQuery<Page<UserRow>>(open && q ? "users" : null, { q, limit: 8 });
  const rows = q ? (data?.rows ?? []) : [];
  useEffect(() => setCursor(0), [q, data]);

  if (!open) return null;

  const go = (row: UserRow) => {
    onClose();
    router.push(`/admin/players/${encodeURIComponent(row.id)}`);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-3 pt-[10vh] sm:pt-[14vh]">
      <Scrim onClose={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Search players" className="anim-pop relative w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-sf shadow-[0_24px_60px_rgb(0_0_0/.5)]">
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
            placeholder="Player name, @username or id"
            aria-label="Search players"
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
        <ul id={listId} role="listbox" aria-label="Players" className="max-h-[50vh] overflow-y-auto p-1.5">
          {rows.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(r)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 ${i === cursor ? "bg-sf-2" : ""}`}
            >
              <AdminAvatar id={r.id} avatar={r.avatar} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">{r.name}</span>
                <span className="block truncate font-mono text-[12px] text-ink-3">@{r.username}</span>
              </span>
              <StatusPill status={r.status} />
              {i === cursor && <Icon name="chevronRight" size={16} className="text-ink-3" />}
            </li>
          ))}
        </ul>
        {q && !loading && rows.length === 0 && (
          <p className="px-4 pb-5 pt-3 text-center text-[13px] text-ink-2">{error ? error.message : `No player matches “${q}”.`}</p>
        )}
        {!q && <p className="px-4 pb-4 pt-1 text-[12.5px] text-ink-3">Type a name, @username or the start of a player id. Matches and deposit references come later.</p>}
      </div>
    </div>
  );
}
