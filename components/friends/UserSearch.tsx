"use client";

// Friend search that suggests as you type: a debounced combobox over
// GET /api/profiles/search. Up/down/enter pick a suggestion; with nothing
// highlighted, enter falls through to the form (exact username or pasted ID).

import { useEffect, useId, useRef, useState } from "react";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { api, type ProfileHit } from "@/lib/api";
import { useSession } from "@/lib/session";

export const SEARCH_DEBOUNCE_MS = 250;

type Relation = NonNullable<ProfileHit["relationship"]>;

export function UserSearch({
  value,
  onChange,
  error,
  hint,
  relation,
  onAdd,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  hint: React.ReactNode;
  /** Live relationship from the friends hook, so buttons update the moment you add someone. */
  relation: (profileId: string) => Relation;
  onAdd: (profileId: string) => Promise<string | null>;
}) {
  const { profile } = useSession();
  const me = profile?.id;
  const listId = useId();
  const [hits, setHits] = useState<ProfileHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const q = value.trim().replace(/^@/, "");
  const searchable = q.length >= 2 && !/^0x[0-9a-f]{40}$/i.test(q);

  useEffect(() => {
    if (!searchable) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api
        .searchProfiles(q, null, ctl.signal)
        .then((r) => {
          setHits(r.results.filter((h) => h.profileId !== me).slice(0, 8));
          setActive(-1);
          setNote(null);
        })
        .catch((e) => {
          if (ctl.signal.aborted) return;
          setHits([]);
          setNote(e instanceof Error && /too many/i.test(e.message) ? "Slow down a little." : null);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, searchable, me]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

  const add = async (hit: ProfileHit) => {
    setBusy(hit.profileId);
    const err = await onAdd(hit.profileId);
    setBusy(null);
    setNote(err);
  };

  const showList = open && searchable && hits.length > 0;
  // Spoken by screen readers as results arrive, since the list is not focused.
  const count = showList ? `${hits.length} ${hits.length === 1 ? "player" : "players"} found. Use up and down arrows, Enter to add.` : "";

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (open) e.stopPropagation(); // don't also close a sheet around the search
      return setOpen(false);
    }
    if (!showList) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((cur) => (e.key === "ArrowDown" ? (cur + 1) % hits.length : cur <= 0 ? hits.length - 1 : cur - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      const hit = hits[active];
      if (relation(hit.profileId) === "none" || relation(hit.profileId) === "incoming") void add(hit);
    }
  };

  return (
    <div ref={box} className="relative" onKeyDown={onKeyDown}>
      <Field
        label="Send a friend request"
        placeholder="Search by username or name"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        error={error}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        hint={note ?? hint}
        liveHint
      />
      <span className="sr-only" role="status" aria-live="polite">
        {count}
      </span>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching players"
          className="absolute left-0 right-0 top-[76px] z-20 max-h-[320px] overflow-y-auto rounded-card border border-line bg-sf-2 p-1 shadow-lg"
        >
          {hits.map((h, i) => {
            const rel = relation(h.profileId);
            return (
              <li
                key={h.profileId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`flex items-center gap-3 rounded-[14px] px-2 py-2 ${i === active ? "bg-sf" : ""}`}
                onMouseEnter={() => setActive(i)}
              >
                <Avatar3D id={h.profileId} size="sm" />
                <div className="min-w-0 flex-1">
                  <b className="block truncate font-semibold">{h.name}</b>
                  <span className="block truncate text-small text-ink-2">@{h.username}</span>
                </div>
                {rel === "friend" ? (
                  <span className="text-small font-semibold text-ink-2">Friends</span>
                ) : rel === "sent" ? (
                  <span className="text-small font-semibold text-ink-2">Sent</span>
                ) : (
                  <Button size="sm" variant="act" tabIndex={-1} aria-label={`${rel === "incoming" ? "Accept" : "Add"} ${h.name}`} loading={busy === h.profileId} onClick={() => add(h)}>
                    {rel === "incoming" ? "Accept" : "Add"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
