"use client";

// Quick match over the socket (contract in backend/src/lobby.ts). Joining
// happens on mount and again after a reconnect, since the server drops you
// from the queue when the socket goes. Leaving the screen leaves the queue.

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchStart } from "@/lib/useMatch";
import { useSession } from "@/lib/session";

const JOIN_TIMEOUT_MS = 8000;

interface QueueStatus {
  gameId: string;
  state: "waiting" | "matched" | "idle";
  matchId?: string;
  bot?: boolean;
}

type Ack = { ok: true; state?: string; matchId?: string } | { ok: false; reason: string };

export type QueuePhase =
  | { kind: "joining" }
  | { kind: "waiting" }
  | { kind: "matched"; matchId: string }
  | { kind: "error"; reason: string };

export function useQueue(gameId: string) {
  const { socket, connected } = useSession();
  const [phase, setPhase] = useState<QueuePhase>({ kind: "joining" });
  const [botOffer, setBotOffer] = useState(false);
  // match:start can land before or after queue:status, so keep every one seen.
  const [starts, setStarts] = useState<Record<string, MatchStart>>({});
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Set once matched or cancelled, so unmounting doesn't send a stray leave.
  const settled = useRef(false);

  const matched = useCallback((matchId: string) => {
    settled.current = true;
    setPhase((p) => (p.kind === "matched" ? p : { kind: "matched", matchId }));
  }, []);

  // A late failure (a slow ack, a second join) never undoes a match already made.
  const failed = useCallback((reason: string) => {
    setPhase((p) => (p.kind === "matched" ? p : { kind: "error", reason }));
  }, []);

  useEffect(() => {
    if (!socket || !connected) return;
    settled.current = false;

    const onStatus = (s: QueueStatus) => {
      if (s?.gameId !== gameId) return;
      if (s.state === "matched" && s.matchId) matched(s.matchId);
      else if (s.state === "waiting") setPhase((p) => (p.kind === "matched" ? p : { kind: "waiting" }));
    };
    const onOffer = (o: { gameId?: string }) => o?.gameId === gameId && setBotOffer(true);
    const onStart = (m: MatchStart) => m?.matchId && setStarts((all) => ({ ...all, [m.matchId]: m }));
    socket.on("queue:status", onStatus);
    socket.on("queue:botOffer", onOffer);
    socket.on("match:start", onStart);

    setStartedAt((t) => t ?? Date.now());
    socket.timeout(JOIN_TIMEOUT_MS).emit("queue:join", { gameId }, (err: Error | null, res: Ack) => {
      if (err) return failed("timeout");
      if (!res.ok) return failed(res.reason);
      if (res.matchId) matched(res.matchId);
      else setPhase((p) => (p.kind === "matched" ? p : { kind: "waiting" }));
    });

    return () => {
      socket.off("queue:status", onStatus);
      socket.off("queue:botOffer", onOffer);
      socket.off("match:start", onStart);
      if (!settled.current && socket.connected) socket.emit("queue:leave");
    };
  }, [socket, connected, gameId, attempt, matched, failed]);

  // No socket for a while counts as the server not answering.
  useEffect(() => {
    if (connected || phase.kind === "error" || phase.kind === "matched") return;
    const t = setTimeout(() => failed("timeout"), JOIN_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [connected, phase.kind, failed]);

  const acceptBot = useCallback(() => {
    socket?.timeout(JOIN_TIMEOUT_MS).emit("queue:acceptBot", (err: Error | null, res: Ack) => {
      if (err) return failed("timeout");
      if (!res.ok) return failed(res.reason);
      if (res.matchId) matched(res.matchId);
    });
  }, [socket, matched, failed]);

  const cancel = useCallback(() => {
    settled.current = true;
    socket?.emit("queue:leave");
  }, [socket]);

  const retry = useCallback(() => {
    setPhase({ kind: "joining" });
    setBotOffer(false);
    setStartedAt(null);
    setAttempt((a) => a + 1);
  }, []);

  const start = phase.kind === "matched" ? (starts[phase.matchId] ?? null) : null;
  return { phase, botOffer, start, startedAt, acceptBot, cancel, retry };
}
