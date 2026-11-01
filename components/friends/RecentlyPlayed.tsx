"use client";

// The last few people you played, newest first, bots left out. Tap a row for
// the player sheet; the button sends a friend request without leaving the page.

import { useEffect, useState } from "react";
import { PlayerLink } from "@/components/profile/PlayerSheet";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button } from "@/components/ui/Button";
import { api, BOT_PLAYER, type MatchSummary } from "@/lib/api";
import { usePlayerNames } from "@/lib/usePlayerNames";

const MAX = 10;

type Relation = "friend" | "sent" | "incoming" | "none";

export interface Opponent {
  profileId: string;
  gameId: string;
  endedAt: number;
}

/** Distinct human opponents, most recent match first. */
export function recentOpponents(matches: MatchSummary[], me: string, max = MAX): Opponent[] {
  const seen = new Set<string>();
  const out: Opponent[] = [];
  for (const m of [...matches].sort((a, b) => b.endedAt - a.endedAt)) {
    const other = m.players.find((p) => p !== me);
    if (!other || other === BOT_PLAYER || seen.has(other)) continue;
    seen.add(other);
    out.push({ profileId: other, gameId: m.gameId, endedAt: m.endedAt });
    if (out.length >= max) break;
  }
  return out;
}

function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const gameLabel = (id: string) => id.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());

export function RecentlyPlayed({
  meId,
  relation,
  onAdd,
}: {
  meId: string;
  relation: (profileId: string) => Relation;
  /** Returns an error line, or null on success. */
  onAdd: (profileId: string) => Promise<string | null>;
}) {
  const [list, setList] = useState<Opponent[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.matches(meId).then(
      (m) => live && setList(recentOpponents(m, meId)),
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, [meId]);

  const names = usePlayerNames(list?.map((o) => o.profileId));

  if (!list || list.length === 0) return null;

  return (
    <section aria-label="Recently played with" className="mt-6">
      <span className="eyebrow">Recently played with</span>
      <ul>
        {list.map((o) => {
          const rel = relation(o.profileId);
          return (
            <li key={o.profileId} className="flex items-center gap-3 border-t border-line py-3">
              <PlayerLink id={o.profileId} label={`Open ${names[o.profileId] ?? "player"}`}>
                <Avatar3D id={o.profileId} />
              </PlayerLink>
              <div className="min-w-0 flex-1">
                <PlayerLink id={o.profileId} className="block truncate font-semibold">
                  {names[o.profileId] ?? "Player"}
                </PlayerLink>
                <span className="block truncate text-small text-ink-2">
                  {gameLabel(o.gameId)} · {ago(o.endedAt)}
                </span>
              </div>
              {rel === "none" && (
                <Button
                  size="sm"
                  icon="plus"
                  loading={busy === o.profileId}
                  onClick={async () => {
                    setBusy(o.profileId);
                    setError(null);
                    const err = await onAdd(o.profileId);
                    setBusy(null);
                    if (err) setError(err);
                  }}
                >
                  Add
                </Button>
              )}
              {rel === "sent" && <span className="text-small text-ink-2">Sent</span>}
              {rel === "incoming" && <span className="text-small text-ink-2">Wants to be friends</span>}
              {rel === "friend" && <span className="text-small text-ink-2">Friends</span>}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="pt-2 text-small text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
