"use client";

// Chat news for a closed chat: how many text messages from other people came in
// since it was last open, and the latest one for a short preview bubble. The
// chat sheet only mounts when it is open, so without this nobody would know a
// message had arrived. Reactions are left out; they float over the board.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/session";
import type { ChatMessage } from "@/lib/useChat";

export const PREVIEW_MS = 5000;

export function useChatAlerts(matchId: string, open: boolean) {
  const { socket, connected, profile } = useSession();
  const me = profile?.id;
  const [chatId, setChatId] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<ChatMessage | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!socket || !connected) return;
    const ask = () =>
      socket.emit("chat:history", { roomId: matchId }, (res: { ok: boolean; roomId?: string }) => {
        if (res?.ok && res.roomId) setChatId(res.roomId);
      });
    const onStart = (m: { matchId?: string }) => m?.matchId === matchId && ask();
    socket.on("match:start", onStart);
    ask();
    return () => {
      socket.off("match:start", onStart);
    };
  }, [socket, connected, matchId]);

  useEffect(() => {
    if (!socket || !chatId) return;
    const onMessage = (m: ChatMessage) => {
      if (m?.kind !== "text" || (m.roomId !== chatId && m.roomId !== matchId)) return;
      if (m.from.profileId === me || openRef.current) return;
      setUnread((n) => n + 1);
      setLatest(m);
    };
    socket.on("chat:message", onMessage);
    return () => {
      socket.off("chat:message", onMessage);
    };
  }, [socket, chatId, matchId, me]);

  // Opening the chat reads everything.
  useEffect(() => {
    if (open) {
      setUnread(0);
      setLatest(null);
    }
  }, [open]);

  useEffect(() => {
    if (!latest) return;
    const t = setTimeout(() => setLatest((l) => (l?.id === latest.id ? null : l)), PREVIEW_MS);
    return () => clearTimeout(t);
  }, [latest]);

  const dismiss = useCallback(() => setLatest(null), []);
  return { unread, latest, dismiss };
}
