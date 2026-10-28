// Top three on 3D-medal blocks, read 1 · 2 · 3 but drawn 2 · 1 · 3 with the crown over first.
// Empty steps keep their height so the podium shape holds with one or two
// ranked players.

import Link from "next/link";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import type { LeaderboardRow } from "@/lib/api";

const STEPS: { place: number; medal: Icon3DName; medalSize: number; height: number }[] = [
  { place: 1, medal: "medalgold", medalSize: 48, height: 124 },
  { place: 2, medal: "medalsilver", medalSize: 40, height: 96 },
  { place: 3, medal: "medalbronze", medalSize: 36, height: 80 },
];

export const fmt = (n: number) => n.toLocaleString("en-US");

export function Podium({ rows, you }: { rows: LeaderboardRow[]; you?: string }) {
  return (
    <div className="relative">
      <div className="dither -top-2.5 !h-[200px]" aria-hidden />
      <ol id="podium" className="relative grid grid-cols-3 items-end gap-2" aria-label="Top three">
      {STEPS.map(({ place, medal, medalSize, height }) => {
        const row = rows[place - 1];
        const mine = row && row.profileId === you;
        return (
          <li key={place} className="relative flex min-w-0 flex-col items-center gap-1.5 text-center" style={{ order: place === 1 ? 0 : place === 2 ? -1 : 1 }}>
            {place === 1 && <Icon3D name="crown" size={40} />}
            {row ? (
              <>
                <Avatar3D id={row.profileId} size="lg" seat={mine ? "you" : undefined} />
                <Link href={`/profile/${row.profileId}`} className="w-full truncate text-small font-semibold hover:underline">
                  {row.name}
                  {mine && <span className="text-you"> · you</span>}
                </Link>
              </>
            ) : (
              <>
                <span className="h-[84px] w-[84px] rounded-[28px] border-2 border-dashed border-sf-3" />
                <span className="text-small text-ink-3">Open</span>
              </>
            )}
            <div
              className={`flex w-full flex-col items-center gap-0.5 rounded-[18px_18px_6px_6px] pt-2.5 ${
                place === 1
                  ? "bg-[linear-gradient(180deg,rgb(243_181_66/.35),rgb(243_181_66/.06))] shadow-[inset_0_1px_0_rgb(243_181_66/.6)]"
                  : "bg-[linear-gradient(180deg,rgb(var(--sf2)),rgb(var(--sf)))]"
              }`}
              style={{ height }}
            >
              <Icon3D name={medal} size={medalSize} label={`Rank ${place}`} />
              {row && (
                <span className="mono text-[12px] text-ink-2" aria-label={`Rating ${row.rating}`}>
                  {fmt(row.rating)}
                </span>
              )}
            </div>
          </li>
        );
      })}
      </ol>
    </div>
  );
}
