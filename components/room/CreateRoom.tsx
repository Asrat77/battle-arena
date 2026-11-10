"use client";

// /r/new?game=<id>: opens a room for that game and swaps to its /r/<code>
// page. Without a known game it asks which one first. With staked=1 it asks
// for a stake next (&stake=<santim>), and the room holds it from both players.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Signup } from "@/components/home/Signup";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Icon3D } from "@/components/ui/Icon3D";
import { getGame, listGames } from "@/engine/registry";
import { formatBirr, type RoomState } from "@/lib/api";
import { GAME_ICONS } from "@/lib/gameCatalog";
import { useSession } from "@/lib/session";
import { useWallet } from "@/lib/useWallet";

const CREATE_TIMEOUT_MS = 8000;
/** Mirrors UNSTAKED_GAMES in backend/src/lobby.ts. */
const UNSTAKED = new Set(["tic-tac-toe"]);
const STAKE_PRESETS_BIRR = [10, 50, 100, 250, 500];

type Ack = { ok: true; room: RoomState } | { ok: false; reason: string };

export function CreateRoom({ gameId, staked = false, stake = null }: { gameId: string | null; staked?: boolean; stake?: number | null }) {
  const { ready, profile } = useSession();
  const found = gameId ? getGame(gameId) : undefined;
  const game = staked && found && UNSTAKED.has(found.id) ? undefined : found;
  if (!ready) return null;
  if (!profile) return <Signup />;
  if (!game) return <PickGame staked={staked} />;
  if (staked && stake === null) return <PickStake gameId={game.id} gameName={game.name} />;
  return <Creating gameId={game.id} gameName={game.name} stake={staked ? stake : null} />;
}

function Creating({ gameId, gameName, stake }: { gameId: string; gameName: string; stake: number | null }) {
  const router = useRouter();
  const { socket, connected } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // One room per visit, even if the effect runs twice.
  const sent = useRef(-1);

  useEffect(() => {
    if (!socket || !connected || sent.current === attempt) return;
    sent.current = attempt;
    socket.timeout(CREATE_TIMEOUT_MS).emit("room:create", stake ? { gameId, stake } : { gameId }, (err: Error | null, res: Ack) => {
      if (err) return setError("The server didn’t answer.");
      if (!res.ok) return setError(res.reason);
      router.replace(`/r/${res.room.code}`);
    });
  }, [socket, connected, gameId, stake, attempt, router]);

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
        {error && <p className="max-w-[300px] text-ink-2">{error === "insufficient balance" ? "Your wallet doesn’t cover that stake." : error}</p>}
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
          {error === "insufficient balance" && (
            <ButtonLink href="/wallet" variant="sec" icon="vault" block>
              Open wallet
            </ButtonLink>
          )}
          <ButtonLink href="/" variant="ghost" block>
            Back home
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

/** Choose how much each player puts in. Presets above the balance are disabled. */
function PickStake({ gameId, gameName }: { gameId: string; gameName: string }) {
  const { wallet } = useWallet();
  if (!wallet) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status">
        <span className="spin h-6 w-6 text-ink-2" aria-label="Loading your wallet" />
      </div>
    );
  }
  const unit = wallet.mode === "play" ? "play birr" : "birr";
  const presets = STAKE_PRESETS_BIRR.map((b) => b * 100).filter((s) => s >= wallet.minStake && s <= wallet.maxStake);
  const prize = (s: number) => s * 2 - Math.floor((s * 2 * wallet.feeBps) / 10_000);
  return (
    <div className="mx-auto flex w-full max-w-[480px] lg:max-w-[560px] flex-col gap-4 py-6">
      <ButtonLink href="/r/new?staked=1" variant="ghost" size="sm" className="self-start">
        ← Games
      </ButtonLink>
      <header className="flex flex-col gap-1.5">
        <span className="eyebrow">Staked room · {gameName}</span>
        <h1 className="text-h2">How much each?</h1>
        <p className="text-ink-2">
          You have <b className="text-ink">{formatBirr(wallet.balance)} {unit}</b>. Both players put the stake in when the match starts; the
          winner takes the pot minus a {wallet.feeBps / 100}% fee, and a draw gives it back.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {presets.map((s) => {
          const short = s > wallet.balance;
          return (
            <li key={s}>
              {short ? (
                <div className="btn w-full justify-between opacity-50" aria-disabled>
                  <span>{formatBirr(s)} {unit}</span>
                  <span className="text-small">Not enough</span>
                </div>
              ) : (
                <ButtonLink href={`/r/new?game=${gameId}&stake=${s}`} block className="justify-between">
                  <span>{formatBirr(s)} {unit}</span>
                  <span className="text-small text-ink-2">Winner gets {formatBirr(prize(s))}</span>
                </ButtonLink>
              )}
            </li>
          );
        })}
      </ul>
      {wallet.balance < wallet.minStake && (
        <ButtonLink href="/wallet" variant="act" icon="vault" block>
          Top up your wallet
        </ButtonLink>
      )}
    </div>
  );
}

function PickGame({ staked }: { staked: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-[480px] lg:max-w-[560px] flex-col gap-4 py-6">
      <ButtonLink href="/" variant="ghost" size="sm" className="self-start md:hidden">
        ← Back
      </ButtonLink>
      <header className="flex flex-col gap-1.5">
        <span className="eyebrow">{staked ? "Staked room" : "Private room"}</span>
        <h1 className="text-h2">Which game?</h1>
        <p className="text-ink-2">
          {staked
            ? "Pick a game, then a stake. Tic-Tac-Toe isn’t offered: good play always ends in a draw."
            : "You get a code to share. The match starts once you’re both ready."}
        </p>
      </header>
      {listGames()
        .filter((g) => !staked || !UNSTAKED.has(g.id))
        .map((g) => (
        <ButtonLink key={g.id} href={staked ? `/r/new?game=${g.id}&staked=1` : `/r/new?game=${g.id}`} block className="justify-start">
          <Icon3D name={GAME_ICONS[g.id] ?? "controller"} size={28} />
          {g.name}
        </ButtonLink>
      ))}
      <ButtonLink href={staked ? "/r/new" : "/r/new?staked=1"} variant="ghost" icon={staked ? "handshake" : "vault"} block>
        {staked ? "Play for fun instead" : "Play for stakes"}
      </ButtonLink>
      <ButtonLink href="/r" variant="ghost" icon="key" block>
        I have a code
      </ButtonLink>
    </div>
  );
}
