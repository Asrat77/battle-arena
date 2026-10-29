"use client";

// A profile, yours or someone else's: identity first (animal, name, the full
// ID with copy), then rank, record and points, tokens, the seven badges and
// match history. Everything here comes from recorded matches.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badges } from "@/components/profile/Badges";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { AvatarPicker } from "@/components/ui/AvatarPicker";
import { Button, ButtonLink } from "@/components/ui/Button";
import { RecordChip } from "@/components/ui/Chip";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { useToast } from "@/components/ui/Toast";
import { isAvatar, type AvatarName } from "@/engine/avatars";
import { getGame } from "@/engine/registry";
import { ApiError, api, type BadgeInfo, type LeaderboardRow, type MatchSummary, type PlayerRewards, type Profile } from "@/lib/api";
import { useSession } from "@/lib/session";
import { shortId, usePlayerNames } from "@/lib/usePlayerNames";

const PAGE = 10;

const GAME_ART: Record<string, Icon3DName> = { "crack-the-code": "vault", gebeta: "mancala" };
const GAME_SHORT: Record<string, string> = { "crack-the-code": "CtC", gebeta: "Geb" };

const fmt = (n: number) => n.toLocaleString("en-US");
const day = (ts: number) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

type Result = "Won" | "Lost" | "Draw";

function resultFor(m: MatchSummary, profileId: string): Result {
  if (m.outcome.draw) return "Draw";
  return m.outcome.winner === m.players.indexOf(profileId) ? "Won" : "Lost";
}

interface Data {
  profile: Profile;
  rewards: PlayerRewards;
  matches: MatchSummary[];
  rank: LeaderboardRow | null;
  catalog: BadgeInfo[];
}

export function ProfileView({ id, own }: { id: string; own: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<"missing" | "failed" | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.profile(id), api.rewards(id), api.matches(id), api.leaderboard(), api.badges()]).then(
      ([profile, rewards, matches, board, catalog]) =>
        setData({
          profile,
          rewards,
          matches: [...matches].sort((a, b) => b.endedAt - a.endedAt),
          rank: board.rows.find((r) => r.profileId === profile.id) ?? null,
          catalog,
        }),
      (e) => setError(e instanceof ApiError && e.status === 404 ? "missing" : "failed"),
    );
  }, [id]);

  useEffect(load, [load]);

  if (error === "missing")
    return (
      <div className="card flex items-center gap-3 !px-3.5 !py-3">
        <Icon3D name="err404" size={44} />
        <div className="min-w-0 flex-1">
          <b className="text-small font-semibold">Profile not found</b>
          <p className="mono text-small text-ink-3">{shortId(id)}</p>
        </div>
        <ButtonLink href="/" size="sm">
          Home
        </ButtonLink>
      </div>
    );

  if (error === "failed")
    return (
      <div role="alert" className="flex items-start gap-3 rounded-[20px] bg-mismatch-soft p-3.5">
        <Icon3D name="warning" size={36} />
        <div className="flex flex-col gap-1.5">
          <b className="font-semibold text-mismatch">Couldn’t load this profile</b>
          <span className="text-small">Nothing is lost; we just couldn’t fetch it.</span>
          <Button size="sm" icon="refresh" className="self-start" onClick={load}>
            Try again
          </Button>
        </div>
      </div>
    );

  if (!data) return <Loading />;

  const { profile, rewards, matches, rank, catalog } = data;
  const tally = { Won: 0, Lost: 0, Draw: 0 };
  for (const m of matches) tally[resultFor(m, profile.id)]++;
  const mints = rewards.history.filter((h) => h.mintIndex !== null).length;
  const ratings = Object.entries(rewards.games)
    .filter(([, t]) => t.wins + t.losses + t.draws > 0)
    .map(([g, t]) => `${GAME_SHORT[g] ?? getGame(g)?.name ?? g} ${fmt(t.rating)}`);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <Avatar3D id={profile.id} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-[30px] font-semibold leading-[1.02] tracking-[-.045em]">{profile.name}</h1>
          <span className="text-small text-ink-2">Joined {day(profile.createdAt)}</span>
        </div>
      </header>

      {own && <PictureCard />}

      <IdCard id={profile.id} own={own} />

      <div className="grid grid-cols-3 gap-2">
        <Stat icon="podium" big={rank ? `#${rank.rank}` : "–"} label={rank ? `${fmt(rank.rating)} rating` : "Unranked"} href="/leaderboard" />
        <Stat icon="target" big={`${tally.Won}·${tally.Lost}·${tally.Draw}`} label="Wins · losses · draws" small />
        <Stat icon="token" big={fmt(rewards.points)} label="Points" />
      </div>

      <div className="card flex items-center gap-3 !px-3.5 !py-3">
        <Icon3D name="blockchain" size={34} />
        <div className="min-w-0 flex-1">
          <b className="font-semibold">{fmt(rewards.tokens)} tokens</b>
          <p className="text-small text-ink-2">
            {mints ? `Points minted in ${mints} ledger block${mints === 1 ? "" : "s"}` : "Points become tokens once they’re sealed on the ledger"}
          </p>
        </div>
        {ratings.length > 0 && <span className="mono whitespace-nowrap text-right text-small text-ink-2">{ratings.join(" · ")}</span>}
      </div>

      <Badges profileId={profile.id} catalog={catalog} earned={rewards.badges} watched={rewards.watched.length} own={own} />

      <History profileId={profile.id} matches={matches} rewards={rewards} own={own} />
    </div>
  );
}

function PictureCard() {
  const { profile, setAvatar } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = async (a: AvatarName) => {
    setBusy(true);
    try {
      await setAvatar(a);
      setOpen(false);
    } catch {
      toast.show({ icon: "warning", body: "Couldn’t save your picture. Try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card flex flex-col gap-3 !px-3.5 !py-3">
      <div className="flex items-center gap-3">
        <b className="min-w-0 flex-1 font-semibold">Profile picture</b>
        <Button size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? "Cancel" : "Change"}
        </Button>
      </div>
      {open && (
        <AvatarPicker value={isAvatar(profile?.avatar) ? profile.avatar : null} onChange={pick} disabled={busy} />
      )}
    </div>
  );
}

function IdCard({ id, own }: { id: string; own: boolean }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      toast.show({ icon: "idcard", body: own ? "Copied your profile ID" : "Copied the profile ID" });
    } catch {
      toast.show({ icon: "warning", tone: "warn", body: `Couldn’t copy. The ID is ${id}` });
    }
  };
  return (
    <div className="card flex flex-col gap-1.5 !px-3.5 !py-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Icon3D name="idcard" size={26} />
          <span className="eyebrow">Profile ID</span>
        </span>
        <Button size="sm" icon="link" onClick={copy}>
          Copy
        </Button>
      </div>
      <span className="mono text-[13px]" data-testid="profile-id">
        {id}
      </span>
      {own && <span className="text-small text-ink-2">Created for you, held by Battle Arena, no wallet needed.</span>}
    </div>
  );
}

function Stat({ icon, big, label, small, href }: { icon: Icon3DName; big: string; label: string; small?: boolean; href?: string }) {
  const body = (
    <>
      <Icon3D name={icon} size={28} />
      <div className={`mono mt-1.5 font-semibold tracking-[-.04em] ${small ? "text-[22px]" : "text-[28px]"} leading-tight`}>{big}</div>
      <span className="text-small text-ink-2">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="card !p-3.5 hover:bg-sf-2">
      {body}
    </Link>
  ) : (
    <div className="card !p-3.5">{body}</div>
  );
}

function History({ profileId, matches, rewards, own }: { profileId: string; matches: MatchSummary[]; rewards: PlayerRewards; own: boolean }) {
  const [count, setCount] = useState(PAGE);
  const shown = matches.slice(0, count);
  const names = usePlayerNames(shown.length ? [...new Set(shown.flatMap((m) => m.players))] : undefined);
  const points = new Map(rewards.history.map((h) => [h.matchId, h.points]));

  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-2.5">
      <h2 id="history-heading" className="eyebrow px-0.5">
        Match history
      </h2>
      {matches.length === 0 ? (
        <div className="card flex flex-col items-center gap-2.5 !p-4 text-center">
          <Icon3D name="controller" size={72} />
          <b className="text-[17px] font-semibold">No matches yet</b>
          <span className="text-small text-ink-2">
            {own ? "Your first finished match puts points, a rank and your first badge here." : "Finished matches will show up here."}
          </span>
          {own && (
            <ButtonLink href="/" variant="sec" icon="lightning" block>
              Play a match
            </ButtonLink>
          )}
        </div>
      ) : (
        <>
          <ul className="card !px-3.5 !py-1">
            {shown.map((m) => {
              const opponent = m.players[m.players.indexOf(profileId) === 0 ? 1 : 0];
              const pts = points.get(m.matchId);
              return (
                <li key={m.matchId} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                  <Icon3D name={GAME_ART[m.gameId] ?? "controller"} size={34} />
                  <Link href={`/replay/${m.matchId}`} className="min-w-0 flex-1 hover:underline">
                    <p className="truncate">
                      <b className="font-semibold">{resultFor(m, profileId)}</b> vs {names[opponent] ?? shortId(opponent)}
                    </p>
                    <p className="truncate text-small text-ink-2">
                      {getGame(m.gameId)?.name ?? m.gameId}
                      {pts !== undefined && ` · +${pts}`}
                    </p>
                  </Link>
                  <RecordChip state={m.status} block={m.resultIndex} />
                </li>
              );
            })}
          </ul>
          {matches.length > count && (
            <button type="button" className="self-center text-small text-ink-2 underline" onClick={() => setCount((c) => c + PAGE)}>
              Showing {count} of {matches.length} · Load more
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-3.5" aria-busy aria-label="Loading profile">
      <div className="flex items-center gap-4">
        <div className="h-[84px] w-[84px] animate-pulse rounded-[28px] bg-sf" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-[18px] w-3/5 animate-pulse rounded-xl bg-sf" />
          <div className="h-3 w-2/5 animate-pulse rounded-xl bg-sf" />
        </div>
      </div>
      {[92, 110, 60].map((h, i) => (
        <div key={i} className="animate-pulse rounded-card bg-sf" style={{ height: h, opacity: 1 - i * 0.2 }} />
      ))}
    </div>
  );
}
