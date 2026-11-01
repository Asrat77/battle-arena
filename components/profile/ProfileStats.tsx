// One compact card: rank, record, points and tokens side by side.

import Link from "next/link";
import type { LeaderboardRow, PlayerRewards } from "@/lib/api";

export const fmt = (n: number) => n.toLocaleString("en-US");

export function ProfileStats({ rank, rewards, tally }: { rank: LeaderboardRow | null; rewards: PlayerRewards; tally: { Won: number; Lost: number; Draw: number } }) {
  return (
    <dl className="card grid grid-cols-4 divide-x divide-line !px-1 !py-3 text-center">
      <Cell label={rank ? "Rank" : "Unranked"} href="/leaderboard">
        {rank ? `#${rank.rank}` : "–"}
      </Cell>
      <Cell label="W · L · D">{`${tally.Won}·${tally.Lost}·${tally.Draw}`}</Cell>
      <Cell label="Points">{fmt(rewards.points)}</Cell>
      <Cell label="Tokens">{fmt(rewards.tokens)}</Cell>
    </dl>
  );
}

function Cell({ label, children, href }: { label: string; children: string; href?: string }) {
  const body = (
    <>
      <dd className="mono order-1 text-[19px] font-semibold leading-tight tracking-[-.04em] sm:text-[22px]">{children}</dd>
      <dt className="order-2 text-[11px] text-ink-2">{label}</dt>
    </>
  );
  const cls = "flex min-w-0 flex-col px-1";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-sf-2`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
