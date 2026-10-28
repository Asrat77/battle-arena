"use client";

// Client side of the chat contract in backend/src/chat.ts. `roomId` may be a
// room code or a match ID: the server maps a room's match to the room's chat,
// so history tells us which id messages will arrive under.

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";

export const MAX_CHARS = 200;
const SEND_TIMEOUT_MS = 8000;

export interface ChatMessage {
  id: number;
  roomId: string;
  from: { profileId: string; name: string | null };
  spectator: boolean;
  ts: number;
  kind: "text" | "reaction";
  text: string;
}

type Ack =
  | { ok: true; roomId?: string; messages?: ChatMessage[]; reactions?: string[] }
  | { ok: false; reason: string; retryAt?: number };

export function useChat(roomId: string) {
  const { socket, connected } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket || !connected) return;
    // Until history answers, messages are matched against the id we asked for.
    let chat = roomId;
    const onMessage = (m: ChatMessage) => {
      if (m?.roomId !== chat) return;
      setMessages((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
    };
    socket.on("chat:message", onMessage);
    // History after a (re)connect replaces what we had, so nothing doubles up.
    socket.emit("chat:history", { roomId }, (res: Ack) => {
      if (!res.ok) return;
      chat = res.roomId ?? roomId;
      setMessages(res.messages ?? []);
      setReactions(res.reactions ?? []);
    });
    return () => {
      socket.off("chat:message", onMessage);
    };
  }, [socket, connected, roomId]);

  const emit = useCallback(
    (event: string, payload: Record<string, unknown>) =>
      new Promise<boolean>((resolve) => {
        if (!socket) return resolve(false);
        socket.timeout(SEND_TIMEOUT_MS).emit(event, { roomId, ...payload }, (err: Error | null, res: Ack) => {
          if (err) setError("Couldn’t send. Check your connection.");
          else if (!res.ok) setError(res.reason === "slow down" ? slowDown(res.retryAt) : res.reason);
          else setError(null);
          resolve(!err && res.ok);
        });
      }),
    [socket, roomId],
  );

  const send = useCallback((text: string) => emit("chat:send", { text }), [emit]);
  const react = useCallback((emoji: string) => emit("chat:react", { emoji }), [emit]);

  return { messages, reactions, send, react, error };
}

function slowDown(retryAt?: number): string {
  if (!retryAt) return "Slow down a little, then try again.";
  return `Slow down. Try again in ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))} s.`;
}
