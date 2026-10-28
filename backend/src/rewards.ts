// Points, ratings, badges and tokens. Everything here is derived from
// recorded matches (the recorder's "recorded" event), so every reward traces
// back to a result block. Badges and token mints get their own ledger blocks.

import { Router } from "express";
import { crackTheCode, type CtcState } from "../../engine/games/crackTheCode";
import { gebeta, storeOf, type GebetaState } from "../../engine/games/gebeta";
import { getGame, listGames } from "../../engine/registry";
import { replay } from "../../engine/replay";
import type { MatchRecord, Seat } from "../../engine/types";
import type { Ledger } from "./ledger";
import type { StoredMatch } from "./recorder";
import type { Store } from "./store";

const REWARDS = "rewards";

export const POINTS = {
  win: 10,
  draw: 5,
  loss: 2,
  bot: 1,
  tournamentWin: 30,
  firstOfDay: 3,
} as const;

export const START_RATING = 1000;
export const ELO_K = 32;
/** The same two players earn points and rank from at most this many matches per window. */
export const FARM_CAP = 3;
export const FARM_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WATCHER_COUNT = 3;

export type BadgeId = "firstBlood" | "codebreaker" | "seedMaster" | "onARoll" | "explorer" | "champion" | "watcher";

export const BADGES: Record<BadgeId, { name: string; description: string; art: string }> = {
  firstBlood: { name: "First Blood", description: "First win against a player", art: "🩸" },
  codebreaker: { name: "Codebreaker", description: "Win Crack the Code in 5 rounds or fewer", art: "🔓" },
  seedMaster: { name: "Seed Master", description: "Win Gebeta by 10 or more seeds", art: "🌱" },
  onARoll: { name: "On a Roll", description: "3 wins in a row against players", art: "🔥" },
  explorer: { name: "Explorer", description: "Finish a match in every launch game", art: "🧭" },
  champion: { name: "Champion", description: "Win a tournament", art: "🏆" },
  watcher: { name: "Watcher", description: "Spectate 3 matches to the end", art: "👀" },
};

export interface EarnedBadge {
  id: BadgeId;
  name: string;
  earnedAt: number;
  /** What earned it: a match id, or a tournament id for Champion. */
  source: string;
  /** The badge block, null while pending. */
  ledgerIndex: number | null;
}

export interface Tally {
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface RewardEntry {
  /** The match, or tournament id for a tournament bonus. */
  source: string;
  matchId: string | null;
  gameId: string | null;
  ts: number;
  points: number;
  /** Counted for rating (human opponent, under the farming cap). */
  rated: boolean;
  /** Why the points were given, e.g. ["win", "firstOfDay"] or ["farmed"]. */
  reasons: string[];
  resultIndex: number | null;
  /** The mint block for these points, null while pending or when 0 points. */
  mintIndex: number | null;
}

export interface PlayerRewards {
  points: number;
  /** Points that are sealed in mint blocks. */
  tokens: number;
  overall: Tally;
  games: Record<string, Tally>;
  /** Consecutive wins against players. */
  streak: number;
  /** Games this player has finished a rewarded match in. */
  played: string[];
  /** Matches spectated to the end. */
  watched: string[];
  /** UTC day (YYYY-MM-DD) of the last rewarded match. */
  lastDay: string | null;
  badges: EarnedBadge[];
  history: RewardEntry[];
}

interface RewardsState {
  players: Record<string, PlayerRewards>;
  /** Pair key -> endedAt of each rewarded match between those two players. */
  pairs: Record<string, number[]>;
  processed: Record<string, true>;
}

export interface LeaderboardRow {
  rank: number;
  profileId: string;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  profile: string;
  matches: { matchId: string; resultIndex: number | null; url: string }[];
}

export interface RewardsOptions {
  /** True for real profiles. Anything else in a record (the bot) is skipped. */
  isPlayer: (id: string) => boolean;
  nameOf?: (id: string) => string;
  /** Pushes a `notify` payload to a player's sockets. */
  notify?: (profileId: string, payload: Record<string, unknown>) => void;
}

const newTally = (): Tally => ({ rating: START_RATING, wins: 0, losses: 0, draws: 0 });

const newPlayer = (): PlayerRewards => ({
  points: 0,
  tokens: 0,
  overall: newTally(),
  games: {},
  streak: 0,
  played: [],
  watched: [],
  lastDay: null,
  badges: [],
  history: [],
});

export const utcDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const pairKey = (a: string, b: string) => [a, b].sort().join(":");

export function expected(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** New ratings after a rated match; score is seat 0's result (1, 0.5 or 0). */
export function elo(a: number, b: number, score: number): [number, number] {
  const delta = ELO_K * (score - expected(a, b));
  return [Math.round(a + delta), Math.round(b - delta)];
}

/** Game-specific badges, read from the final state of the replayed log. */
function gameBadges(record: MatchRecord, seat: Seat): BadgeId[] {
  const { outcome } = record;
  if (outcome.winner !== seat || outcome.reason === "forfeit") return [];
  const game = getGame(record.gameId);
  if (!game) return [];
  const { state } = replay(game, record.seed, record.log);
  if (record.gameId === crackTheCode.id) {
    const s = state as CtcState;
    return outcome.reason === "cracked the code" && s.round <= 5 ? ["codebreaker"] : [];
  }
  if (record.gameId === gebeta.id) {
    const s = state as GebetaState;
    const margin = s.board[storeOf(seat)] - s.board[storeOf(seat === 0 ? 1 : 0)];
    return margin >= 10 ? ["seedMaster"] : [];
  }
  return [];
}

/** Emits "applied" (matchId) once a recorded match's rewards are saved. */
export class Rewards {
  private readonly isPlayer: (id: string) => boolean;
  private readonly nameOf: (id: string) => string;
  private readonly notify: (profileId: string, payload: Record<string, unknown>) => void;

  constructor(
    private readonly store: Store,
    private readonly ledger: Ledger,
    options: RewardsOptions,
  ) {
    this.isPlayer = options.isPlayer;
    this.nameOf = options.nameOf ?? ((id) => id);
    this.notify = options.notify ?? (() => {});
  }

  private state(): RewardsState {
    return this.store.read<RewardsState>(REWARDS, { players: {}, pairs: {}, processed: {} });
  }

  private change(fn: (s: RewardsState) => void) {
    const s = structuredClone(this.state());
    fn(s);
    this.store.write(REWARDS, s);
  }

  player(profileId: string): PlayerRewards {
    return this.state().players[profileId] ?? newPlayer();
  }

  /** Apply the points table, ratings and badges for one recorded match. Idempotent per match. */
  matchRecorded(stored: StoredMatch): void {
    const { record } = stored;
    if (this.state().processed[record.matchId]) return;

    const humans = ([0, 1] as const).filter((seat) => this.isPlayer(record.players[seat]));
    const vsPlayer = !record.bot && humans.length === 2 && record.players[0] !== record.players[1];
    const pair = pairKey(record.players[0], record.players[1]);
    const mints: { profileId: string; points: number }[] = [];
    const capped: string[] = [];
    const badges: { profileId: string; badge: EarnedBadge }[] = [];

    this.change((s) => {
      s.processed[record.matchId] = true;
      if (!humans.length) return;

      // Anti-farming: past the cap, the match still records but awards nothing.
      let farmed = false;
      if (vsPlayer) {
        const recent = (s.pairs[pair] ?? []).filter((t) => record.endedAt - t < FARM_WINDOW_MS);
        farmed = recent.length >= FARM_CAP;
        s.pairs[pair] = farmed ? recent : [...recent, record.endedAt];
      }

      if (vsPlayer && !farmed) this.rate(s, record);

      for (const seat of humans) {
        const id = record.players[seat];
        const p = (s.players[id] ??= newPlayer());
        const entry: RewardEntry = {
          source: record.matchId,
          matchId: record.matchId,
          gameId: record.gameId,
          ts: record.endedAt,
          points: 0,
          rated: vsPlayer && !farmed,
          reasons: [],
          resultIndex: stored.resultIndex,
          mintIndex: null,
        };
        p.history.unshift(entry);
        if (farmed) {
          entry.reasons.push("farmed");
          capped.push(id);
          continue;
        }

        const { winner, draw } = record.outcome;
        const result = draw ? "draw" : winner === seat ? "win" : "loss";
        entry.reasons.push(vsPlayer ? result : "bot");
        entry.points += vsPlayer ? POINTS[result] : POINTS.bot;

        const day = utcDay(record.endedAt);
        if (p.lastDay !== day) {
          entry.points += POINTS.firstOfDay;
          entry.reasons.push("firstOfDay");
          p.lastDay = day;
        }
        p.points += entry.points;
        mints.push({ profileId: id, points: entry.points });

        if (!p.played.includes(record.gameId)) p.played.push(record.gameId);

        const earned = gameBadges(record, seat);
        if (vsPlayer) {
          p.streak = result === "win" ? p.streak + 1 : 0;
          if (result === "win") earned.push("firstBlood");
          if (p.streak >= 3) earned.push("onARoll");
        }
        if (listGames().every((g) => p.played.includes(g.id))) earned.push("explorer");
        for (const badge of this.grant(p, earned, record.matchId, record.endedAt)) badges.push({ profileId: id, badge });
      }
    });

    // The result card says why a capped match paid nothing.
    for (const profileId of capped) this.notify(profileId, { kind: "points", matchId: record.matchId, points: 0, reasons: ["farmed"] });
    for (const { profileId, points } of mints) {
      this.notify(profileId, { kind: "points", matchId: record.matchId, points });
      this.mint(profileId, points, record.matchId, record.endedAt);
    }
    for (const { profileId, badge } of badges) this.sealBadge(profileId, badge);
  }

  /** Tournament winner: bonus points and the Champion badge. For T11. */
  tournamentWon(profileId: string, tournamentId: string, ts = Date.now()): void {
    let badge: EarnedBadge | undefined;
    this.change((s) => {
      const p = (s.players[profileId] ??= newPlayer());
      p.points += POINTS.tournamentWin;
      p.history.unshift({
        source: tournamentId,
        matchId: null,
        gameId: null,
        ts,
        points: POINTS.tournamentWin,
        rated: false,
        reasons: ["tournamentWin"],
        resultIndex: null,
        mintIndex: null,
      });
      [badge] = this.grant(p, ["champion"], tournamentId, ts);
    });
    this.notify(profileId, { kind: "points", tournamentId, points: POINTS.tournamentWin });
    this.mint(profileId, POINTS.tournamentWin, tournamentId, ts);
    if (badge) this.sealBadge(profileId, badge);
  }

  /** A spectator watched a match to the end. Grants Watcher at 3. For T8. */
  spectated(profileId: string, matchId: string, ts = Date.now()): void {
    let badge: EarnedBadge | undefined;
    this.change((s) => {
      const p = (s.players[profileId] ??= newPlayer());
      if (p.watched.includes(matchId)) return;
      p.watched.push(matchId);
      if (p.watched.length >= WATCHER_COUNT) [badge] = this.grant(p, ["watcher"], matchId, ts);
    });
    if (badge) this.sealBadge(profileId, badge);
  }

  leaderboard(gameId?: string): LeaderboardRow[] {
    const rows = Object.entries(this.state().players)
      .map(([profileId, p]) => {
        const t = gameId ? p.games[gameId] : p.overall;
        if (!t || t.wins + t.losses + t.draws === 0) return null;
        const matches = p.history
          .filter((h) => h.rated && h.matchId && (!gameId || h.gameId === gameId))
          .slice(0, 10)
          .map((h) => ({ matchId: h.matchId!, resultIndex: h.resultIndex, url: `/api/matches/${h.matchId}` }));
        return { profileId, name: this.nameOf(profileId), ...t, points: p.points, profile: `/api/profiles/${profileId}`, matches };
      })
      .filter((r) => r !== null)
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins || b.points - a.points);
    return rows.map((r, i) => ({ rank: i + 1, ...r }));
  }

  private rate(s: RewardsState, record: MatchRecord) {
    const [a, b] = record.players.map((id) => (s.players[id] ??= newPlayer()));
    const score = record.outcome.draw ? 0.5 : record.outcome.winner === 0 ? 1 : 0;
    const tallies: [Tally, Tally][] = [
      [a.overall, b.overall],
      [(a.games[record.gameId] ??= newTally()), (b.games[record.gameId] ??= newTally())],
    ];
    for (const [ta, tb] of tallies) {
      [ta.rating, tb.rating] = elo(ta.rating, tb.rating, score);
      if (score === 0.5) {
        ta.draws++;
        tb.draws++;
      } else {
        (score === 1 ? ta : tb).wins++;
        (score === 1 ? tb : ta).losses++;
      }
    }
  }

  /** Adds badges the player does not have yet; returns the new ones. */
  private grant(p: PlayerRewards, ids: BadgeId[], source: string, ts: number): EarnedBadge[] {
    const fresh = [...new Set(ids)].filter((id) => !p.badges.some((b) => b.id === id));
    const earned = fresh.map((id) => ({ id, name: BADGES[id].name, earnedAt: ts, source, ledgerIndex: null }));
    p.badges.push(...earned);
    return earned;
  }

  private mint(profileId: string, amount: number, source: string, ts: number) {
    if (amount <= 0) return;
    void this.ledger.append("mint", { to: profileId, amount, source, ts }).then((block) => {
      this.change((s) => {
        const p = s.players[profileId];
        p.tokens += amount;
        const entry = p.history.find((h) => h.source === source);
        if (entry && entry.mintIndex === null) entry.mintIndex = block.index;
      });
    });
  }

  private sealBadge(profileId: string, badge: EarnedBadge) {
    const payload = { profileId, badge: badge.id, source: badge.source, ts: badge.earnedAt };
    void this.ledger.append("badge", payload).then((block) => {
      this.change((s) => {
        const b = s.players[profileId].badges.find((x) => x.id === badge.id);
        if (b) b.ledgerIndex = block.index;
      });
      this.notify(profileId, { kind: "badge", badge: { ...badge, ...BADGES[badge.id], ledgerIndex: block.index } });
    });
  }
}

export function rewardRoutes(rewards: Rewards, profileExists: (id: string) => boolean): Router {
  const router = Router();

  router.get("/api/badges", (_req, res) => {
    res.json(Object.entries(BADGES).map(([id, b]) => ({ id, ...b })));
  });

  router.get("/api/leaderboard", (req, res) => {
    const game = typeof req.query.game === "string" && req.query.game ? req.query.game : undefined;
    if (game && !getGame(game)) {
      res.status(404).json({ error: "unknown game" });
      return;
    }
    res.json({ game: game ?? null, rows: rewards.leaderboard(game) });
  });

  // Points, token balance, ratings and badge inventory for a profile page.
  router.get("/api/profiles/:id/rewards", (req, res) => {
    const id = req.params.id.toLowerCase();
    if (!profileExists(id)) {
      res.status(404).json({ error: "profile not found" });
      return;
    }
    const p = rewards.player(id);
    res.json({ ...p, badges: p.badges.map((b) => ({ ...b, ...BADGES[b.id] })) });
  });

  return router;
}
