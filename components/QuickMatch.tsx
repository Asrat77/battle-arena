"use client";

// Game list with quick match. After 10 s alone in the queue the server offers
// a bot; accepting it starts the match straight away.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type GameSummary } from "@/lib/api";
import { useSession } from "@/lib/session";

interface QueueStatus {
  gameId: string;
  state: "waiting" | "matched" | "idle";
  since?: number;
  matchId?: string;
}

type Ack = { ok: true; state?: string; matchId?: string } | { ok: false; reason: string };

export function QuickMatch() {
  const { socket } = useSession();
  const router = useRouter();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [botOffer, setBotOffer] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.games().then(setGames, (e) => setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onStatus = (s: QueueStatus) => {
      if (s.state === "matched" && s.matchId) router.push(`/match/${s.matchId}`);
      else if (s.state === "waiting") setWaiting(s.gameId);
      else {
        setWaiting(null);
        setBotOffer(false);
      }
    };
    const onOffer = () => setBotOffer(true);
    const onError = (e: { reason: string }) => setError(e.reason);
    socket.on("queue:status", onStatus);
    socket.on("queue:botOffer", onOffer);
    socket.on("lobby:error", onError);
    return () => {
      socket.off("queue:status", onStatus);
      socket.off("queue:botOffer", onOffer);
      socket.off("lobby:error", onError);
    };
  }, [socket, router]);

  useEffect(() => {
    if (!waiting) return;
    const startedAt = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [waiting]);

  const join = (gameId: string) => {
    setError(null);
    setBotOffer(false);
    socket?.emit("queue:join", { gameId }, (res: Ack) => {
      if (!res.ok) setError(res.reason);
      else if (res.matchId) router.push(`/match/${res.matchId}`);
      else setWaiting(gameId);
    });
  };
  const leave = () => socket?.emit("queue:leave", () => setWaiting(null));
  const acceptBot = () =>
    socket?.emit("queue:acceptBot", (res: Ack) => {
      if (!res.ok) setError(res.reason);
      else if (res.matchId) router.push(`/match/${res.matchId}`);
    });

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Games</h2>
      {!games && !error && <p className="text-sm text-gray-500">Loading…</p>}
      <ul className="divide-y divide-gray-100">
        {games?.map((g) => (
          <li key={g.id} className="flex items-center gap-3 py-2">
            <span className="flex-1">
              <span className="font-medium">{g.name}</span>
              <span className="ml-2 text-xs text-gray-500">
                {g.queue} waiting · {g.live} live
              </span>
            </span>
            {waiting === g.id ? (
              <button className="btn-outline" onClick={leave}>
                Cancel
              </button>
            ) : (
              <button className="btn" disabled={!socket || waiting !== null} onClick={() => join(g.id)}>
                Quick match
              </button>
            )}
          </li>
        ))}
      </ul>
      {waiting && (
        <div className="rounded bg-gray-100 p-3 text-sm">
          <p>Looking for an opponent… {elapsed}s</p>
          {botOffer ? (
            <p className="mt-2 flex items-center gap-3">
              No one else is around.
              <button className="btn" onClick={acceptBot}>
                Play the bot
              </button>
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">A bot is offered after 10 seconds.</p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
