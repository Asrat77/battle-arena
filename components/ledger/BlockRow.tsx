// One ledger block as a list row: the kind's 3D object, a one-line summary a
// judge can read, the index with a short hash and time, and a kind tag. The
// row keeps the #block-N anchor that RecordChip and badges link to.

import type { Block, BlockKind } from "@/engine/ledger";
import { getGame } from "@/engine/registry";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { shortId } from "@/lib/usePlayerNames";

export const KINDS: { kind: BlockKind; label: string; icon: Icon3DName; tone: ChipTone }[] = [
  { kind: "commit", label: "Commit", icon: "padlock", tone: "you" },
  { kind: "result", label: "Result", icon: "trophy", tone: "act" },
  { kind: "badge", label: "Badge", icon: "medalgold", tone: "pend" },
  { kind: "mint", label: "Mint", icon: "token", tone: "rec" },
];

const LOOK = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<BlockKind, (typeof KINDS)[number]>;

// Display names for the badge ids in backend/src/rewards.ts.
const BADGE_NAMES: Record<string, string> = {
  firstBlood: "First Blood",
  codebreaker: "Codebreaker",
  seedMaster: "Seed Master",
  onARoll: "On a Roll",
  explorer: "Explorer",
  champion: "Champion",
  watcher: "Watcher",
};

interface CommitPayload {
  matchId: string;
  gameId: string;
  players: string[];
}

export interface BlockPayload {
  matchId?: string;
  gameId?: string;
  players?: string[];
  winner?: number | null;
  to?: string;
  amount?: number;
  profileId?: string;
  badge?: string;
  source?: string;
}

/** Match id a block belongs to: commits and results name it, mints and badges carry it as their source. */
export function blockMatchId(block: Block): string | undefined {
  const p = (block.payload ?? {}) as BlockPayload;
  return p.matchId ?? p.source;
}

/** Profile ids a block's summary needs names for. */
export function blockPlayers(block: Block, commits: Map<string, CommitPayload>): string[] {
  const p = (block.payload ?? {}) as BlockPayload;
  if (block.kind === "mint") return p.to ? [p.to] : [];
  if (block.kind === "badge") return p.profileId ? [p.profileId] : [];
  return (p.players ?? (p.matchId ? commits.get(p.matchId)?.players : undefined)) ?? [];
}

/** Commit payloads by match id, so a result block can say who played what. */
export function commitIndex(blocks: Block[]): Map<string, CommitPayload> {
  const map = new Map<string, CommitPayload>();
  for (const b of blocks) {
    const p = b.payload as Partial<CommitPayload> | null;
    if (b.kind === "commit" && p?.matchId && p.players) map.set(p.matchId, p as CommitPayload);
  }
  return map;
}

export function summarize(block: Block, commits: Map<string, CommitPayload>, names: Record<string, string>): string {
  const p = (block.payload ?? {}) as BlockPayload;
  const name = (id?: string) => (id ? (names[id] ?? shortId(id)) : "someone");
  const match = p.matchId ? commits.get(p.matchId) : undefined;
  const game = getGame(p.gameId ?? match?.gameId ?? "")?.name;
  switch (block.kind) {
    case "commit": {
      const [a, b] = p.players ?? [];
      return `Secrets locked · ${name(a)} vs ${name(b)}`;
    }
    case "result": {
      const players = match?.players;
      const tail = game ? ` · ${game}` : "";
      if (!players) return `Result · match ${shortId(p.matchId ?? "?")}`;
      if (p.winner == null) return `Draw · ${name(players[0])} vs ${name(players[1])}${tail}`;
      return `${name(players[p.winner])} beat ${name(players[1 - p.winner])}${tail}`;
    }
    case "mint": {
      const n = p.amount ?? 0;
      return `+${n} token${n === 1 ? "" : "s"} to ${name(p.to)}`;
    }
    case "badge":
      return `${name(p.profileId)} earned ${BADGE_NAMES[p.badge ?? ""] ?? p.badge ?? "a badge"}`;
  }
}

function shortHash(hash: string) {
  return `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}

function when(ts: number) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export function BlockRow({ block, summary, highlight }: { block: Block; summary: string; highlight?: boolean }) {
  const look = LOOK[block.kind];
  return (
    <li
      id={`block-${block.index}`}
      className={`row -mx-2 scroll-mt-24 px-2 transition-colors duration-700 ${highlight ? "rounded-2xl border-transparent bg-accent/20" : ""}`}
    >
      <Icon3D name={look?.icon ?? "blockchain"} size={34} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-small font-semibold">{summary}</p>
        <p className="mono text-[11px] text-ink-3">
          #{block.index} · {shortHash(block.hash)} · <time dateTime={new Date(block.ts).toISOString()}>{when(block.ts)}</time>
        </p>
      </div>
      <Chip tone={look?.tone} className="!h-[22px] !text-[11px]">
        {look?.label ?? block.kind}
      </Chip>
    </li>
  );
}
