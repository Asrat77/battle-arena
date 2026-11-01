"use client";

// Tap any player's name or avatar and a bottom sheet opens over whatever you
// are looking at (a live match, a room, a bracket), so you never get navigated
// away. Shows who they are, where they stand, and the same friend / Watch
// actions as their profile. Bots are never tappable.

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { FriendButton } from "@/components/profile/FriendButton";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { ButtonLink } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Overlay";
import { api, type LeaderboardRow, type Profile } from "@/lib/api";
import { useSession } from "@/lib/session";

type Open = (profileId: string) => void;
const Ctx = createContext<Open | null>(null);

export function PlayerSheetProvider({ children }: { children: React.ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback<Open>((p) => setId(p), []);
  const close = useCallback(() => setId(null), []);
  const path = usePathname();
  // Following a link out of the sheet (View profile, Watch live) should not leave it open on the next page.
  useEffect(() => setId(null), [path]);
  return (
    <Ctx.Provider value={open}>
      {children}
      {id && <PlayerSheet key={id} id={id} onClose={close} />}
    </Ctx.Provider>
  );
}

/** Wraps a name/avatar so tapping it opens the player sheet. Inert for bots and when there is no id. */
export function PlayerLink({
  id,
  bot,
  className = "",
  label,
  children,
}: {
  id?: string | null;
  bot?: boolean;
  className?: string;
  /** aria-label for avatar-only links. */
  label?: string;
  children: React.ReactNode;
}) {
  const open = useContext(Ctx);
  if (!id || bot || id === "bot" || !open) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => open(id)}
      className={`min-w-0 cursor-pointer rounded-lg text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
      data-testid="player-link"
    >
      {children}
    </button>
  );
}

function PlayerSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { profile: me } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rank, setRank] = useState<LeaderboardRow | null>(null);
  const [failed, setFailed] = useState(false);
  const own = me?.id === id;

  useEffect(() => {
    let live = true;
    api.profile(id).then(
      (p) => live && setProfile(p),
      () => live && setFailed(true),
    );
    api.leaderboard().then(
      (b) => live && setRank(b.rows.find((r) => r.profileId === id) ?? null),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [id]);

  const profileHref = own ? "/profile" : `/profile/${id}`;
  return (
    <Sheet open onClose={onClose} title={profile?.name ?? (failed ? "Player not found" : "Loading")}>
      {failed ? (
        <p className="text-ink-2">We couldn’t load this player. They may have been removed.</p>
      ) : (
        <>
          <div className="flex items-center gap-3.5">
            <Avatar3D id={id} size="lg" seat={own ? "you" : undefined} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-small text-ink-2">{profile ? `@${profile.username}` : " "}</span>
              <span className="text-small text-ink-2">
                {rank ? (
                  <>
                    Rank <b className="font-semibold text-ink">#{rank.rank}</b> · {rank.wins}–{rank.losses}
                    {rank.draws ? `–${rank.draws}` : ""}
                  </>
                ) : (
                  "Unranked"
                )}
              </span>
            </div>
          </div>
          {profile && !own && <FriendButton profile={profile} />}
          <ButtonLink href={profileHref} variant={own ? "act" : undefined} onClick={onClose}>
            View profile
          </ButtonLink>
        </>
      )}
    </Sheet>
  );
}

