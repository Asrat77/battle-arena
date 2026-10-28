"use client";

// The way out of a finished match: Play again against the bot, Rematch
// against a player (it starts once both of you ask), and Home. The server
// keeps the offer, so a refresh shows where it stands.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { useSession } from "@/lib/session";

type RematchState = "open" | "offered" | "matched" | "declined" | "closed";

interface Rematch {
  matchId: string;
  state: RematchState;
  bot: boolean;
  wants: string[];
  next: string | null;
}

type Ack = { ok: true; state?: RematchState; matchId?: string } | { ok: false; reason: string };

export function EndActions({ matchId, opponent }: { matchId: string; /** Null when spectating. */ opponent: string | null }) {
  const { socket, connected, profile } = useSession();
  const router = useRouter();
  const [rematch, setRematch] = useState<Rematch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket || !connected || opponent === null) return;
    const onUpdate = (r: Rematch) => r?.matchId === matchId && setRematch(r);
    socket.on("rematch:update", onUpdate);
    socket.emit("rematch:status", { matchId }, (r: Rematch & { available: boolean }) => setRematch(r?.available ? r : null));
    return () => {
      socket.off("rematch:update", onUpdate);
    };
  }, [socket, connected, matchId, opponent]);

  const next = rematch?.state === "matched" ? rematch.next : null;
  useEffect(() => {
    if (next) router.push(`/match/${next}`);
  }, [next, router]);

  const send = (event: "rematch:request" | "rematch:cancel") => {
    if (!socket) return;
    setBusy(true);
    setError(null);
    socket.emit(event, { matchId }, (res: Ack) => {
      setBusy(false);
      if (!res.ok) setError(res.reason === "already in a match" ? "One of you is already in another match" : res.reason);
      else if (res.matchId) router.push(`/match/${res.matchId}`);
    });
  };

  const home = (
    <ButtonLink href="/" variant="ghost" block className="relative">
      Home
    </ButtonLink>
  );
  if (!rematch || !profile) return home;

  const mine = rematch.wants.includes(profile.id);
  const theirs = rematch.wants.some((p) => p !== profile.id);
  const note = rematch.bot
    ? null
    : rematch.state === "declined"
      ? `${opponent} passed on a rematch`
      : rematch.state === "closed"
        ? "The rematch offer timed out"
        : mine
          ? `Waiting for ${opponent} to accept`
          : theirs
            ? `${opponent} wants a rematch`
            : null;

  return (
    <div className="relative flex flex-col gap-2.5" data-testid="end-actions">
      {(note || error) && (
        <p aria-live="polite" className={`flex items-center justify-center gap-2 text-center text-small ${error ? "text-mismatch" : "text-ink-2"}`}>
          {mine && rematch.state === "offered" && !error && <span className="spin" aria-hidden />}
          {error ?? note}
          {theirs && rematch.state === "offered" && !error && (
            <button type="button" className="font-semibold text-ink underline underline-offset-2" onClick={() => send("rematch:cancel")}>
              No thanks
            </button>
          )}
        </p>
      )}
      <div className="flex gap-2.5 [&>*]:flex-1">
        {mine && rematch.state === "offered" ? (
          <Button onClick={() => send("rematch:cancel")} disabled={busy}>
            Cancel
          </Button>
        ) : (
          <Button
            onClick={() => send("rematch:request")}
            loading={busy || rematch.state === "matched"}
            disabled={rematch.state === "declined" || rematch.state === "closed"}
          >
            {rematch.bot ? "Play again" : theirs ? "Accept rematch" : "Rematch"}
          </Button>
        )}
        {home}
      </div>
    </div>
  );
}
