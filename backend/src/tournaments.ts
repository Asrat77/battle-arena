// Single-elimination tournaments of 4, 8 or 16 players for any game, each
// pairing played as one game or a best-of-3 series. A host opens one, others
// join by id (or the host starts early and bots fill the empty seats), and it
// starts when full. Every game goes through the normal runtime, so it is
// refereed, recorded and replayable like any other match.

import { randomBytes, randomInt } from "node:crypto";
import { Router } from "express";
import type { Server, Socket } from "socket.io";
import { getGame, listGames } from "../../engine/registry";
import { createRng } from "../../engine/rng";
import type { AnyGame } from "../../engine/types";
import { systemClock, type Clock } from "./clock";
import type { Identity } from "./identity";
import { BOT_PLAYER } from "./lobby";
import { profileRoom, type Match, type MatchRuntime } from "./matches";
import type { Store } from "./store";

export const TOURNAMENT_SIZES = [4, 8, 16] as const;
export const BEST_OF = [1, 3] as const;
export type TournamentSize = (typeof TOURNAMENT_SIZES)[number];
export type BestOf = (typeof BEST_OF)[number];
export type Visibility = "open" | "link";
/** Size when create does not say. Kept at 4 so the old create sheet behaves as before. */
export const DEFAULT_SIZE: TournamentSize = 4;
/** Pause between a pairing being decided and the next round's match starting, so players see the result. */
export const ROUND_BREAK_MS = 5_000;
/** Pause between the games of a best-of-3 series. */
export const SERIES_BREAK_MS = 3_000;
/**
 * Drawn games in one pairing are replayed this many times. After that a
 * best-of-1 is settled by a seeded coin flip, and a best-of-3 goes to whoever
 * leads the series (coin flip if level).
 */
export const MAX_REMATCHES = 2;
export const NAME_MAX = 40;
const TOURNAMENTS = "tournaments";

interface Entrant {
  id: string;
  name: string;
  bot: boolean;
}

interface Game {
  matchId: string;
  /** Entrant index in seat 0 and seat 1. */
  seats: [number, number];
  /** Entrant index of the game's winner; null for a draw or while it is being played. */
  winner: number | null;
  done: boolean;
}

interface BracketMatch {
  /** Entrant indexes, null until the feeding matches are decided. */
  players: [number, number] | null;
  /** Every game played for this slot, series games and rematches after draws included. */
  matchIds: string[];
  games: Game[];
  winner: number | null;
  decidedBy: "match" | "coin flip" | null;
}

export interface Tournament {
  id: string;
  name: string;
  gameId: string;
  host: string | null;
  size: TournamentSize;
  bestOf: BestOf;
  visibility: Visibility;
  state: "open" | "running" | "finished";
  entrants: Entrant[];
  /** rounds[0] is the first round (size / 2 matches), the last round is the final. */
  rounds: BracketMatch[][];
  champion: number | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

/** What tournament:create takes. Everything but gameId is optional. */
export interface CreateInput {
  gameId?: unknown;
  name?: unknown;
  size?: unknown;
  bestOf?: unknown;
  visibility?: unknown;
  fillWithBots?: unknown;
}

export interface TournamentOptions {
  clock?: Clock;
  games?: { get(id: string): AnyGame | undefined; list(): AnyGame[] };
  /** Called once with the human champion's profile id (rewards.tournamentWon). */
  onChampion?: (profileId: string, tournamentId: string, ts: number) => void;
}

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: string };
type Ack = (res: Result<Record<string, unknown>>) => void;

export const tournamentChannel = (id: string) => `tournament:${id}`;

const emptySlot = (): BracketMatch => ({ players: null, matchIds: [], games: [], winner: null, decidedBy: null });

/** Empty bracket: size/2 first-round slots, halving each round down to the final. */
export function emptyRounds(size: number): BracketMatch[][] {
  const rounds: BracketMatch[][] = [];
  for (let n = size / 2; n >= 1; n /= 2) rounds.push(Array.from({ length: n }, emptySlot));
  return rounds;
}

/** "Final", "Semifinal", "Quarterfinal", then "Round of 16". */
export function roundName(round: number, roundCount: number) {
  const left = roundCount - round;
  if (left === 1) return "Final";
  if (left === 2) return "Semifinal";
  if (left === 3) return "Quarterfinal";
  return `Round of ${2 ** left}`;
}

/**
 * Standard bracket order of seeds (0-based) for the first round: consecutive
 * pairs play each other, and seeds 1 and 2 can only meet in the final.
 * 4 → [0,3,1,2], 8 → [0,7,3,4,1,6,2,5].
 */
export function seedOrder(size: number): number[] {
  let order = [0];
  for (let n = 2; n <= size; n *= 2) order = order.flatMap((s) => [s, n - 1 - s]);
  return order;
}

/** Validate create's options; unknown or missing ones fall back to the defaults. */
export function parseCreate(msg: CreateInput, gameName: string): Result<{ name: string; size: TournamentSize; bestOf: BestOf; visibility: Visibility }> {
  const size = msg.size ?? DEFAULT_SIZE;
  if (!TOURNAMENT_SIZES.includes(size as TournamentSize)) return { ok: false, reason: "size must be 4, 8 or 16" };
  const bestOf = msg.bestOf ?? 1;
  if (!BEST_OF.includes(bestOf as BestOf)) return { ok: false, reason: "best of must be 1 or 3" };
  const visibility = msg.visibility ?? "open";
  if (visibility !== "open" && visibility !== "link") return { ok: false, reason: "visibility must be open or link" };
  if (msg.name !== undefined && msg.name !== null && typeof msg.name !== "string") return { ok: false, reason: "name must be text" };
  const name = typeof msg.name === "string" ? msg.name.replace(/\s+/g, " ").trim() : "";
  if (name.length > NAME_MAX) return { ok: false, reason: `name must be at most ${NAME_MAX} characters` };
  return { ok: true, name: name || `${gameName} tournament`, size: size as TournamentSize, bestOf: bestOf as BestOf, visibility };
}

export class Tournaments {
  /** Live bracket game → where it sits in which tournament. */
  private byMatch = new Map<string, { id: string; round: number; slot: number }>();
  private readonly clock: Clock;
  private readonly games: NonNullable<TournamentOptions["games"]>;

  constructor(
    private readonly store: Store,
    private readonly io: Server,
    private readonly matches: MatchRuntime,
    private readonly identity: Identity,
    private readonly opts: TournamentOptions = {},
  ) {
    this.clock = opts.clock ?? systemClock;
    this.games = opts.games ?? { get: getGame, list: listGames };
    matches.on("end", (m: Match) => this.matchEnded(m));
  }

  attach(socket: Socket, profileId: string) {
    const reply = (ack: Ack | undefined, res: Result<Record<string, unknown>>) => {
      if (res.ok === false) socket.emit("tournament:error", { reason: res.reason });
      if (typeof ack === "function") ack(res);
    };
    const id = (msg: unknown) => (msg as { id?: unknown } | undefined)?.id;

    // A refresh gets the bracket of any tournament you are still in.
    for (const t of this.active()) {
      if (!t.entrants.some((e) => e.id === profileId)) continue;
      socket.join(tournamentChannel(t.id));
      socket.emit("tournament:update", this.payload(t));
    }

    socket.on("tournament:create", (msg: CreateInput | undefined, ack?: Ack) => reply(ack, this.create(profileId, msg ?? {})));
    socket.on("tournament:join", (msg: unknown, ack?: Ack) => reply(ack, this.join(profileId, id(msg))));
    socket.on("tournament:leave", (msg: unknown, ack?: Ack) => reply(ack, this.leave(profileId, id(msg))));
    // Both start early with bots in the empty seats; addBots is the older name.
    socket.on("tournament:start", (msg: unknown, ack?: Ack) => reply(ack, this.start(profileId, id(msg))));
    socket.on("tournament:addBots", (msg: unknown, ack?: Ack) => reply(ack, this.start(profileId, id(msg))));
    socket.on("tournament:watch", (msg: unknown, ack?: Ack) => {
      const t = this.find(id(msg));
      if (!t) return reply(ack, { ok: false, reason: "no such tournament" });
      socket.join(tournamentChannel(t.id));
      reply(ack, { ok: true, tournament: this.payload(t) });
    });
  }

  /**
   * Open a tournament. host null makes a hostless one (tests, demos).
   * fillWithBots starts it at once with bots in every empty seat.
   */
  create(host: string | null, input: CreateInput): Result<{ tournament: TournamentPayload }> {
    const game = typeof input.gameId === "string" ? this.games.get(input.gameId) : undefined;
    if (!game) return { ok: false, reason: "unknown game" };
    const opts = parseCreate(input, game.name);
    if (!opts.ok) return opts;
    if (host && this.activeFor(host)) return { ok: false, reason: "already in a tournament" };
    const t: Tournament = {
      id: randomBytes(4).toString("hex"),
      name: opts.name,
      gameId: game.id,
      host,
      size: opts.size,
      bestOf: opts.bestOf,
      visibility: opts.visibility,
      state: "open",
      entrants: host ? [this.entrant(host)] : [],
      rounds: emptyRounds(opts.size),
      champion: null,
      createdAt: this.clock.now(),
      startedAt: null,
      endedAt: null,
    };
    if (host) this.io.in(profileRoom(host)).socketsJoin(tournamentChannel(t.id));
    if (input.fillWithBots === true) this.fillBots(t);
    this.changed(t);
    return { ok: true, tournament: this.payload(t) };
  }

  join(profileId: string, id: unknown): Result<{ tournament: TournamentPayload }> {
    const t = this.find(id);
    if (!t) return { ok: false, reason: "no such tournament" };
    if (t.entrants.some((e) => e.id === profileId)) return { ok: true, tournament: this.payload(t) };
    if (t.state !== "open") return { ok: false, reason: "tournament already started" };
    if (this.activeFor(profileId)) return { ok: false, reason: "already in a tournament" };
    t.entrants.push(this.entrant(profileId));
    this.io.in(profileRoom(profileId)).socketsJoin(tournamentChannel(t.id));
    this.changed(t);
    return { ok: true, tournament: this.payload(t) };
  }

  leave(profileId: string, id: unknown): Result {
    const t = this.find(id);
    if (!t || !t.entrants.some((e) => e.id === profileId)) return { ok: false, reason: "not in that tournament" };
    if (t.state !== "open") return { ok: false, reason: "tournament already started" };
    t.entrants = t.entrants.filter((e) => e.id !== profileId);
    this.io.in(profileRoom(profileId)).socketsLeave(tournamentChannel(t.id));
    if (t.host === profileId) t.host = t.entrants.find((e) => !e.bot)?.id ?? null;
    this.changed(t);
    return { ok: true };
  }

  /** Host only: start now, with bots in the empty seats. */
  start(profileId: string, id: unknown): Result {
    const t = this.find(id);
    if (!t) return { ok: false, reason: "no such tournament" };
    if (t.host !== profileId) return { ok: false, reason: "only the host can start it" };
    if (t.state !== "open") return { ok: false, reason: "tournament already started" };
    this.fillBots(t);
    this.changed(t);
    return { ok: true };
  }

  /** @deprecated Older name for start. */
  addBots(profileId: string, id: unknown): Result {
    return this.start(profileId, id);
  }

  get(id: string) {
    const t = this.find(id);
    return t ? this.payload(t) : null;
  }

  /** Listed (open-visibility) tournaments: open and running first, then the most recent finished ones. */
  list(gameId?: string, limit = 20) {
    const order = { open: 0, running: 1, finished: 2 };
    return Object.values(this.all())
      .filter((t) => t.visibility !== "link")
      .filter((t) => !gameId || t.gameId === gameId)
      .sort((a, b) => order[a.state] - order[b.state] || b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((t) => this.payload(t));
  }

  // ---- bracket ----

  private fillBots(t: Tournament) {
    let n = t.entrants.filter((e) => e.bot).length;
    while (t.entrants.length < t.size) t.entrants.push({ id: BOT_PLAYER, name: `Bot ${++n}`, bot: true });
  }

  private begin(t: Tournament) {
    t.state = "running";
    t.startedAt = this.clock.now();
    // Random seeding, so whoever opened it does not always face the first joiner.
    for (let i = t.entrants.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [t.entrants[i], t.entrants[j]] = [t.entrants[j], t.entrants[i]];
    }
    const order = seedOrder(t.size);
    t.rounds[0].forEach((bm, slot) => {
      bm.players = [order[slot * 2], order[slot * 2 + 1]];
      this.play(t, 0, slot);
    });
  }

  /** Create the runtime match for the next game of one bracket slot. */
  private play(t: Tournament, round: number, slot: number) {
    const game = this.games.get(t.gameId)!;
    const bm = t.rounds[round][slot];
    const last = bm.games.at(-1);
    // A random side for the first game, then players swap seats every game.
    let seats = [...bm.players!] as [number, number];
    if (last) seats = [last.seats[1], last.seats[0]];
    else if (randomInt(2) === 1) seats.reverse();
    const players = seats.map((i) => t.entrants[i].id) as [string, string];
    const botSeats = ([0, 1] as const).filter((s) => t.entrants[seats[s]].bot);
    const m = this.matches.create({ game, players, botSeats });
    this.byMatch.set(m.id, { id: t.id, round, slot });
    bm.matchIds.push(m.id);
    bm.games.push({ matchId: m.id, seats, winner: null, done: false });
  }

  /** Start the slot's next game after ms, unless the tournament is gone or the slot moved on meanwhile. */
  private later(t: Tournament, round: number, slot: number, ms: number) {
    const games = t.rounds[round][slot].games.length;
    this.clock.setTimeout(() => {
      const live = this.find(t.id);
      if (live !== t || t.state !== "running") return;
      const bm = t.rounds[round][slot];
      if (bm.winner !== null || bm.games.length !== games) return;
      this.play(t, round, slot);
      this.changed(t);
    }, ms);
  }

  private matchEnded(m: Match) {
    const where = this.byMatch.get(m.id);
    if (!where) return;
    this.byMatch.delete(m.id);
    const t = this.find(where.id);
    if (!t) return;
    const { round, slot } = where;
    const bm = t.rounds[round][slot];
    const game = bm.games.find((g) => g.matchId === m.id);
    if (!game) return;
    const outcome = m.cur.outcome!;
    game.done = true;
    game.winner = outcome.winner === null ? null : game.seats[outcome.winner];

    const need = (t.bestOf + 1) / 2;
    const [wa, wb] = score(bm);
    const draws = bm.games.filter((g) => g.done && g.winner === null).length;
    if (wa >= need || wb >= need) {
      bm.winner = bm.players![wa >= need ? 0 : 1];
      bm.decidedBy = "match";
    } else if (game.winner === null && draws > MAX_REMATCHES) {
      if (wa !== wb) {
        bm.winner = bm.players![wa > wb ? 0 : 1];
        bm.decidedBy = "match";
      } else {
        const rng = createRng(`${t.id}:${round}:${slot}`);
        bm.winner = rng.pick(bm.players!);
        bm.decidedBy = "coin flip";
      }
    } else {
      // Series goes on: a drawn game is replayed at once (as before), the next
      // series game starts after a short break.
      if (game.winner === null) this.play(t, round, slot);
      else this.later(t, round, slot, SERIES_BREAK_MS);
      this.changed(t);
      return;
    }

    if (round === t.rounds.length - 1) {
      t.champion = bm.winner;
      t.state = "finished";
      t.endedAt = this.clock.now();
      const champ = t.entrants[t.champion!];
      if (!champ.bot) this.opts.onChampion?.(champ.id, t.id, t.endedAt);
    } else {
      // Each pairing moves on as soon as its two feeding matches are decided.
      const top = slot - (slot % 2);
      const [a, b] = [t.rounds[round][top], t.rounds[round][top + 1]];
      if (a.winner !== null && b.winner !== null) {
        const next = top / 2;
        t.rounds[round + 1][next].players = [a.winner, b.winner];
        this.later(t, round + 1, next, ROUND_BREAK_MS);
      }
    }
    this.changed(t);
  }

  // ---- storage and broadcast ----

  private changed(t: Tournament) {
    if (t.state === "open" && t.entrants.length === t.size) this.begin(t);
    // Drop an open tournament everyone left.
    const all = this.all();
    if (t.state === "open" && !t.entrants.length) delete all[t.id];
    else all[t.id] = t;
    this.store.write(TOURNAMENTS, all);
    this.io.to(tournamentChannel(t.id)).emit("tournament:update", this.payload(t));
  }

  /** In-memory tournament objects: live ones are mutated in place and written back. */
  private cache: Record<string, Tournament> | null = null;

  private all(): Record<string, Tournament> {
    if (!this.cache) {
      this.cache = this.store.read<Record<string, Tournament>>(TOURNAMENTS, {});
      for (const t of Object.values(this.cache)) {
        upgrade(t, this.games.get(t.gameId)?.name ?? t.gameId);
        // A restart loses running matches; those tournaments cannot finish.
        if (t.state === "running") t.state = "finished";
      }
    }
    return this.cache;
  }

  private find(id: unknown): Tournament | undefined {
    return typeof id === "string" && Object.hasOwn(this.all(), id) ? this.all()[id] : undefined;
  }

  private active() {
    return Object.values(this.all()).filter((t) => t.state !== "finished");
  }

  private activeFor(profileId: string) {
    return this.active().find((t) => t.entrants.some((e) => e.id === profileId));
  }

  private entrant(profileId: string): Entrant {
    return { id: profileId, name: this.identity.get(profileId)?.name ?? profileId, bot: false };
  }

  payload(t: Tournament) {
    const game = this.games.get(t.gameId);
    // Names are read live so a rename shows in brackets too; the stored one is a fallback.
    const entrant = (e: Entrant, i: number) => ({ ...e, name: e.bot ? e.name : (this.identity.get(e.id)?.name ?? e.name), seed: i + 1 });
    const who = (i: number | null) => (i === null ? null : entrant(t.entrants[i], i));
    return {
      id: t.id,
      name: t.name,
      link: `/t/${t.id}`,
      gameId: t.gameId,
      gameName: game?.name ?? t.gameId,
      host: t.host,
      state: t.state,
      size: t.size,
      bestOf: t.bestOf,
      visibility: t.visibility,
      entrants: t.entrants.map(entrant),
      rounds: t.rounds.map((matches, r) => ({
        name: roundName(r, t.rounds.length),
        matches: matches.map((bm) => ({
          players: bm.players ? bm.players.map(who) : [null, null],
          matchIds: bm.matchIds,
          /** The match to watch or replay for this slot (the latest game). */
          matchId: bm.matchIds.at(-1) ?? null,
          state: bm.winner !== null ? "done" : bm.matchIds.length ? "playing" : "pending",
          winner: who(bm.winner),
          decidedBy: bm.decidedBy,
          /** Series wins, in the same order as players. */
          score: score(bm),
          /** Every game in order; winner is 0 or 1 (index into players), null for a draw or one in play. */
          games: bm.games.map((g) => ({
            matchId: g.matchId,
            winner: g.winner === null ? null : bm.players!.indexOf(g.winner),
            state: g.done ? "done" : "playing",
          })),
        })),
      })),
      champion: who(t.champion),
      createdAt: t.createdAt,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
    };
  }
}

/** Games won by each player of a pairing, in players order. */
function score(bm: BracketMatch): [number, number] {
  if (!bm.players) return [0, 0];
  const won = (i: number) => bm.games.filter((g) => g.winner === i).length;
  return [won(bm.players[0]), won(bm.players[1])];
}

/** Fill in fields that tournaments saved before sizes and series existed lack. */
function upgrade(t: Tournament, gameName: string) {
  t.name ??= `${gameName} tournament`;
  t.size ??= 4;
  t.bestOf ??= 1;
  t.visibility ??= "open";
  for (const round of t.rounds) {
    for (const bm of round) {
      if (bm.games) continue;
      // Old slots only kept match ids: every game but a decisive last one was a draw.
      bm.games = bm.matchIds.map((matchId, i) => {
        const last = i === bm.matchIds.length - 1;
        const winner = last && bm.decidedBy === "match" ? bm.winner : null;
        return { matchId, seats: bm.players ?? [0, 1], winner, done: true };
      });
    }
  }
}

export function tournamentRoutes(tournaments: Tournaments): Router {
  const router = Router();

  router.get("/api/tournaments", (req, res) => {
    res.json(tournaments.list(typeof req.query.game === "string" ? req.query.game : undefined));
  });

  router.get("/api/tournaments/:id", (req, res) => {
    const t = tournaments.get(req.params.id);
    if (!t) {
      res.status(404).json({ error: "tournament not found" });
      return;
    }
    res.json(t);
  });

  return router;
}

export type TournamentPayload = ReturnType<Tournaments["payload"]>;
