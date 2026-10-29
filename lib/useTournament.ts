"use client";

// One tournament over REST plus the socket (contract in backend/src/tournaments.ts).
// The REST read makes the bracket visible signed out; once connected, watching
// keeps it live (and again after a reconnect).

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type TournamentState } from "./api";
import { useSession } from "./session";

const ACK_TIMEOUT_MS = 8000;

type Ack = { ok: true; tournament?: TournamentState } | { ok: false; reason: string };

export type TournamentPhase = { kind: "loading" } | { kind: "ready"; t: TournamentState } | { kind: "missing" } | { kind: "error" };

export function useTournament(id: string) {
  const { socket, connected } = useSession();
  const [phase, setPhase] = useState<TournamentPhase>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api.tournament(id).then(
      (t) => live && setPhase((p) => (p.kind === "ready" ? p : { kind: "ready", t })),
      (err) => live && setPhase({ kind: err instanceof ApiError && err.status === 404 ? "missing" : "error" }),
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);

  useEffect(() => {
    if (!socket || !connected) return;
    const onUpdate = (t: TournamentState) => t?.id === id && setPhase({ kind: "ready", t });
    socket.on("tournament:update", onUpdate);
    socket.timeout(ACK_TIMEOUT_MS).emit("tournament:watch", { id }, (err: Error | null, res: Ack) => {
      if (!err && res.ok && res.tournament) setPhase({ kind: "ready", t: res.tournament });
    });
    return () => {
      socket.off("tournament:update", onUpdate);
    };
  }, [socket, connected, id]);

  /** Emit a tournament command; resolves to an error message, or null on success. */
  const send = useCallback(
    (event: "tournament:join" | "tournament:leave" | "tournament:addBots"): Promise<string | null> => {
      if (!socket) return Promise.resolve("You’re not connected.");
      setBusy(true);
      return new Promise((resolve) => {
        socket.timeout(ACK_TIMEOUT_MS).emit(event, { id }, (err: Error | null, res: Ack) => {
          setBusy(false);
          if (err) return resolve("The server didn’t answer.");
          if (res.ok && res.tournament) setPhase({ kind: "ready", t: res.tournament });
          resolve(res.ok ? null : res.reason);
        });
      });
    },
    [socket, id],
  );

  const retry = useCallback(() => {
    setPhase({ kind: "loading" });
    setAttempt((a) => a + 1);
  }, []);

  return { phase, busy, send, retry };
}
