"use client";

// Room chat under the seats (contract in backend/src/chat.ts). Players chat by
// room code; spectators of the room's match land in the same conversation and
// are tagged "watching". Reactions are one-tap tiles above the input.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { useSession } from "@/lib/session";

const MAX_CHARS = 200;
const SEND_TIMEOUT_MS = 8000;

interface ChatMessage {
  id: number;
  roomId: string;
  from: { profileId: string; name: string | null };
  spectator: boolean;
  ts: number;
  kind: "text" | "reaction";
  text: string;
}

type Ack = { ok: true; messages?: ChatMessage[]; reactions?: string[] } | { ok: false; reason: string; retryAt?: number };

/** The server's reaction set, drawn as 3D icons where we have one. */
const REACTION_ICONS: Record<string, Icon3DName> = {
  "👍": "thumbs",
  "👏": "clap",
  "😂": "smile",
  "😮": "surprise",
  "🔥": "flame",
  "🤝": "handshake",
  "😭": "brokenheart",
};

export function RoomChat({ code, me }: { code: string; me: string }) {
  const { messages, reactions, send, react, error } = useRoomChat(code);
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    if (await send(draft)) setDraft("");
  };

  return (
    <section aria-label="Room chat" className="flex flex-col gap-2.5">
      <span className="eyebrow mt-1">Room chat</span>
      <ol
        ref={list}
        aria-live="polite"
        className="flex max-h-[260px] min-h-[64px] flex-col gap-2 overflow-y-auto"
      >
        {messages.length === 0 && (
          <li className="py-3 text-center text-small text-ink-2">Say hi. Spectators can chat here too.</li>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} mine={m.from.profileId === me} />
        ))}
      </ol>
      {reactions.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto" role="group" aria-label="Reactions">
          {reactions.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => react(r)}
              aria-label={`React ${r}`}
              className="flex h-10 w-10 flex-none items-center justify-center rounded-[13px] bg-sf text-[13px] font-semibold active:scale-95 [.light_&]:shadow-[0_0_0_1px_rgb(var(--ln))]"
            >
              {REACTION_ICONS[r] ? <Icon3D name={REACTION_ICONS[r]} size={26} /> : r}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          className="input h-12 flex-1 text-[15px]"
          placeholder="Message"
          aria-label="Message"
          maxLength={MAX_CHARS}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" variant="sec" className="h-12" disabled={!draft.trim()}>
          Send
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-small font-semibold text-mismatch">
          {error}
        </p>
      )}
    </section>
  );
}

function Bubble({ message: m, mine }: { message: ChatMessage; mine: boolean }) {
  const icon = m.kind === "reaction" ? REACTION_ICONS[m.text] : undefined;
  return (
    <li
      className={`max-w-[82%] rounded-[18px] px-[13px] py-[9px] text-[14px] leading-[1.35] ${
        mine ? "self-end bg-you-soft" : "self-start bg-sf [.light_&]:shadow-[0_0_0_1px_rgb(var(--ln))]"
      }`}
    >
      {!mine && (
        <small className="mb-px block text-[11px] font-semibold text-ink-3">
          {m.from.name ?? "Player"}
          {m.spectator && " · watching"}
        </small>
      )}
      {icon ? <Icon3D name={icon} size={24} label={m.text} /> : <span className="break-words">{m.text}</span>}
    </li>
  );
}

function useRoomChat(code: string) {
  const { socket, connected } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket || !connected) return;
    const onMessage = (m: ChatMessage) => {
      if (m?.roomId !== code) return;
      setMessages((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
    };
    socket.on("chat:message", onMessage);
    // History after a (re)connect replaces what we had, so nothing doubles up.
    socket.emit("chat:history", { roomId: code }, (res: Ack) => {
      if (!res.ok) return;
      setMessages(res.messages ?? []);
      setReactions(res.reactions ?? []);
    });
    return () => {
      socket.off("chat:message", onMessage);
    };
  }, [socket, connected, code]);

  const emit = useCallback(
    (event: string, payload: Record<string, unknown>) =>
      new Promise<boolean>((resolve) => {
        if (!socket) return resolve(false);
        socket.timeout(SEND_TIMEOUT_MS).emit(event, { roomId: code, ...payload }, (err: Error | null, res: Ack) => {
          if (err) setError("Couldn’t send. Check your connection.");
          else if (!res.ok) setError(res.reason === "slow down" ? "Slow down a little, then try again." : res.reason);
          else setError(null);
          resolve(!err && res.ok);
        });
      }),
    [socket, code],
  );

  const send = useCallback((text: string) => emit("chat:send", { text }), [emit]);
  const react = useCallback((emoji: string) => emit("chat:react", { emoji }), [emit]);

  return { messages, reactions, send, react, error };
}
