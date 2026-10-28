"use client";

// The chat itself: a message list, the server's reaction set as one-tap tiles,
// and a 200-character input. Players and spectators of the same room or match
// share one conversation; spectators are tagged "watching". Rooms put it under
// the seats and the match frame puts it in a sheet or side panel.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { MAX_CHARS, useChat, type ChatMessage } from "@/lib/useChat";

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

export function ChatPanel({
  roomId,
  me,
  label = "Chat",
  className = "",
  listClass = "min-h-[64px] flex-1",
}: {
  /** A room code, or a match ID (quick matches and spectators). */
  roomId: string;
  me: string;
  label?: string;
  className?: string;
  listClass?: string;
}) {
  const { messages, reactions, send, react, error } = useChat(roomId);
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
    <section aria-label={label} className={`flex min-h-0 flex-col gap-2.5 ${className}`}>
      <ol
        ref={list}
        aria-live="polite"
        className={`flex flex-col gap-2 overflow-y-auto ${listClass}`}
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
        {draft.length >= MAX_CHARS - 40 && (
          <span aria-live="polite" className="font-mono text-[11px] text-ink-3">
            {MAX_CHARS - draft.length}
          </span>
        )}
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
