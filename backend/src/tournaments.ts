// 4-player single-elimination tournaments for any game. A host opens one,
// others join by id (or the host fills the empty seats with bots), and it
// starts when full. Each round's matches go through the normal runtime, so
// they are refereed, recorded and replayable like any other match.

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

export const TOURNAMENT_SIZE = 4;
/** Pause between the semifinals ending and the final starting, so players see the result. */
export const ROUND_BREAK_MS = 5_000;
/** Drawn bracket matches are replayed this many times, then decided by a seeded coin flip. */
export const MAX_REMATCHES = 2;
const TOURNAMENTS = "tournaments";
const ROUND_NAMES = ["Semifinal", "Final"];

interface Entrant {
  id: string;
  name: string;
  bot: boolean;
}

interface BracketMatch {
  /** Entrant indexes, null until the feeding matches are decided. */
  players: [number, number] | null;
  /** Every match played for this slot, rematches after draws included. */
  matchIds: string[];
  winner: number | null;
  decidedBy: "match" | "coin flip" | null;
}

export interface Tournament {
  id: string;
  gameId: string;
  host: string | null;
  state: "open" | "running" | "finished";
  entrants: Entrant[];
  /** rounds[0] = semifinals (two matches), rounds[1] = final (one). */
  rounds: BracketMatch[][];
  champion: number | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
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

const emptySlot = (): BracketMatch => ({ players: null, matchIds: [], winner: null, decidedBy: null });

export class Tournaments {
  /** Live bracket match → where it sits in which tournament. */
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

    socket.on("tournament:create", (msg: { gameId?: unknown; fillWithBots?: unknown }, ack?: Ack) =>
      reply(ack, this.create(profileId, msg?.gameId, msg?.fillWithBots === true)),
    );
    socket.on("tournament:join", (msg: unknown, ack?: Ack) => reply(ack, this.join(profileId, id(msg))));
    socket.on("tournament:leave", (msg: unknown, ack?: Ack) => reply(ack, this.leave(profileId, id(msg))));
    socket.on("tournament:addBots", (msg: unknown, ack?: Ack) => reply(ack, this.addBots(profileId, id(msg))));
    socket.on("tournament:watch", (msg: unknown, ack?: Ack) => {
      const t = this.find(id(msg));
      if (!t) return reply(ack, { ok: false, reason: "no such tournament" });
      socket.join(tournamentChannel(t.id));
      reply(ack, { ok: true, tournament: this.payload(t) });
    });
  }

  /** Open a tournament. host null makes a hostless one (tests, demos); fillWithBots starts it at once. */
  create(host: string | null, gameId: unknown, fillWithBots = false): Result<{ tournament: ReturnType<Tournaments["payload"]> }> {
    const game = typeof gameId === "string" ? this.games.get(gameId) : undefined;
    if (!game) return { ok: false, reason: "unknown game" };
    if (host && this.activeFor(host)) return { ok: false, reason: "already in a tournament" };
    const t: Tournament = {
      id: randomBytes(4).toString("hex"),
      gameId: game.id,
      host,
      state: "open",
      entrants: host ? [this.entrant(host)] : [],
      rounds: [[emptySlot(), emptySlot()], [emptySlot()]],
      champion: null,
      createdAt: this.clock.now(),
      startedAt: null,
      endedAt: null,
    };
    if (host) this.io.in(profileRoom(host)).socketsJoin(tournamentChannel(t.id));
    if (fillWithBots) this.fillBots(t);
    this.changed(t);
    return { ok: true, tournament: this.payload(t) };
  }

  join(profileId: string, id: unknown): Result<{ tournament: ReturnType<Tournaments["payload"]> }> {
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

  /** Host only: fill the empty seats with bots, which starts the tournament. */
  addBots(profileId: string, id: unknown): Result {
    const t = this.find(id);
    if (!t) return { ok: false, reason: "no such tournament" };
    if (t.host !== profileId) return { ok: false, reason: "only the host can add bots" };
    if (t.state !== "open") return { ok: false, reason: "tournament already started" };
    this.fillBots(t);
    this.changed(t);
    return { ok: true };
  }

  get(id: string) {
    const t = this.find(id);
    return t ? this.payload(t) : null;
  }

  /** Open and running tournaments first, then the most recent finished ones. */
  list(gameId?: string, limit = 20) {
    const order = { open: 0, running: 1, finished: 2 };
    return Object.values(this.all())
      .filter((t) => !gameId || t.gameId === gameId)
      .sort((a, b) => order[a.state] - order[b.state] || b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((t) => this.payload(t));
  }

  // ---- bracket ----

  private fillBots(t: Tournament) {
    let n = t.entrants.filter((e) => e.bot).length;
    while (t.entrants.length < TOURNAMENT_SIZE) t.entrants.push({ id: BOT_PLAYER, name: `Bot ${++n}`, bot: true });
  }

  private start(t: Tournament) {
    t.state = "running";
    t.startedAt = this.clock.now();
    // Random seeding, so whoever opened it does not always face the first joiner.
    for (let i = t.entrants.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [t.entrants[i], t.entrants[j]] = [t.entrants[j], t.entrants[i]];
    }
    t.rounds[0][0].players = [0, 1];
    t.rounds[0][1].players = [2, 3];
    this.play(t, 0, 0);
    this.play(t, 0, 1);
  }

  /** Create the runtime match for one bracket slot. */
  private play(t: Tournament, round: number, slot: number) {
    const game = this.games.get(t.gameId)!;
    const bm = t.rounds[round][slot];
    const pair = [...bm.players!];
    if (randomInt(2) === 1) pair.reverse();
    const players = pair.map((i) => t.entrants[i].id) as [string, string];
    const botSeats = ([0, 1] as const).filter((s) => t.entrants[pair[s]].bot);
    const m = this.matches.create({ game, players, botSeats });
    this.byMatch.set(m.id, { id: t.id, round, slot });
    this.seatOrder.set(m.id, pair as [number, number]);
    bm.matchIds.push(m.id);
  }

  /** Entrant index sitting in each seat of a live bracket match. */
  private seatOrder = new Map<string, [number, number]>();

  private matchEnded(m: Match) {
    const where = this.byMatch.get(m.id);
    if (!where) return;
    this.byMatch.delete(m.id);
    const seats = this.seatOrder.get(m.id)!;
    this.seatOrder.delete(m.id);
    const t = this.find(where.id);
    if (!t) return;
    const bm = t.rounds[where.round][where.slot];
    const outcome = m.cur.outcome!;

    if (outcome.winner !== null) {
      bm.winner = seats[outcome.winner];
      bm.decidedBy = "match";
    } else if (bm.matchIds.length <= MAX_REMATCHES) {
      this.play(t, where.round, where.slot);
      this.changed(t);
      return;
    } else {
      const rng = createRng(`${t.id}:${where.round}:${where.slot}`);
      bm.winner = rng.pick(bm.players!);
      bm.decidedBy = "coin flip";
    }

    if (where.round === 0) {
      const semis = t.rounds[0];
      if (semis.every((s) => s.winner !== null)) {
        t.rounds[1][0].players = [semis[0].winner!, semis[1].winner!];
        this.clock.setTimeout(() => {
          this.play(t, 1, 0);
          this.changed(t);
        }, ROUND_BREAK_MS);
      }
    } else {
      t.champion = bm.winner;
      t.state = "finished";
      t.endedAt = this.clock.now();
      const champ = t.entrants[t.champion!];
      if (!champ.bot) this.opts.onChampion?.(champ.id, t.id, t.endedAt);
    }
    this.changed(t);
  }

  // ---- storage and broadcast ----

  private changed(t: Tournament) {
    if (t.state === "open" && t.entrants.length === TOURNAMENT_SIZE) this.start(t);
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
      // A restart loses running matches; those tournaments cannot finish.
      for (const t of Object.values(this.cache)) if (t.state === "running") t.state = "finished";
    }
    return this.cache;
  }

  private find(id: unknown): Tournament | undefined {
    return typeof id === "string" ? this.all()[id] : undefined;
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
    const who = (i: number | null) => (i === null ? null : { ...t.entrants[i], seed: i + 1 });
    return {
      id: t.id,
      link: `/t/${t.id}`,
      gameId: t.gameId,
      gameName: game?.name ?? t.gameId,
      host: t.host,
      state: t.state,
      size: TOURNAMENT_SIZE,
      entrants: t.entrants.map((e, i) => ({ ...e, seed: i + 1 })),
      rounds: t.rounds.map((matches, r) => ({
        name: ROUND_NAMES[r],
        matches: matches.map((bm) => ({
          players: bm.players ? bm.players.map(who) : [null, null],
          matchIds: bm.matchIds,
          /** The match to watch or replay for this slot (the latest rematch). */
          matchId: bm.matchIds.at(-1) ?? null,
          state: bm.winner !== null ? "done" : bm.matchIds.length ? "playing" : "pending",
          winner: who(bm.winner),
          decidedBy: bm.decidedBy,
        })),
      })),
      champion: who(t.champion),
      createdAt: t.createdAt,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
    };
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
