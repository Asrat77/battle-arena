"use client";

// Sheet to open a tournament: pick a game, optionally start it at once with
// bots in every empty seat. Without that toggle it waits for people to join.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { listGames } from "@/engine/registry";
import type { CreateTournamentInput, TournamentSize, TournamentState } from "@/lib/api";
import { useSession } from "@/lib/session";
import { GAME_ICONS } from "./shared";

type Ack = { ok: true; tournament: TournamentState } | { ok: false; reason: string };

export function CreateTournament({ open, onClose, defaultGame }: { open: boolean; onClose: () => void; defaultGame?: string }) {
  const router = useRouter();
  const { socket } = useSession();
  const games = listGames();
  const [gameId, setGameId] = useState(defaultGame ?? games[0].id);
  const [name, setName] = useState("");
  const [size, setSize] = useState<TournamentSize>(4);
  const [bestOf, setBestOf] = useState<1 | 3>(1);
  const [visibility, setVisibility] = useState<"open" | "link">("open");
  const [bots, setBots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    if (!socket) return setError("You’re not connected.");
    setBusy(true);
    setError(null);
    socket.timeout(8000).emit("tournament:create", {
      gameId,
      name: name.trim() || undefined,
      size,
      bestOf,
      visibility,
      fillWithBots: bots,
    } satisfies CreateTournamentInput, (err: Error | null, res: Ack) => {
      setBusy(false);
      if (err) return setError("The server didn’t answer.");
      if (!res.ok) return setError(res.reason);
      router.push(res.tournament.link);
    });
  };

  return (
    <Sheet open={open} onClose={onClose} title="New tournament">
      <div className="flex flex-col gap-4">
        <Field
          label="Name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${games.find((g) => g.id === gameId)?.name ?? "Game"} tournament`}
        />
        <Segmented
          label="Game"
          value={gameId}
          onChange={setGameId}
          options={games.map((g) => ({ value: g.id, label: g.name, icon: GAME_ICONS[g.id] }))}
        />
        <Segmented<string>
          label="Players"
          value={String(size)}
          onChange={(v) => setSize(Number(v) as TournamentSize)}
          options={[4, 8, 16].map((n) => ({ value: String(n), label: String(n) }))}
        />
        <Segmented<string>
          label="Format"
          value={String(bestOf)}
          onChange={(v) => setBestOf(v === "3" ? 3 : 1)}
          options={[
            { value: "1", label: "Single game" },
            { value: "3", label: "Best of 3" },
          ]}
        />
        <Segmented<"open" | "link">
          label="Who can find it"
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: "open", label: "Open to all" },
            { value: "link", label: "Link only" },
          ]}
        />
        <label className="card flex cursor-pointer items-center gap-3 !bg-sf-2">
          <input type="checkbox" checked={bots} onChange={(e) => setBots(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--acc))]" />
          <span className="flex flex-col">
            <b className="font-semibold">Fill with bots</b>
            <span className="text-small text-ink-2">
              {bots ? `Starts right away, with bots filling the ${size - 1} open seats.` : `Waits for ${size - 1} more players. You can start early and bots fill the rest.`}
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
