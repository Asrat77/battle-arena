"use client";

// Live state of one match over the socket: start info, the latest view for
// this viewer, the end (outcome + reveal) and the ledger status.

import { useCallback, useEffect, useState } from "react";
import type { MatchCommit, MoveError } from "@/components/match/adapter";
import type { Outcome, Seat, Viewer } from "@/engine/types";
import { api } from "./api";
import { useSession } from "./session";

export interface MatchStart {
  matchId: string;
  gameId: string;
  players: [string, string];
  bot: boolean;
  botSeat: Seat | null;
  seat: Viewer;
  commitments: Record<string, string>;
  startedAt: number;
}

export interface MatchViewMsg<V = unknown> {
  matchId: string;
  view: V;
  seq: number;
  deadline: number | null;
  activeSeats: Seat[];
}

export interface MatchEnd {
  matchId: string;
  outcome: Outcome;
  reveal: Record<string, unknown>;
}

export type LedgerStatus =
  | { state: "none" }
  | { state: "pending" }
  | { state: "recorded"; ledgerIndex: number };

export function useMatch<V>(matchId: string) {
  const { socket, connected } = useSession();
  const [start, setStart] = useState<MatchStart | null>(null);
  const [view, setView] = useState<MatchViewMsg<V> | null>(null);
  const [end, setEnd] = useState<MatchEnd | null>(null);
  const [commit, setCommit] = useState<MatchCommit | null>(null);
  const [ledger, setLedger] = useState<LedgerStatus>({ state: "none" });
  const [error, setError] = useState<MoveError | null>(null);
  const [missing, setMissing] = useState(false);
  /** Per seat: when the forfeit lands for a player who dropped off, else null. */
  const [away, setAway] = useState<[number | null, number | null]>([null, null]);

  useEffect(() => {
    if (!socket || !connected) return;
    const mine = (msg: { matchId?: string }) => msg?.matchId === matchId;
    const onStart = (msg: MatchStart) => mine(msg) && setStart(msg);
    const onView = (msg: MatchViewMsg<V>) => {
      if (!mine(msg)) return;
      setView((prev) => (prev && prev.seq > msg.seq ? prev : msg));
      setError(null);
    };
    const onEnd = (msg: MatchEnd) => {
      if (!mine(msg)) return;
      setEnd(msg);
      setAway([null, null]);
      setLedger((l) => (l.state === "recorded" ? l : { state: "pending" }));
    };
    const onCommitted = (msg: { matchId: string; commitments: Record<string, string>; ledgerIndex: number }) =>
      mine(msg) && setCommit({ commitments: msg.commitments, ledgerIndex: msg.ledgerIndex });
    const onRecorded = (msg: { matchId: string; ledgerIndex: number }) =>
      mine(msg) && setLedger({ state: "recorded", ledgerIndex: msg.ledgerIndex });
    // Players also hear about the result block as a `notify`; the poll below
    // covers a missed event.
    const onNotify = (msg: { kind?: string; matchId?: string; ledgerIndex?: number }) => {
      if (msg?.kind === "matchRecorded" && mine(msg) && typeof msg.ledgerIndex === "number")
        setLedger({ state: "recorded", ledgerIndex: msg.ledgerIndex });
    };
    const onPresence = (msg: { matchId?: string; away: [number | null, number | null] }) => mine(msg) && setAway(msg.away);
    const onError = (msg: { matchId?: string; reason: string }) => {
      if (!mine(msg)) return;
      if (msg.reason === "no such match") setMissing(true);
      else setError((e) => ({ reason: msg.reason, n: (e?.n ?? 0) + 1 }));
    };

    socket.on("match:start", onStart);
    socket.on("match:view", onView);
    socket.on("match:end", onEnd);
    socket.on("match:committed", onCommitted);
    socket.on("match:recorded", onRecorded);
    socket.on("match:error", onError);
    socket.on("match:presence", onPresence);
    socket.on("notify", onNotify);
    // Seated players get their seat back; anyone else watches as a spectator.
    socket.emit("match:watch", { matchId });

    return () => {
      socket.off("match:start", onStart);
      socket.off("match:view", onView);
      socket.off("match:end", onEnd);
      socket.off("match:committed", onCommitted);
      socket.off("match:recorded", onRecorded);
      socket.off("match:error", onError);
      socket.off("match:presence", onPresence);
      socket.off("notify", onNotify);
    };
  }, [socket, connected, matchId]);

  // A refresh after the end misses match:recorded (and match:committed), so
  // ask the server instead.
  const waitingForBlock = end !== null && ledger.state !== "recorded";
  useEffect(() => {
    if (!waitingForBlock) return;
    const t = setInterval(() => {
      api.match(matchId).then(
        (m) => {
          if (m.commitIndex !== null) {
            const commitIndex = m.commitIndex;
            setCommit((c) => c ?? { commitments: m.commitments, ledgerIndex: commitIndex });
          }
          if (m.status === "recorded" && m.resultIndex !== null) setLedger({ state: "recorded", ledgerIndex: m.resultIndex });
        },
        () => {},
      );
    }, 2000);
    return () => clearInterval(t);
  }, [waitingForBlock, matchId]);

  const move = useCallback(
    (m: unknown) => {
      setError(null);
      socket?.emit("match:move", { matchId, move: m });
    },
    [socket, matchId],
  );

  const leave = useCallback(() => socket?.emit("match:leave", { matchId }), [socket, matchId]);

  return { start, view, end, commit, ledger, error, missing, away, move, leave };
}
