"use client";

// The seven badges: earned ones on a saffron-rimmed plate with their block,
// locked ones grey in a dashed ring with how to earn them. Tapping either
// opens a sheet; an earned badge's sheet links to the block that sealed it.

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink, Button } from "@/components/ui/Button";
import { RecordChip } from "@/components/ui/Chip";
import { Sheet } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import type { BadgeInfo, EarnedBadge } from "@/lib/api";
import { BADGE_HINTS, BADGE_ICONS, BADGE_ORDER, WATCHER_COUNT } from "@/lib/badges";

const day = (ts: number) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function Badges({
  catalog,
  earned,
  watched,
  own,
  profileId,
}: {
  profileId: string;
  catalog: BadgeInfo[];
  earned: EarnedBadge[];
  watched: number;
  own: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const byId = new Map(earned.map((b) => [b.id, b]));
  const list = [...catalog].sort((a, b) => order(a.id) - order(b.id));
  const shown = list.find((b) => b.id === open);

  const hint = (b: BadgeInfo) => (b.id === "watcher" && own && watched > 0 ? `${Math.min(watched, WATCHER_COUNT)} of ${WATCHER_COUNT}` : (BADGE_HINTS[b.id] ?? b.description));

  return (
    <section aria-labelledby="badges-heading" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between px-0.5">
        <h2 id="badges-heading" className="eyebrow">
          Badges
        </h2>
        <span className="text-small text-ink-2">
          {byId.size} of {list.length}
        </span>
      </div>
      <ul className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-7">
        {list.map((b) => {
          const got = byId.get(b.id);
          return (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => setOpen(b.id)}
                aria-label={`${b.name}, ${got ? "earned" : `locked: ${hint(b)}`}`}
                className="flex w-full flex-col items-center gap-1.5 text-center"
              >
                <Badge icon={BADGE_ICONS[b.id] ?? "medalgold"} size={64} locked={!got} />
                <b className="text-[12px] font-semibold leading-tight">{b.name}</b>
                <span className="text-[10.5px] leading-tight text-ink-3">
                  {got ? (got.ledgerIndex === null ? "Sealing…" : `#${got.ledgerIndex}`) : hint(b)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {shown && <BadgeSheet profileId={profileId} badge={shown} earned={byId.get(shown.id)} hint={hint(shown)} onClose={() => setOpen(null)} />}
    </section>
  );
}

function order(id: string) {
  const i = (BADGE_ORDER as readonly string[]).indexOf(id);
  return i === -1 ? BADGE_ORDER.length : i;
}

function BadgeSheet({
  profileId,
  badge,
  earned,
  hint,
  onClose,
}: {
  profileId: string;
  badge: BadgeInfo;
  earned?: EarnedBadge;
  hint: string;
  onClose(): void;
}) {
  const toast = useToast();
  const icon = BADGE_ICONS[badge.id] ?? "medalgold";
  // Champion's source is a tournament; every other badge points at a match.
  const match = earned && badge.id !== "champion" ? earned.source : null;

  const share = async () => {
    const url = `${window.location.origin}/profile/${profileId}`;
    const text = `I earned ${badge.name} on Battle Arena`;
    try {
      if (navigator.share) await navigator.share({ title: badge.name, text, url });
      else {
        await navigator.clipboard.writeText(`${text}: ${url}`);
        toast.show({ icon: "link", body: "Copied a link to this profile" });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.show({ icon: "warning", tone: "warn", body: "Couldn’t share. Copy the address bar instead." });
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={badge.name}
      hero={
        <div className="relative flex h-[150px] items-center justify-center overflow-hidden">
          <div className="dither !h-[150px]" aria-hidden />
          <span className={earned ? "rounded-full shadow-[0_0_40px_rgb(243_181_66/.3)]" : ""}>
            <Badge icon={icon} size={130} locked={!earned} />
          </span>
        </div>
      }
    >
      {earned ? (
        <>
          <p className="text-ink-2">
            Earned {day(earned.earnedAt)} · {badge.description}
            {match && (
              <>
                {" · "}
                <Link href={`/replay/${match}`} className="text-ink underline underline-offset-2">
                  see the match
                </Link>
              </>
            )}
          </p>
          <div>
            <RecordChip state={earned.ledgerIndex === null ? "pending" : "recorded"} block={earned.ledgerIndex} long />
          </div>
          <div className="flex gap-2 [&>*]:flex-1">
            {earned.ledgerIndex !== null && (
              <ButtonLink href={`/ledger#block-${earned.ledgerIndex}`} icon="blockchain">
                See the block
              </ButtonLink>
            )}
            <Button variant="act" icon="share" onClick={share}>
              Share
            </Button>
          </div>
        </>
      ) : (
        <p className="text-ink-2">
          Locked. <b className="font-semibold text-ink">{badge.description}</b>
          {badge.id === "watcher" && hint.includes(" of ") && ` (${hint} so far)`}
        </p>
      )}
    </Sheet>
  );
}
