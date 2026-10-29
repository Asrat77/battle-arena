"use client";

// /r/new?game=<id>: opens a room for that game and swaps to its /r/<code>
// page. Without a known game it asks which one first.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Signup } from "@/components/home/Signup";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Icon3D } from "@/components/ui/Icon3D";
import { getGame, listGames } from "@/engine/registry";
import type { RoomState } from "@/lib/api";
import { useSession } from "@/lib/session";

const CREATE_TIMEOUT_MS = 8000;
import { GAME_ICONS } from "@/lib/gameCatalog";

type Ack = { ok: true; room: RoomState } | { ok: false; reason: string };

export function CreateRoom({ gameId }: { gameId: string | null }) {
  const { ready, profile } = useSession();
  const game = gameId ? getGame(gameId) : undefined;
  if (!ready) return null;
  if (!profile) return <Signup />;
  if (!game) return <PickGame />;
  return <Creating gameId={game.id} gameName={game.name} />;
}

function Creating({ gameId, gameName }: { gameId: string; gameName: string }) {
  const router = useRouter();
  const { socket, connected } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // One room per visit, even if the effect runs twice.
  const sent = useRef(-1);

  useEffect(() => {
    if (!socket || !connected || sent.current === attempt) return;
    sent.current = attempt;
    socket.timeout(CREATE_TIMEOUT_MS).emit("room:create", { gameId }, (err: Error | null, res: Ack) => {
      if (err) return setError("The server didn’t answer.");
      if (!res.ok) return setError(res.reason);
      router.replace(`/r/${res.room.code}`);
    });
  }, [socket, connected, gameId, attempt, router]);

  useEffect(() => {
    if (connected || error) return;
    const t = setTimeout(() => setError("The server didn’t answer."), CREATE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [connected, error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-6 text-center" role={error ? "alert" : "status"}>
      <div className="plate flex h-[170px] w-[170px] items-center justify-center rounded-[56px]">
        <Icon3D name={error ? "satellite" : "key"} size={120} className={error ? "" : "animate-bob"} />
      </div>
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-h2">{error ? "Couldn’t open a room" : `Opening a ${gameName} room…`}</h1>
        {error && <p className="max-w-[300px] text-ink-2">{error}</p>}
      </div>
      {error && (
        <div className="flex w-full max-w-[360px] flex-col gap-2">
          <Button
            variant="act"
            block
            icon="refresh"
            onClick={() => {
              setError(null);
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </Button>
          <ButtonLink href="/" variant="ghost" block>
            Back home
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

function PickGame() {
  return (
    <div className="mx-auto flex max-w-[480px] flex-col gap-4 py-6">
      <header className="flex flex-col gap-1.5">
        <span className="eyebrow">Private room</span>
        <h1 className="text-h2">Which game?</h1>
        <p className="text-ink-2">You get a code to share. The match starts once you’re both ready.</p>
      </header>
      {listGames().map((g) => (
        <ButtonLink key={g.id} href={`/r/new?game=${g.id}`} block className="justify-start">
          <Icon3D name={GAME_ICONS[g.id] ?? "controller"} size={28} />
          {g.name}
        </ButtonLink>
      ))}
      <ButtonLink href="/r" variant="ghost" icon="key" block>
        I have a code
      </ButtonLink>
    </div>
  );
}
