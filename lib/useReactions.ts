"use client";

// Quick reactions during a match. They ride on the room chat (chat:react), so
// players and spectators share them and they count toward the chat rate limit
// (5 per 10 s). Each one arriving here floats up over the board for 1.4 s.

import { useCallback, useEffect, useState } from "react";
import { useSession } from "./session";

export interface FloatingReaction {
  id: number;
  key: string;
  name: string;
  mine: boolean;
}

interface ChatMessage {
  id: number;
  roomId: string;
  from: { profileId: string; name: string | null };
  kind: "text" | "reaction";
  text: string;
}

type Ack = { ok: true; roomId?: string; message?: ChatMessage } | { ok: false; reason: string; retryAt?: number };

export const FLOAT_MS = 1400;
/** More than this many at once and the oldest drop off early. */
const MAX_FLOATING = 6;

export function useReactions(matchId: string) {
  const { socket, connected, profile } = useSession();
  const me = profile?.id;
  /** The chat this match belongs to: its room's code, or the match ID. */
  const [chatId, setChatId] = useState<string | null>(null);
  const [floating, setFloating] = useState<FloatingReaction[]>([]);
  const [blockedUntil, setBlockedUntil] = useState(0);

  useEffect(() => {
    if (!socket || !connected) return;
    // Spectators may only ask once their match:watch has gone through, so ask
    // again whenever this match (re)starts for us.
    const ask = () =>
      socket.emit("chat:history", { roomId: matchId }, (res: Ack) => {
        if (res?.ok && res.roomId) setChatId(res.roomId);
      });
    const onStart = (msg: { matchId?: string }) => msg?.matchId === matchId && ask();
    socket.on("match:start", onStart);
    ask();
    return () => {
      socket.off("match:start", onStart);
    };
  }, [socket, connected, matchId]);

  useEffect(() => {
    if (!socket || !chatId) return;
    const onMessage = (msg: ChatMessage) => {
      if (msg?.kind !== "reaction" || (msg.roomId !== chatId && msg.roomId !== matchId)) return;
      const mine = msg.from.profileId === me;
      const item = { id: msg.id, key: msg.text, name: mine ? "You" : (msg.from.name ?? "Player"), mine };
      setFloating((xs) => [...xs.slice(-(MAX_FLOATING - 1)), item]);
      setTimeout(() => setFloating((xs) => xs.filter((x) => x.id !== msg.id)), FLOAT_MS);
    };
    socket.on("chat:message", onMessage);
    return () => {
      socket.off("chat:message", onMessage);
    };
  }, [socket, chatId, matchId, me]);

  // Re-enable the bar once the rate-limit window has passed.
  useEffect(() => {
    const wait = blockedUntil - Date.now();
    if (wait <= 0) return;
    const t = setTimeout(() => setBlockedUntil(0), wait);
    return () => clearTimeout(t);
  }, [blockedUntil]);

  const react = useCallback(
    (key: string, onSlowDown?: (retryAt: number) => void) => {
      socket?.emit("chat:react", { roomId: matchId, emoji: key }, (res: Ack) => {
        if (res?.ok || res?.reason !== "slow down") return;
        const retryAt = res.retryAt ?? Date.now() + 10_000;
        setBlockedUntil(retryAt);
        onSlowDown?.(retryAt);
      });
    },
    [socket, matchId],
  );

  return { floating, react, blocked: blockedUntil > Date.now(), ready: chatId !== null };
}
