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

export const DISCONNECT_FORFEIT_MS = 30_000;
export const BOT_DELAY_MS: [number, number] = [1_500, 5_000];
const MAX_MOVE_BYTES = 2_048;

export interface Match {
  id: string;
  game: AnyGame;
  seed: string;
  players: [string, string];
  /** Seat played by the server's bot, or null for human vs human. */
  botSeat: Seat | null;
  log: LogEntry[];
  cur: MatchState<unknown>;
  deadline: number | null;
  /** Grows as seats commit; final once `committed` is true. */
  commitments: Record<string, string>;
  /** Every seat has committed (e.g. both secrets set). "commit" has been emitted. */
  committed: boolean;
  startedAt: number;
  endedAt: number | null;
  timers: { deadline?: TimerHandle; bot?: TimerHandle; disconnect: [TimerHandle?, TimerHandle?] };
  active: Seat[];
}

export interface CreateMatchInput {
  game: AnyGame;
  players: [string, string];
  botSeat?: Seat | null;
  seed?: string;
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

  constructor(
    private readonly io: Server,
    opts: { clock?: Clock } = {},
  ) {
    super();
    this.clock = opts.clock ?? systemClock;
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
    const m: Match = {
      id,
      game,
      seed,
      players,
      botSeat: input.botSeat ?? null,
      log: [],
      cur,
      deadline: null,
      commitments: {},
      committed: false,
      startedAt: this.clock.now(),
      endedAt: null,
      timers: { disconnect: [] },
      active: [],
    };
    this.matches.set(id, m);

    for (const seat of [0, 1] as const) {
      if (seat === m.botSeat) continue;
      this.io.in(profileRoom(players[seat])).socketsJoin(seatRoom(id, seat));
      this.io.to(profileRoom(players[seat])).emit("match:start", this.startPayload(m, seat));
    }
    this.emit("start", m);
    this.advanced(m, true);
    // A seated player who is not connected right now starts the forfeit clock.
    for (const seat of [0, 1] as const) {
      if (seat !== m.botSeat && !this.isOnline(players[seat])) this.startDisconnectTimer(m, seat);
    }
    return m;
  }

  /** Wire match events for an authenticated socket and restore any live match. */
  attach(socket: Socket, profileId: string) {
    socket.join(profileRoom(profileId));

    for (const m of this.activeFor(profileId)) {
      const seat = this.seatOf(m, profileId);
      if (seat === null) continue;
      m.timers.disconnect[seat]?.cancel();
      m.timers.disconnect[seat] = undefined;
      this.sendSeat(socket, m, seat);
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

    socket.on("disconnect", () => {
      watching.forEach((m) => this.sendSpectatorCount(m));
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
    m.cur = step(m.game, m.seed, m.cur, entry, m.log.length);
    m.log.push(entry);
    this.advanced(m, false);
  }

  /** After the state changed: push views, then end or re-arm timers and the bot. */
  private advanced(m: Match, first: boolean) {
    const { state, outcome } = m.cur;
    const prev = m.active;
    m.active = outcome ? [] : m.game.activeSeats(state);
    this.checkCommitments(m);

    if (outcome) {
      this.finish(m);
      return;
    }

    // Keep the running deadline while a simultaneous phase only loses seats
    // (one player has moved, the other still has the same time left).
    const shrinking = !first && m.active.length < prev.length && m.active.every((s) => prev.includes(s));
    if (!shrinking) {
      m.timers.deadline?.cancel();
      m.timers.deadline = undefined;
      m.deadline = null;
      const ms = m.game.deadlineMs(state);
      if (ms !== null) {
        m.deadline = this.clock.now() + ms;
        m.timers.deadline = this.clock.setTimeout(() => {
          m.timers.deadline = undefined;
          this.append(m, { t: this.clock.now(), seat: "system", move: { type: "timeout" } });
        }, ms);
      }
    }

    this.pushViews(m);
    this.scheduleBot(m);
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
    const seat = m.botSeat;
    if (seat === null || !m.active.includes(seat) || m.timers.bot) return;
    const rng = createRng(`${m.seed}:bot:${m.log.length}`);
    let delay = BOT_DELAY_MS[0] + rng.int(BOT_DELAY_MS[1] - BOT_DELAY_MS[0] + 1);
    if (m.deadline !== null) delay = Math.min(delay, Math.max(0, m.deadline - this.clock.now() - 250));
    m.timers.bot = this.clock.setTimeout(() => {
      m.timers.bot = undefined;
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

  private startDisconnectTimer(m: Match, seat: Seat) {
    if (m.timers.disconnect[seat] || m.cur.outcome) return;
    m.timers.disconnect[seat] = this.clock.setTimeout(() => {
      m.timers.disconnect[seat] = undefined;
      if (!this.isOnline(m.players[seat])) {
        this.append(m, { t: this.clock.now(), seat: "system", move: { type: "forfeit", seat } });
      }
    }, DISCONNECT_FORFEIT_MS);
  }

  private finish(m: Match) {
    m.endedAt = this.clock.now();
    m.deadline = null;
    m.timers.deadline?.cancel();
    m.timers.bot?.cancel();
    m.timers.disconnect.forEach((t) => t?.cancel());
    m.timers = { disconnect: [] };

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
      bot: m.botSeat !== null,
      seed: m.seed,
      log: m.log,
      outcome: m.cur.outcome,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
    };
  }

  private pushViews(m: Match) {
    for (const seat of [0, 1] as const) {
      if (seat !== m.botSeat) this.io.to(seatRoom(m.id, seat)).emit("match:view", this.viewPayload(m, seat));
    }
    this.io.to(specRoom(m.id)).emit("match:view", this.viewPayload(m, "spectator"));
  }

  private sendSeat(socket: Socket, m: Match, seat: Seat) {
    socket.join(seatRoom(m.id, seat));
    socket.emit("match:start", this.startPayload(m, seat));
    socket.emit("match:view", this.viewPayload(m, seat));
    if (m.cur.outcome) socket.emit("match:end", this.endPayload(m));
  }

  private startPayload(m: Match, viewer: Viewer) {
    return {
      matchId: m.id,
      gameId: m.game.id,
      players: m.players,
      bot: m.botSeat !== null,
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
    return seat === 0 || seat === 1 ? (seat === m.botSeat ? null : seat) : null;
  }

  private isOnline(profileId: string) {
    return (this.io.sockets.adapter.rooms.get(profileRoom(profileId))?.size ?? 0) > 0;
  }
}
