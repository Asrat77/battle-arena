"use client";

// The bell in the top bar. Desktop opens a popover under it; phones open a
// bottom sheet. Opening it marks everything read, but rows that were new stay
// highlighted until it is closed.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button } from "@/components/ui/Button";
import { Icon3D } from "@/components/ui/Icon3D";
import { Sheet } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { type InboxItem, useInbox } from "./InboxProvider";

const INVITE_LIVE_MS = 30 * 60 * 1000;

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function useIsDesktop() {
  const [yes, setYes] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(min-width: 768px)");
    const on = () => setYes(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return yes;
}

export function InboxBell() {
  const inbox = useInbox();
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const [since, setSince] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Desktop popover: focus moves into it on open and returns to the bell on Escape.
  useEffect(() => {
    if (open && desktop) panel.current?.focus();
  }, [open, desktop]);

  const show = () => {
    setSince(inbox.seenAt);
    inbox.markRead();
    setOpen(true);
  };
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open || !desktop) return;
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, desktop]);

  // Anything that arrives while the panel is open is read too.
  useEffect(() => {
    if (open && inbox.unread > 0) inbox.markRead();
  }, [open, inbox]);

  const n = inbox.unread;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        ref={trigger}
        aria-label={n ? `Notifications, ${n} new` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : show())}
        className="relative inline-flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-sf transition-colors md:bg-sf-2 md:hover:bg-sf-3 lg:h-12 lg:w-12"
      >
        <Icon3D name="notification" size={28} className="lg:h-8 lg:w-8" />
        {n > 0 && (
          <span aria-hidden className="absolute right-[3px] top-[3px] flex h-[17px] min-w-[17px] items-center justify-center rounded-[9px] bg-accent px-1 font-mono text-[10px] font-bold text-accent-ink shadow-[0_0_0_2px_rgb(var(--bg))]">
            {n > 9 ? "9+" : n}
          </span>
        )}
      </button>
      {open && desktop && (
        <div
          ref={panel}
          tabIndex={-1}
          role="dialog"
          aria-label="Notifications"
          className="outline-none glass absolute right-0 top-[calc(100%+8px)] z-40 flex max-h-[min(70vh,560px)] w-[400px] animate-drop flex-col gap-2 overflow-y-auto rounded-[20px] p-3"
        >
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[17px] font-semibold tracking-[-.02em]">Notifications</h2>
            {inbox.items.length > 0 && (
              <button type="button" className="text-sm text-ink-2 hover:text-ink" onClick={inbox.clear}>
                Clear all
              </button>
            )}
          </div>
          <InboxList since={since} onNavigate={close} />
        </div>
      )}
      {!desktop &&
        // Portalled: the header's backdrop blur would otherwise trap the fixed sheet inside it.
        createPortal(
        <Sheet open={open} onClose={close} title="Notifications">
          {inbox.items.length > 0 && (
            <button type="button" className="-mt-2 self-start text-sm text-ink-2" onClick={inbox.clear}>
              Clear all
            </button>
          )}
          <InboxList since={since} onNavigate={close} />
        </Sheet>,
        document.body,
        )}
    </div>
  );
}

function InboxList({ since, onNavigate }: { since: number; onNavigate: () => void }) {
  const { items } = useInbox();
  const now = Date.now();
  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Icon3D name="notification" size={56} />
        <b className="font-semibold">You’re all caught up</b>
        <p className="max-w-[260px] text-sm text-ink-2">Friend requests, room invites and new badges show up here.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((i) => (
        <Row key={i.key} item={i} isNew={i.at > since} now={now} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}

function Row({ item, isNew, now, onNavigate }: { item: InboxItem; isNew: boolean; now: number; onNavigate: () => void }) {
  const { requests, friendIds, accept, decline, remove } = useInbox();
  const toast = useToast();
  const [working, setWorking] = useState(false);
  const pid = item.profileId ?? "";
  const who = <b className="font-semibold">{item.name ?? "Someone"}</b>;

  const answer = async (fn: (id: string) => Promise<string | null>) => {
    setWorking(true);
    const err = await fn(pid);
    setWorking(false);
    if (err) toast.show({ icon: "warning", tone: "warn", body: err });
  };

  let text: React.ReactNode;
  let action: React.ReactNode = null;
  if (item.kind === "friendRequest") {
    const pending = requests.incoming.some((r) => r.profileId === pid);
    text = pending ? <>{who} sent you a friend request</> : friendIds.has(pid) ? <>{who} is your friend</> : <>{who} sent a friend request (no longer pending)</>;
    if (pending)
      action = (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => answer(decline)} disabled={working}>
            Decline
          </Button>
          <Button size="sm" variant="act" onClick={() => answer(accept)} loading={working}>
            Accept
          </Button>
        </div>
      );
  } else if (item.kind === "friendAccepted") {
    text = <>{who} accepted your friend request</>;
    action = (
      <Link href={`/profile/${pid}`} onClick={onNavigate} className="btn btn-sm btn-sec">
        View profile
      </Link>
    );
  } else if (item.kind === "invite") {
    const live = now - item.at < INVITE_LIVE_MS;
    text = (
      <>
        {who} invited you to {item.gameName}
        {!live && <span className="text-ink-3"> · expired?</span>}
      </>
    );
    if (live && item.link)
      action = (
        <Link href={item.link} onClick={onNavigate} className="btn btn-sm btn-act">
          Join
        </Link>
      );
  } else {
    text = (
      <>
        You earned the <b className="font-semibold">{item.title}</b> badge
      </>
    );
    action = (
      <Link href="/profile" onClick={onNavigate} className="btn btn-sm btn-sec">
        See badge
      </Link>
    );
  }

  return (
    <li className={`flex items-start gap-3 rounded-[14px] p-2.5 ${isNew ? "bg-sf-2" : ""}`}>
      {item.kind === "badge" ? <Icon3D name="medalgold" size={40} /> : <Avatar3D id={pid} />}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="text-sm leading-snug">{text}</div>
        <div className="flex items-center justify-between gap-2">
          {action ?? <span />}
          <span className="whitespace-nowrap text-xs text-ink-3">{ago(item.at, now)}</span>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] text-ink-3 hover:bg-sf-3"
        onClick={() => remove(item.key)}
      >
        <span aria-hidden>✕</span>
      </button>
    </li>
  );
}
