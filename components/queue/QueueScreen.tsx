"use client";

// Full-screen quick match for one game: search, the bot offer at 10 s, a short
// versus moment once matched, then the match screen. Cancel goes home at once.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Icon3D } from "@/components/ui/Icon3D";
import { getGame } from "@/engine/registry";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePlayerNames } from "@/lib/usePlayerNames";
import { BotOffer } from "./BotOffer";
import { Searching } from "./Searching";
import { useQueue } from "./useQueue";
import { Versus } from "./Versus";

const MATCHED_HOLD_MS = 1200;

const REASONS: Record<string, { title: string; body: string; retry: boolean }> = {
  timeout: {
    title: "Couldn’t join the queue",
    body: "The server didn’t answer. You’re not in a match and nothing was recorded.",
    retry: true,
  },
  "already in a match": {
    title: "You’re already in a match",
    body: "Finish or forfeit that match before you queue again.",
    retry: false,
  },
  "unknown game": {
    title: "That game isn’t here",
    body: "Pick a game from the home screen.",
    retry: false,
  },
};

export function QueueScreen({ gameId }: { gameId: string }) {
  const router = useRouter();
  const { ready, profile } = useSession();
  const { phase, botOffer, start, startedAt, acceptBot, cancel, retry } = useQueue(gameId);
  const [docked, setDocked] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const elapsed = useElapsed(phase.kind === "waiting" || phase.kind === "joining" ? startedAt : null);
  const queued = useQueuedCount(gameId, phase.kind === "waiting");
  const names = usePlayerNames(start?.players);
  const gameName = getGame(gameId)?.name ?? "Quick match";

  useEffect(() => {
    if (ready && !profile) router.replace("/");
  }, [ready, profile, router]);

  useEffect(() => {
    if (phase.kind !== "matched") return;
    const t = setTimeout(() => router.replace(`/match/${phase.matchId}`), MATCHED_HOLD_MS);
    return () => clearTimeout(t);
  }, [phase, router]);

  useEffect(() => {
    if (phase.kind === "error") setAccepting(false);
    if (!botOffer) setDocked(false);
  }, [phase.kind, botOffer]);

  if (!profile) return <Frame />;

  if (phase.kind === "matched") {
    const oppId = start?.players.find((p) => p !== profile.id);
    return (
      <Frame>
        <Versus
          gameName={gameName}
          you={{ id: profile.id, name: profile.name }}
          opponent={oppId && names[oppId] ? { id: oppId, name: names[oppId], bot: start?.bot } : null}
        />
      </Frame>
    );
  }

  if (phase.kind === "error") {
    const r = REASONS[phase.reason] ?? { title: "Couldn’t join the queue", body: phase.reason, retry: true };
    return (
      <Frame>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center" role="alert">
          <div className="plate flex h-[170px] w-[170px] items-center justify-center rounded-[56px]">
            <Icon3D name="satellite" size={120} />
          </div>
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-h2">{r.title}</h1>
            <p className="max-w-[280px] text-ink-2">{r.body}</p>
          </div>
          <div className="flex w-full max-w-[360px] flex-col gap-2">
            {r.retry && (
              <Button variant="act" block icon="refresh" onClick={retry}>
                Try again
              </Button>
            )}
            <ButtonLink href="/" variant={r.retry ? "ghost" : "act"} block>
              Back home
            </ButtonLink>
          </div>
        </div>
      </Frame>
    );
  }

  const leave = () => {
    cancel();
    router.push("/");
  };
  const playBot = () => {
    setAccepting(true);
    acceptBot();
  };
  const sheet = botOffer && !docked;

  return (
    <Frame>
      <div className="dither h-[380px]" />
      <div
        className={`relative flex flex-1 flex-col items-center justify-center gap-6 p-6 ${sheet ? "pb-[300px]" : "pb-24"} md:pb-6`}
      >
        <Searching profileId={profile.id} gameName={gameName} elapsed={elapsed} queued={queued} />
        <Button className="min-w-[160px]" onClick={leave}>
          Cancel
        </Button>
        {/* Pinned to the bottom on phones; a corner card beside the search on wider screens. */}
        {botOffer && (
          <div className="absolute inset-x-2.5 bottom-3 mx-auto max-w-[440px] md:fixed md:bottom-6 md:left-auto md:right-6 md:w-[400px]">
            <BotOffer docked={docked} busy={accepting} onAccept={playBot} onDock={() => setDocked(true)} />
          </div>
        )}
      </div>
    </Frame>
  );
}

/** Fills the viewport under the (desktop-only) top bar; no dock on this flow. */
function Frame({ children }: { children?: React.ReactNode }) {
  return (
    <div className="relative -mx-4 -mb-8 -mt-6 flex min-h-[100dvh] flex-col overflow-hidden md:mx-0 md:mb-0 md:mt-0 md:min-h-[calc(100dvh-140px)] md:rounded-sheet">
      {children}
    </div>
  );
}

function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

function useQueuedCount(gameId: string, on: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const load = () =>
      api
        .games()
        .then((gs) => live && setCount(gs.find((g) => g.id === gameId)?.queue ?? null))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [gameId, on]);
  return count;
}
