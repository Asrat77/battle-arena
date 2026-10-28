"use client";

// Home's side column: who you are (avatar, record, points and the copyable
// profile ID friends need to invite you) and your recent results, each with
// its ledger state and a way to the replay. Sits beside the game cards on
// wide screens and below them on narrow ones.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button } from "@/components/ui/Button";
import { RecordChip } from "@/components/ui/Chip";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { useToast } from "@/components/ui/Toast";
import { getGame } from "@/engine/registry";
import { api, type MatchSummary, type Profile } from "@/lib/api";
import { shortId, usePlayerNames } from "@/lib/usePlayerNames";

const RECENT = 5;

const GAME_ART: Record<string, Icon3DName> = { "crack-the-code": "vault", gebeta: "mancala" };

type Result = "Won" | "Lost" | "Draw";

function resultFor(m: MatchSummary, profileId: string): Result {
  if (m.outcome.draw) return "Draw";
  return m.outcome.winner === m.players.indexOf(profileId) ? "Won" : "Lost";
}

export function SideColumn({ profile }: { profile: Profile }) {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [points, setPoints] = useState<number | null>(null);

  useEffect(() => {
    api.matches(profile.id).then(
      (ms) => setMatches([...ms].sort((a, b) => b.endedAt - a.endedAt)),
      () => setMatches([]),
    );
    api.rewards(profile.id).then(
      (r) => setPoints(r.points),
      () => setPoints(null),
    );
  }, [profile.id]);

  return (
    <aside aria-label="Your profile and recent matches" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5 md:max-w-[400px] md:gap-[22px] md:pt-1.5">
      <ProfileCard profile={profile} matches={matches} points={points} />
      <Recent profileId={profile.id} matches={matches} />
    </aside>
  );
}

function ProfileCard({ profile, matches, points }: { profile: Profile; matches: MatchSummary[] | null; points: number | null }) {
  const toast = useToast();
  const tally = { Won: 0, Lost: 0, Draw: 0 };
  for (const m of matches ?? []) tally[resultFor(m, profile.id)]++;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(profile.id);
      toast.show({ icon: "idcard", body: "Copied your profile ID" });
    } catch {
      toast.show({ icon: "warning", tone: "warn", body: `Couldn’t copy. Your ID is ${profile.id}` });
    }
  };

  return (
    <section aria-labelledby="profile-name" className="card flex flex-col gap-3.5 !p-[18px]">
      <div className="flex items-center gap-3">
        <Avatar3D id={profile.id} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="profile-name" className="truncate text-[22px] font-semibold leading-[1.05] tracking-[-.04em]">
            {profile.name}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            <span className="chip font-mono tabular-nums" aria-label={`${tally.Won} won, ${tally.Lost} lost, ${tally.Draw} drawn`}>
              {matches ? `${tally.Won}–${tally.Lost}–${tally.Draw}` : "–"}
            </span>
            <span className="chip font-mono tabular-nums" aria-label={`${points ?? 0} points`}>
              <Icon3D name="token" size={18} />
              {points ?? "–"}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-[16px] bg-sf-2 py-2 pl-3 pr-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="eyebrow">Profile ID</span>
          <span className="mono truncate text-small" data-testid="profile-id" title={profile.id}>
            {profile.id}
          </span>
        </div>
        <Button size="sm" icon="idcard" onClick={copy}>
          Copy
        </Button>
      </div>
    </section>
  );
}

function Recent({ profileId, matches }: { profileId: string; matches: MatchSummary[] | null }) {
  const [all, setAll] = useState(false);
  const shown = matches && (all ? matches : matches.slice(0, RECENT));
  const names = usePlayerNames(shown ? [...new Set(shown.flatMap((m) => m.players))] : undefined);

  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-2.5">
      <h2 id="recent-heading" className="eyebrow px-0.5">
        Recent
      </h2>
      <div className="card !px-3.5 !py-1">
        {!shown && (
          <div className="flex flex-col gap-2 py-2.5" aria-busy>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-[44px] animate-pulse rounded-2xl bg-sf-2" />
            ))}
          </div>
        )}
        {shown?.length === 0 && (
          <div className="flex items-center gap-3 py-3">
            <Icon3D name="sprout" size={40} />
            <span className="text-small text-ink-2">No matches yet. Every result you play lands here and on the ledger.</span>
          </div>
        )}
        {shown && shown.length > 0 && (
          <ul>
            {shown.map((m) => {
              const opponent = m.players[m.players.indexOf(profileId) === 0 ? 1 : 0];
              return (
                <li key={m.matchId} className="border-t border-line first:border-t-0">
                  <div className="flex items-center gap-3 py-2.5">
                    <Icon3D name={GAME_ART[m.gameId] ?? "controller"} size={36} />
                    <Link href={`/replay/${m.matchId}`} className="min-w-0 flex-1 hover:underline">
                      <p className="truncate">
                        <b className="font-semibold">{resultFor(m, profileId)}</b> vs {names[opponent] ?? shortId(opponent)}
                      </p>
                      <p className="truncate text-small text-ink-2">
                        {getGame(m.gameId)?.name ?? m.gameId} · {m.outcome.reason}
                      </p>
                    </Link>
                    <RecordChip state={m.status} block={m.resultIndex} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {matches && matches.length > RECENT && (
        <button type="button" className="self-start px-0.5 text-small text-ink-2 underline" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${matches.length}`}
        </button>
      )}
    </section>
  );
}
