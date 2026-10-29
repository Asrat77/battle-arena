"use client";

// Sheet to open a tournament: pick a game, optionally start it at once with
// bots in every empty seat. Without that toggle it waits for people to join.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { listGames } from "@/engine/registry";
import type { TournamentState } from "@/lib/api";
import { useSession } from "@/lib/session";
import { GAME_ICONS } from "./shared";

type Ack = { ok: true; tournament: TournamentState } | { ok: false; reason: string };

export function CreateTournament({ open, onClose, defaultGame }: { open: boolean; onClose: () => void; defaultGame?: string }) {
  const router = useRouter();
  const { socket } = useSession();
  const games = listGames();
  const [gameId, setGameId] = useState(defaultGame ?? games[0].id);
  const [bots, setBots] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    if (!socket) return setError("You’re not connected.");
    setBusy(true);
    setError(null);
    socket.timeout(8000).emit("tournament:create", { gameId, fillWithBots: bots }, (err: Error | null, res: Ack) => {
      setBusy(false);
      if (err) return setError("The server didn’t answer.");
      if (!res.ok) return setError(res.reason);
      router.push(res.tournament.link);
    });
  };

  return (
    <Sheet open={open} onClose={onClose} title="New tournament">
      <div className="flex flex-col gap-4">
        <Segmented
          label="Game"
          value={gameId}
          onChange={setGameId}
          options={games.map((g) => ({ value: g.id, label: g.name, icon: GAME_ICONS[g.id] }))}
        />
        <label className="card flex cursor-pointer items-center gap-3 !bg-sf-2">
          <input type="checkbox" checked={bots} onChange={(e) => setBots(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--acc))]" />
          <span className="flex flex-col">
            <b className="font-semibold">Fill with bots</b>
            <span className="text-small text-ink-2">
              {bots ? "Starts right away, with bots filling the three open seats." : "Waits for three more players to join."}
            </span>
          </span>
        </label>
        {error && (
          <p role="alert" className="text-small text-mismatch">
            {error}
          </p>
        )}
        <Button variant="act" block icon="trophy" loading={busy} onClick={create}>
          Create tournament
        </Button>
      </div>
    </Sheet>
  );
}
