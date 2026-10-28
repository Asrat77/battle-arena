"use client";

// One private room over the socket (contract in backend/src/lobby.ts). The
// page joins by code on mount and again after a reconnect; joining a room you
// are already in just resends its state. Leaving the page keeps your seat, so
// only the explicit leave() gives it up.

import { useCallback, useEffect, useState } from "react";
import type { RoomState } from "@/lib/api";
import { useSession } from "@/lib/session";

const JOIN_TIMEOUT_MS = 8000;

type Ack = { ok: true; room?: RoomState } | { ok: false; reason: string };

export type RoomPhase = { kind: "joining" } | { kind: "in"; room: RoomState } | { kind: "error"; reason: string };

/** Room codes are 5 letters from an alphabet with no 0/O or 1/I/L. */
export function normalizeCode(raw: string): string {
  const fromLink = raw.match(/\/r\/([A-Za-z0-9]+)/)?.[1] ?? raw;
  return fromLink.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function useRoom(code: string) {
  const { socket, connected } = useSession();
  const [phase, setPhase] = useState<RoomPhase>({ kind: "joining" });
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!socket || !connected) return;
    const onUpdate = (r: RoomState) => r?.code === code && setPhase({ kind: "in", room: r });
    socket.on("room:update", onUpdate);
    socket.timeout(JOIN_TIMEOUT_MS).emit("room:join", { code }, (err: Error | null, res: Ack) => {
      if (err) return setPhase({ kind: "error", reason: "timeout" });
      if (!res.ok) return setPhase({ kind: "error", reason: res.reason });
      if (res.room) setPhase({ kind: "in", room: res.room });
    });
    return () => {
      socket.off("room:update", onUpdate);
    };
  }, [socket, connected, code, attempt]);

  // No socket for a while counts as the server not answering.
  useEffect(() => {
    if (connected || phase.kind !== "joining") return;
    const t = setTimeout(() => setPhase({ kind: "error", reason: "timeout" }), JOIN_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [connected, phase.kind]);

  const setReady = useCallback(
    (ready: boolean) => {
      if (!socket) return;
      setBusy(true);
      socket.timeout(JOIN_TIMEOUT_MS).emit("room:ready", { ready }, (err: Error | null, res: Ack) => {
        setBusy(false);
        if (!err && res.ok && res.room) setPhase({ kind: "in", room: res.room });
      });
    },
    [socket],
  );

  const leave = useCallback(() => {
    socket?.emit("room:leave");
  }, [socket]);

  const retry = useCallback(() => {
    setPhase({ kind: "joining" });
    setAttempt((a) => a + 1);
  }, []);

  return { phase, busy, setReady, leave, retry };
}
