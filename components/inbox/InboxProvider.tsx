"use client";

// The notifications inbox. Everything the socket sends as a `notify` that is
// about a person (friend request, accepted request, room invite, badge) is
// remembered here, so it is still there after the toast is gone. Kept per
// profile in localStorage; friend requests that arrived while you were away
// are picked up from the server's pending list. Toasts are raised here too.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";
import { useFriendsList, type Requests } from "@/lib/useFriends";

export type InboxKind = "friendRequest" | "friendAccepted" | "invite" | "badge";

export interface InboxItem {
  /** Same key for the same thing, so a repeat replaces instead of piling up. */
  key: string;
  kind: InboxKind;
  at: number;
  profileId?: string;
  name?: string | null;
  link?: string;
  gameName?: string;
  title?: string;
}

interface Inbox {
  items: InboxItem[];
  unread: number;
  /** Everything is read once the panel has been opened. */
  markRead(): void;
  remove(key: string): void;
  clear(): void;
  /** Time the panel was last read, to mark rows that were new when it opened. */
  seenAt: number;
  requests: Requests;
  friendIds: Set<string>;
  accept(id: string): Promise<string | null>;
  decline(id: string): Promise<string | null>;
}

const InboxContext = createContext<Inbox | null>(null);
const MAX = 40;
const MAX_AGE = 14 * 24 * 3600 * 1000;
const INVITE_TOAST_MS = 20_000;
const storeKey = (id: string) => `arena.inbox.${id}`;

interface Stored {
  items: InboxItem[];
  seen: number;
}

function load(id: string): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(id)) ?? "null") as Stored | null;
    if (raw && Array.isArray(raw.items)) {
      const cutoff = Date.now() - MAX_AGE;
      return { items: raw.items.filter((i) => i && i.key && i.at > cutoff).slice(0, MAX), seen: Number(raw.seen) || 0 };
    }
  } catch {
    // unreadable or blocked storage: start empty
  }
  return { items: [], seen: 0 };
}

export function InboxProvider({ children }: { children: React.ReactNode }) {
  const { profile, socket } = useSession();
  const toast = useToast();
  const { friends, requests, accept, decline } = useFriendsList();
  const [state, setState] = useState<Stored & { for: string | null }>({ items: [], seen: 0, for: null });
  const profileId = profile?.id ?? null;

  // Load this profile's inbox; empty it on sign-out.
  useEffect(() => {
    setState(profileId ? { ...load(profileId), for: profileId } : { items: [], seen: 0, for: null });
  }, [profileId]);

  useEffect(() => {
    if (!state.for) return;
    try {
      localStorage.setItem(storeKey(state.for), JSON.stringify({ items: state.items, seen: state.seen }));
    } catch {
      // storage is a convenience only
    }
  }, [state]);

  const add = useCallback((item: InboxItem) => {
    setState((s) => ({ ...s, items: [item, ...s.items.filter((i) => i.key !== item.key)].slice(0, MAX) }));
  }, []);

  // Live notifications: record them and raise the toast.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    if (!socket) return;
    const onNotify = (n: {
      kind?: string;
      from?: { profileId: string; name: string | null };
      profileId?: string;
      name?: string | null;
      code?: string;
      link?: string;
      gameName?: string;
      badge?: { id?: string; name?: string };
    }) => {
      const at = Date.now();
      const t = toastRef.current;
      if (n?.kind === "friendRequest" || n?.kind === "friendAccepted") {
        const who = n.kind === "friendRequest" ? n.from : n.profileId ? { profileId: n.profileId, name: n.name ?? null } : undefined;
        if (!who?.profileId) return;
        add({ key: `${n.kind === "friendRequest" ? "fr" : "fa"}:${who.profileId}`, kind: n.kind, at, profileId: who.profileId, name: who.name });
        t.show({
          avatar: { id: who.profileId },
          body:
            n.kind === "friendRequest" ? (
              <>
                <b>{who.name ?? "Someone"}</b> sent you a friend request
              </>
            ) : (
              <>
                <b>{who.name ?? "Someone"}</b> accepted your friend request
              </>
            ),
          action: { label: n.kind === "friendRequest" ? "Review" : "View", href: "/friends", primary: true },
          duration: INVITE_TOAST_MS,
        });
      } else if (n?.kind === "invite" && n.from && n.code) {
        add({ key: `in:${n.code}`, kind: "invite", at, profileId: n.from.profileId, name: n.from.name, link: n.link, gameName: n.gameName });
        t.show({
          avatar: { id: n.from.profileId },
          body: (
            <>
              <b>{n.from.name ?? "A friend"}</b> invited you to {n.gameName}
            </>
          ),
          action: { label: "Join", href: n.link, primary: true },
          duration: INVITE_TOAST_MS,
        });
      } else if (n?.kind === "badge" && n.badge?.id) {
        add({ key: `bd:${n.badge.id}`, kind: "badge", at, title: n.badge.name ?? "New" });
      }
    };
    socket.on("notify", onNotify);
    return () => {
      socket.off("notify", onNotify);
    };
  }, [socket, add]);

  // Requests that arrived while you were away: the server still lists them.
  useEffect(() => {
    if (!state.for || friends === null) return;
    const ids = requests.incoming.map((r) => r.profileId);
    if (!ids.length) return;
    setState((s) => {
      const have = new Set(s.items.map((i) => i.key));
      const missing = requests.incoming.filter((r) => !have.has(`fr:${r.profileId}`));
      if (!missing.length) return s;
      return {
        ...s,
        items: [
          ...missing.map((r): InboxItem => ({ key: `fr:${r.profileId}`, kind: "friendRequest", at: Date.now(), profileId: r.profileId, name: r.name })),
          ...s.items,
        ].slice(0, MAX),
      };
    });
  }, [state.for, friends, requests.incoming]);

  const markRead = useCallback(() => setState((s) => ({ ...s, seen: Date.now() })), []);
  const remove = useCallback((key: string) => setState((s) => ({ ...s, items: s.items.filter((i) => i.key !== key) })), []);
  const clear = useCallback(() => setState((s) => ({ ...s, items: [], seen: Date.now() })), []);

  const value = useMemo<Inbox>(
    () => ({
      items: state.items,
      unread: state.items.filter((i) => i.at > state.seen).length,
      markRead,
      remove,
      clear,
      seenAt: state.seen,
      requests,
      friendIds: new Set((friends ?? []).map((f) => f.profileId)),
      accept,
      decline,
    }),
    // accept/decline are fresh closures each render but only wrap a stable socket call
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.items, state.seen, requests, friends, markRead, remove, clear],
  );

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): Inbox {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error("useInbox outside InboxProvider");
  return ctx;
}
