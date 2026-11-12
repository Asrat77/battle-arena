// Live match runtime. The server is the referee: clients send moves, every
// entry goes through engine step() (same path as replay), and each seat and
// the spectators get only their own view of the state.

import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Server, Socket } from "socket.io";
import { canonical } from "../../engine/canonical";
import { checkEntry, initial, step, type MatchState } from "../../engine/replay";
import { createRng } from "../../engine/rng";
import type { AnyGame, LogEntry, MatchRecord, Seat, Viewer } from "../../engine/types";
import { systemClock, type Clock, type TimerHandle } from "./clock";
import type { Store } from "./store";

export const DISCONNECT_FORFEIT_MS = 30_000;
/** After a restart, players of a resumed match get this long to reconnect. */
export const RESUME_GRACE_MS = 120_000;
/** Store key for matches that must survive a restart (staked ones). */
const LIVE = "liveMatches";

/** What is kept on disk for a durable match: enough to replay it to the current state. */
export interface SavedMatch {
  id: string;
  gameId: string;
  seed: string;
  players: [string, string];
  bots: Seat[];
  log: LogEntry[];
  startedAt: number;
  commitments: Record<string, string>;
  committed: boolean;
}
export const BOT_DELAY_MS: [number, number] = [1_500, 5_000];
const MAX_MOVE_BYTES = 2_048;

export interface Match {
  id: string;
  game: AnyGame;
  seed: string;
  players: [string, string];
  /** Seat played by the server's bot, or null for human vs human. The first one when both seats are bots. */
  botSeat: Seat | null;
  /** Every seat the server's bot plays (both in a bot-vs-bot tournament match). */
  bots: Seat[];
  log: LogEntry[];
  cur: MatchState<unknown>;
  deadline: number | null;
  /** Grows as seats commit; final once `committed` is true. */
  commitments: Record<string, string>;
  /** Every seat has committed (e.g. both secrets set). "commit" has been emitted. */
  committed: boolean;
  startedAt: number;
  endedAt: number | null;
  timers: { deadline?: TimerHandle; bot: [TimerHandle?, TimerHandle?]; disconnect: [TimerHandle?, TimerHandle?] };
  active: Seat[];
  /** Per seat: when the forfeit lands for a player who has dropped off, else null. */
  away: [number | null, number | null];
  /** Kept in the store after every move so a restart resumes it (staked matches). */
  durable: boolean;
  /** Resumed after a restart and waiting for both players: the turn clock is paused. */
  resuming: boolean;
}

export interface CreateMatchInput {
  game: AnyGame;
  players: [string, string];
  botSeat?: Seat | null;
  /** Bot seats, for a bot-vs-bot match. Overrides botSeat. */
  botSeats?: Seat[];
  seed?: string;
  /** Persist the match so a restart resumes it instead of losing it. Used for staked matches. */
  durable?: boolean;
}

type Ack = (res: { ok: true } | { ok: false; reason: string }) => void;

const seatRoom = (id: string, seat: Seat) => `match:${id}:${seat}`;
export const specRoom = (id: string) => `match:${id}:spectators`;
export const profileRoom = (profileId: string) => `profile:${profileId}`;

/**
 * Emits "start" (match), "commit" (match, once every seat's commitment exists),
 * "end" (match, record) and "spectated" (match, profileIds still watching at
 * the end) so recording, rewards and the lobby can hook in without the
 * runtime knowing about them.
 */
export class MatchRuntime extends EventEmitter {
  private matches = new Map<string, Match>();
  private readonly clock: Clock;
  private readonly store: Store | null;

  constructor(
    private readonly io: Server,
    opts: { clock?: Clock; store?: Store } = {},
  ) {
    super();
    this.clock = opts.clock ?? systemClock;
    this.store = opts.store ?? null;
  }

  get(id: string): Match | undefined {
    return this.matches.get(id);
  }

  /** Matches still in progress. */
  live(): Match[] {
    return [...this.matches.values()].filter((m) => !m.cur.outcome);
  }

  /** Live matches a profile is seated in. */
  activeFor(profileId: string): Match[] {
    return [...this.matches.values()].filter((m) => !m.cur.outcome && m.players.includes(profileId));
  }

  create(input: CreateMatchInput): Match {
    const { game, players } = input;
    const id = randomBytes(8).toString("hex");
    const seed = input.seed ?? randomBytes(16).toString("hex");
    const cur = initial(game, seed);
    const bots: Seat[] = input.botSeats ?? (input.botSeat != null ? [input.botSeat] : []);
    const m: Match = {
      id,
      game,
      seed,
      players,
      botSeat: bots[0] ?? null,
      bots,
      log: [],
      cur,
      deadline: null,
      commitments: {},
      committed: false,
      startedAt: this.clock.now(),
      endedAt: null,
      timers: { bot: [], disconnect: [] },
      active: [],
      away: [null, null],
      durable: Boolean(input.durable),
      resuming: false,
    };
    this.matches.set(id, m);

    for (const seat of [0, 1] as const) {
      if (m.bots.includes(seat)) continue;
      this.io.in(profileRoom(players[seat])).socketsJoin(seatRoom(id, seat));
      this.io.to(profileRoom(players[seat])).emit("match:start", this.startPayload(m, seat));
    }
    this.emit("start", m);
    this.advanced(m, true);
    // A seated player who is not connected right now starts the forfeit clock.
    for (const seat of [0, 1] as const) {
      if (!m.bots.includes(seat) && !this.isOnline(players[seat])) this.startDisconnectTimer(m, seat);
    }
    return m;
  }

  /**
   * Bring back the durable matches that were live when the server stopped: replay each
   * saved log, re-arm a fresh turn timer, and give both players RESUME_GRACE_MS to come
   * back. Call once at boot, after every "end" listener is attached. Returns the ids
   * resumed; a saved match whose game is gone or whose log no longer replays is dropped
   * (and its stake refunded by the caller).
   */
  restore(games: { get(id: string): AnyGame | undefined }): string[] {
    const saved = this.saved();
    const resumed: string[] = [];
    for (const s of Object.values(saved)) {
      const game = games.get(s.gameId);
      let cur: MatchState<unknown> | null = null;
      if (game) {
        try {
          cur = initial(game, s.seed);
          s.log.forEach((entry, i) => (cur = step(game, s.seed, cur!, entry, i)));
        } catch (err) {
          console.error(`could not resume match ${s.id}`, err);
          cur = null;
        }
      }
      if (!game || !cur) {
        this.drop(s.id);
        continue;
      }
      const m: Match = {
        id: s.id,
        game,
        seed: s.seed,
        players: s.players,
        botSeat: s.bots[0] ?? null,
        bots: s.bots,
        log: s.log,
        cur,
        deadline: null,
        commitments: s.commitments,
        committed: s.committed,
        startedAt: s.startedAt,
        endedAt: null,
        timers: { bot: [], disconnect: [] },
        active: [],
        away: [null, null],
        durable: true,
        resuming: true,
      };
      this.matches.set(m.id, m);
      resumed.push(m.id);
      // The turn clock waits until both players are back, so nobody loses on time
      // while the server was down; the grace timers below cover a no-show.
      this.advanced(m, true);
      if (m.cur.outcome) continue;
      for (const seat of [0, 1] as const) {
        if (!m.bots.includes(seat) && !this.isOnline(m.players[seat])) this.startDisconnectTimer(m, seat, RESUME_GRACE_MS);
      }
    }
    return resumed;
  }

  /** Wire match events for an authenticated socket and restore any live match. */
  attach(socket: Socket, profileId: string) {
    socket.join(profileRoom(profileId));

    for (const m of this.activeFor(profileId)) {
      const seat = this.seatOf(m, profileId);
      if (seat === null) continue;
      m.timers.disconnect[seat]?.cancel();
      m.timers.disconnect[seat] = undefined;
      if (m.away[seat] !== null) {
        m.away[seat] = null;
        this.io.to(this.allRooms(m)).emit("match:presence", this.presencePayload(m));
      }
      this.sendSeat(socket, m, seat);
      this.unpauseIfAllBack(m);
    }

    socket.on("match:move", (msg: { matchId?: string; move?: unknown }, ack?: Ack) => {
      const reason = this.move(profileId, msg?.matchId, msg?.move);
      if (reason) socket.emit("match:error", { matchId: msg?.matchId, reason });
      if (typeof ack === "function") ack(reason ? { ok: false, reason } : { ok: true });
    });

    socket.on("match:watch", (msg: { matchId?: string }, ack?: Ack) => {
      const m = msg?.matchId ? this.matches.get(msg.matchId) : undefined;
      if (!m) {
        socket.emit("match:error", { matchId: msg?.matchId, reason: "no such match" });
        if (typeof ack === "function") ack({ ok: false, reason: "no such match" });
        return;
      }
      const seat = this.seatOf(m, profileId);
      if (seat !== null) this.sendSeat(socket, m, seat);
      else {
        socket.join(specRoom(m.id));
        socket.emit("match:start", this.startPayload(m, "spectator"));
        socket.emit("match:view", this.viewPayload(m, "spectator"));
        this.sendPresence(socket, m);
        if (m.cur.outcome) socket.emit("match:end", this.endPayload(m));
        else this.sendSpectatorCount(m);
      }
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("match:leave", (msg: { matchId?: string } | Ack | undefined, ack?: Ack) => {
      if (typeof msg === "function") [ack, msg] = [msg, undefined];
      const matchId = (msg as { matchId?: string } | undefined)?.matchId;
      // Spectators just stop watching; players forfeit.
      for (const m of this.watchedBy(socket)) {
        if (matchId && matchId !== m.id) continue;
        socket.leave(specRoom(m.id));
        this.sendSpectatorCount(m);
      }
      for (const m of this.activeFor(profileId)) {
        if (matchId && matchId !== m.id) continue;
        const seat = this.seatOf(m, profileId);
        if (seat !== null) this.append(m, { t: this.clock.now(), seat: "system", move: { type: "forfeit", seat } });
      }
      if (typeof ack === "function") ack({ ok: true });
    });

    // Rooms are already left by the time "disconnect" fires, so note which
    // matches this socket was watching while it still knows.
    let watching: Match[] = [];
    socket.on("disconnecting", () => {
      watching = this.watchedBy(socket);
    });

    socket.on("disconnect", (reason: string) => {
      watching.forEach((m) => this.sendSpectatorCount(m));
      // The server going down is not the player leaving: a durable match resumes on boot.
      if (reason === "server shutting down") return;
      if (this.isOnline(profileId)) return;
      for (const m of this.activeFor(profileId)) {
        const seat = this.seatOf(m, profileId);
        if (seat !== null) this.startDisconnectTimer(m, seat);
      }
    });
  }

  /** Apply a player's move. Returns a reason when it is rejected; nothing changes then. */
  move(profileId: string, matchId: unknown, move: unknown): string | null {
    const m = typeof matchId === "string" ? this.matches.get(matchId) : undefined;
    if (!m) return "no such match";
    const seat = this.seatOf(m, profileId);
    if (seat === null) return "you are not playing in this match";
    let size: number;
    try {
      size = canonical(move ?? null).length;
    } catch {
      return "move is not plain data";
    }
    if (size > MAX_MOVE_BYTES) return "move too large";
    const entry: LogEntry = { t: this.clock.now(), seat, move };
    const reason = checkEntry(m.game, m.cur, entry);
    if (reason) return reason;
    this.append(m, entry);
    return null;
  }

  private append(m: Match, entry: LogEntry) {
    if (m.cur.outcome) return;
    const previousDeadlineMs = m.game.deadlineMs(m.cur.state);
    m.cur = step(m.game, m.seed, m.cur, entry, m.log.length);
    m.log.push(entry);
    this.advanced(m, false, previousDeadlineMs);
  }

  /** After the state changed: push views, then end or re-arm timers and the bot. */
  private advanced(m: Match, first: boolean, previousDeadlineMs?: number | null) {
    const { state, outcome } = m.cur;
    const prev = m.active;
    m.active = outcome ? [] : m.game.activeSeats(state);
    this.checkCommitments(m);

    if (outcome) {
      this.finish(m);
      return;
    }
    this.save(m);

    // Keep the running deadline while a simultaneous phase only loses seats
    // (one player has moved, the other still has the same time left).
    const shrinking = !first && m.active.length > 0 && m.active.length < prev.length &&
      m.active.every((s) => prev.includes(s)) && previousDeadlineMs === m.game.deadlineMs(state);
    if (!shrinking) this.armDeadline(m);

    this.pushViews(m);
    this.scheduleBot(m);
  }

  /** Restart the turn clock for the current state (none while a resumed match waits). */
  private armDeadline(m: Match) {
    m.timers.deadline?.cancel();
    m.timers.deadline = undefined;
    m.deadline = null;
    if (m.resuming || m.cur.outcome) return;
    const ms = m.game.deadlineMs(m.cur.state);
    if (ms !== null) {
      m.deadline = this.clock.now() + ms;
      m.timers.deadline = this.clock.setTimeout(() => {
        m.timers.deadline = undefined;
        this.append(m, { t: this.clock.now(), seat: "system", move: { type: "timeout" } });
      }, ms);
    }
  }

  /** A resumed match starts its turn clock once every human seat is connected again. */
  private unpauseIfAllBack(m: Match) {
    if (!m.resuming) return;
    if (!([0, 1] as const).every((s) => m.bots.includes(s) || this.isOnline(m.players[s]))) return;
    m.resuming = false;
    this.armDeadline(m);
    this.pushViews(m);
  }

  // Commitments only exist once each seat has chosen its hidden data (a Crack
  // the Code secret is set during setup), so they are published when the last
  // seat commits rather than at match creation.
  private checkCommitments(m: Match) {
    if (m.committed || !m.game.commitments) return;
    m.commitments = m.game.commitments(m.cur.state);
    if ((["0", "1"] as const).every((seat) => seat in m.commitments)) {
      m.committed = true;
      this.emit("commit", m);
    }
  }

  /** Send an event to everyone in the match: both seats, spectators, and the players' other sockets. */
  broadcast(m: Match, event: string, payload: unknown) {
    this.io.to([...this.allRooms(m), ...m.players.map(profileRoom)]).emit(event, payload);
  }

  private scheduleBot(m: Match) {
    for (const seat of m.bots) this.scheduleBotSeat(m, seat);
  }

  private scheduleBotSeat(m: Match, seat: Seat) {
    if (!m.active.includes(seat) || m.timers.bot[seat]) return;
    // A second bot gets its own stream so the two never mirror each other.
    const rng = createRng(m.bots.length > 1 ? `${m.seed}:bot:${seat}:${m.log.length}` : `${m.seed}:bot:${m.log.length}`);
    let delay = BOT_DELAY_MS[0] + rng.int(BOT_DELAY_MS[1] - BOT_DELAY_MS[0] + 1);
    if (m.deadline !== null) delay = Math.min(delay, Math.max(0, m.deadline - this.clock.now() - 250));
    m.timers.bot[seat] = this.clock.setTimeout(() => {
      m.timers.bot[seat] = undefined;
      if (m.cur.outcome || !m.active.includes(seat)) return;
      const move = m.game.bot(m.game.view(m.cur.state, seat), seat, rng);
      const entry: LogEntry = { t: this.clock.now(), seat, move };
      const reason = checkEntry(m.game, m.cur, entry);
      if (reason) {
        console.warn(`bot move rejected in ${m.id}: ${reason}`);
        return; // the deadline timer still moves the match on
      }
      this.append(m, entry);
    }, delay);
  }

  private startDisconnectTimer(m: Match, seat: Seat, ms = DISCONNECT_FORFEIT_MS) {
    if (m.timers.disconnect[seat] || m.cur.outcome) return;
    m.away[seat] = this.clock.now() + ms;
    this.io.to(this.allRooms(m)).emit("match:presence", this.presencePayload(m));
    m.timers.disconnect[seat] = this.clock.setTimeout(() => {
      m.timers.disconnect[seat] = undefined;
      m.away[seat] = null;
      if (this.isOnline(m.players[seat])) return;
      // Both gone: nobody showed up to win it, so it is a draw rather than a loss for
      // whoever happened to drop first.
      const other: Seat = seat === 0 ? 1 : 0;
      const otherGone = !m.bots.includes(other) && !this.isOnline(m.players[other]);
      const move = otherGone ? ({ type: "abandon" } as const) : ({ type: "forfeit", seat } as const);
      this.append(m, { t: this.clock.now(), seat: "system", move });
    }, ms);
  }

  private finish(m: Match) {
    this.drop(m.id);
    m.endedAt = this.clock.now();
    m.deadline = null;
    m.timers.deadline?.cancel();
    m.timers.bot.forEach((t) => t?.cancel());
    m.timers.disconnect.forEach((t) => t?.cancel());
    m.timers = { bot: [], disconnect: [] };
    m.away = [null, null];

    this.pushViews(m);
    this.io.to(this.allRooms(m)).emit("match:end", this.endPayload(m));
    this.emit("end", m, this.record(m));
    const watchers = this.spectators(m);
    if (watchers.length) this.emit("spectated", m, watchers);
  }

  /** Distinct profiles watching a match (players' own sockets never count). */
  spectators(m: Match): string[] {
    const ids = new Set<string>();
    for (const sid of this.io.sockets.adapter.rooms.get(specRoom(m.id)) ?? []) {
      const profileId = this.io.sockets.sockets.get(sid)?.data.profileId as string | undefined;
      if (profileId && this.seatOf(m, profileId) === null) ids.add(profileId);
    }
    return [...ids];
  }

  /** Whether this socket is watching the match as a spectator. */
  isWatching(socket: Socket, matchId: string): boolean {
    return socket.rooms.has(specRoom(matchId));
  }

  private watchedBy(socket: Socket): Match[] {
    return [...this.matches.values()].filter((m) => this.isWatching(socket, m.id));
  }

  private sendSpectatorCount(m: Match) {
    if (m.cur.outcome) return;
    this.broadcast(m, "match:spectators", { matchId: m.id, count: this.spectators(m).length });
  }

  record(m: Match): MatchRecord | null {
    if (!m.cur.outcome || m.endedAt === null) return null;
    return {
      matchId: m.id,
      gameId: m.game.id,
      players: m.players,
      bot: m.bots.length > 0,
      seed: m.seed,
      log: m.log,
      outcome: m.cur.outcome,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
    };
  }

  private pushViews(m: Match) {
    for (const seat of [0, 1] as const) {
      if (!m.bots.includes(seat)) this.io.to(seatRoom(m.id, seat)).emit("match:view", this.viewPayload(m, seat));
    }
    this.io.to(specRoom(m.id)).emit("match:view", this.viewPayload(m, "spectator"));
  }

  private sendSeat(socket: Socket, m: Match, seat: Seat) {
    socket.join(seatRoom(m.id, seat));
    socket.emit("match:start", this.startPayload(m, seat));
    socket.emit("match:view", this.viewPayload(m, seat));
    this.sendPresence(socket, m);
    if (m.cur.outcome) socket.emit("match:end", this.endPayload(m));
  }

  private presencePayload(m: Match) {
    return { matchId: m.id, away: m.away };
  }

  /** Tells a socket that joins late who is currently away; silent when everyone is here. */
  private sendPresence(socket: Socket, m: Match) {
    if (m.away.some((t) => t !== null)) socket.emit("match:presence", this.presencePayload(m));
  }

  private startPayload(m: Match, viewer: Viewer) {
    return {
      matchId: m.id,
      gameId: m.game.id,
      players: m.players,
      bot: m.bots.length > 0,
      botSeat: m.botSeat,
      seat: viewer,
      commitments: m.commitments,
      startedAt: m.startedAt,
      spectators: this.spectators(m).length,
    };
  }

  private viewPayload(m: Match, viewer: Viewer) {
    return {
      matchId: m.id,
      view: m.game.view(m.cur.state, viewer),
      seq: m.log.length,
      deadline: m.deadline,
      activeSeats: m.active,
    };
  }

  private endPayload(m: Match) {
    return {
      matchId: m.id,
      outcome: m.cur.outcome,
      reveal: m.game.reveal?.(m.cur.state) ?? {},
    };
  }

  private allRooms(m: Match) {
    return [seatRoom(m.id, 0), seatRoom(m.id, 1), specRoom(m.id)];
  }

  private seatOf(m: Match, profileId: string): Seat | null {
    const seat = m.players.indexOf(profileId);
    return seat === 0 || seat === 1 ? (m.bots.includes(seat) ? null : seat) : null;
  }

  private saved(): Record<string, SavedMatch> {
    return this.store?.read<Record<string, SavedMatch>>(LIVE, {}) ?? {};
  }

  private save(m: Match) {
    if (!m.durable || !this.store) return;
    const s: SavedMatch = {
      id: m.id,
      gameId: m.game.id,
      seed: m.seed,
      players: m.players,
      bots: m.bots,
      log: [...m.log],
      startedAt: m.startedAt,
      commitments: m.commitments,
      committed: m.committed,
    };
    this.store.write(LIVE, { ...this.saved(), [m.id]: s });
  }

  private drop(id: string) {
    if (!this.store) return;
    const all = this.saved();
    if (!Object.hasOwn(all, id)) return;
    const { [id]: _gone, ...rest } = all;
    this.store.write(LIVE, rest);
  }

  private isOnline(profileId: string) {
    return (this.io.sockets.adapter.rooms.get(profileRoom(profileId))?.size ?? 0) > 0;
  }
}
