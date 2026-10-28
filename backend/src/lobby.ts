// Lobby: per-game quick-match queues with a bot offer, and private rooms
// joined by a 5-character code. Both end in matches.create(); the runtime
// takes over from there. A match the lobby started can be replayed from its
// result card: straight away against the bot, or once both players ask.

import { randomInt } from "node:crypto";
import { Router } from "express";
import type { Server, Socket } from "socket.io";
import { getGame, listGames } from "../../engine/registry";
import type { AnyGame, Seat } from "../../engine/types";
import { systemClock, type Clock, type TimerHandle } from "./clock";
import type { Identity } from "./identity";
import { profileRoom, type Match, type MatchRuntime } from "./matches";

export const BOT_OFFER_MS = 10_000;
/** Both players ready → 3-2-1, then the match starts. Either can un-ready to stop it. */
export const ROOM_COUNTDOWN_MS = 3_000;
export const ROOM_CODE_LENGTH = 5;
// No 0/O or 1/I/L, so a code read aloud or off a screen is unambiguous.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const BOT_PLAYER = "bot";
/** How long after a match ends its result card can still start a rematch. */
export const REMATCH_WINDOW_MS = 5 * 60_000;

interface QueueEntry {
  profileId: string;
  since: number;
  botOffered: boolean;
  timer?: TimerHandle;
}

interface RoomMember {
  profileId: string;
  ready: boolean;
}

interface Room {
  code: string;
  game: AnyGame;
  host: string;
  members: RoomMember[];
  matchId: string | null;
  /** The room's previous match, so its spectators keep the room chat after it ends. */
  lastMatchId: string | null;
  /** Set while both are ready and the 3-2-1 runs. */
  countdown?: { endsAt: number; timer: TimerHandle };
  createdAt: number;
}

type RematchState = "open" | "offered" | "matched" | "declined" | "closed";

/** What it takes to play a lobby match again, kept per match id. */
interface Rematch {
  game: AnyGame;
  players: [string, string];
  botSeat: Seat | null;
  /** The room it was started from, so a rematch keeps the room in step. */
  room: string | null;
  ended: boolean;
  state: RematchState;
  /** Profiles that asked for a rematch, in order. */
  wants: string[];
  /** The match the rematch started. */
  next: string | null;
  timer?: TimerHandle;
}

export interface LobbyOptions {
  clock?: Clock;
  /** Game lookup, so tests can use a test game. Defaults to the engine registry. */
  games?: { get(id: string): AnyGame | undefined; list(): AnyGame[] };
}

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; reason: string }) => void;

export const roomChannel = (code: string) => `room:${code}`;

export class Lobby {
  private queues = new Map<string, QueueEntry[]>();
  private rooms = new Map<string, Room>();
  /** Which room each profile is in (one at a time). */
  private roomOf = new Map<string, string>();
  private rematches = new Map<string, Rematch>();
  private readonly clock: Clock;
  private readonly games: NonNullable<LobbyOptions["games"]>;

  constructor(
    private readonly io: Server,
    private readonly matches: MatchRuntime,
    private readonly identity: Identity,
    opts: LobbyOptions = {},
  ) {
    this.clock = opts.clock ?? systemClock;
    this.games = opts.games ?? { get: getGame, list: listGames };
    matches.on("end", (m: Match) => this.matchEnded(m));
  }

  /** Game list with how many are waiting in quick match and playing right now. */
  gameList() {
    const live = this.matches.live();
    return this.games.list().map((g) => ({
      id: g.id,
      name: g.name,
      queue: this.queue(g.id).length,
      live: live.filter((m) => m.game.id === g.id).length,
    }));
  }

  /** Live matches anyone can watch, newest first, for the lobby's "watch" list. */
  liveMatches(gameId?: string) {
    return this.matches
      .live()
      .filter((m) => !gameId || m.game.id === gameId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((m) => ({
        matchId: m.id,
        gameId: m.game.id,
        gameName: m.game.name,
        players: m.players.map((p, seat) => ({
          profileId: p,
          name: m.bots.includes(seat as Seat) ? "Bot" : (this.identity.get(p)?.name ?? null),
        })),
        bot: m.bots.length > 0,
        startedAt: m.startedAt,
        spectators: this.matches.spectators(m).length,
        room: this.roomOfMatch(m.id)?.code ?? null,
        link: `/watch/${m.id}`,
      }));
  }

  /**
   * Room code and members for chat, by code. `watchMatchId` is the live match,
   * or the last one once it ends: its spectators still belong to the room.
   */
  roomInfo(
    code: string,
  ): { code: string; members: string[]; matchId: string | null; watchMatchId: string | null } | undefined {
    const room = this.rooms.get(code.trim().toUpperCase());
    return (
      room && {
        code: room.code,
        members: room.members.map((x) => x.profileId),
        matchId: room.matchId,
        watchMatchId: room.matchId ?? room.lastMatchId,
      }
    );
  }

  /** The room a match was started from, if any (live, or the room's last match). */
  roomOfMatch(matchId: string) {
    for (const room of this.rooms.values()) {
      if (room.matchId === matchId || (!room.matchId && room.lastMatchId === matchId)) return this.roomInfo(room.code);
    }
    return undefined;
  }

  attach(socket: Socket, profileId: string) {
    const reply = (ack: Ack | undefined, res: Parameters<Ack>[0]) => {
      if (res.ok === false) socket.emit("lobby:error", { reason: res.reason });
      if (typeof ack === "function") ack(res);
    };

    // A refresh lands back on the room screen with the current state.
    const code = this.roomOf.get(profileId);
    if (code) {
      socket.join(roomChannel(code));
      socket.emit("room:update", this.roomPayload(this.rooms.get(code)!));
    }

    socket.on("queue:join", (msg: { gameId?: unknown }, ack?: Ack) => reply(ack, this.joinQueue(profileId, msg?.gameId)));
    socket.on("queue:leave", (_msg: unknown, ack?: Ack) => {
      if (typeof _msg === "function") ack = _msg as Ack;
      this.leaveQueues(profileId);
      reply(ack, { ok: true });
    });
    socket.on("queue:acceptBot", (_msg: unknown, ack?: Ack) => {
      if (typeof _msg === "function") ack = _msg as Ack;
      reply(ack, this.acceptBot(profileId));
    });

    socket.on("rematch:status", (msg: { matchId?: unknown }, ack?: Ack) => {
      if (typeof ack === "function") ack(this.rematchStatus(profileId, msg?.matchId));
    });
    socket.on("rematch:request", (msg: { matchId?: unknown }, ack?: Ack) => reply(ack, this.requestRematch(profileId, msg?.matchId)));
    socket.on("rematch:cancel", (msg: { matchId?: unknown }, ack?: Ack) => reply(ack, this.cancelRematch(profileId, msg?.matchId)));

    socket.on("room:create", (msg: { gameId?: unknown }, ack?: Ack) => reply(ack, this.createRoom(profileId, msg?.gameId)));
    socket.on("room:join", (msg: { code?: unknown }, ack?: Ack) => reply(ack, this.joinRoom(profileId, msg?.code)));
    socket.on("room:ready", (msg: { ready?: unknown } | Ack | undefined, ack?: Ack) => {
      if (typeof msg === "function") [ack, msg] = [msg, undefined];
      reply(ack, this.setReady(profileId, (msg as { ready?: unknown } | undefined)?.ready !== false));
    });
    socket.on("room:leave", (_msg: unknown, ack?: Ack) => {
      if (typeof _msg === "function") ack = _msg as Ack;
      this.leaveRoom(profileId);
      reply(ack, { ok: true });
    });

    socket.on("disconnect", () => {
      if (this.isOnline(profileId)) return;
      // Leaving the page drops you from quick match; rooms keep your seat so a
      // refresh of the /r/<code> link comes back, but you are no longer ready.
      this.leaveQueues(profileId);
      const room = this.currentRoom(profileId);
      const me = room?.members.find((x) => x.profileId === profileId);
      if (room && me?.ready && !room.matchId) {
        me.ready = false;
        this.syncCountdown(room);
        this.broadcastRoom(room);
      }
    });
  }

  // ---- quick match ----

  joinQueue(profileId: string, gameId: unknown) {
    const game = typeof gameId === "string" ? this.games.get(gameId) : undefined;
    if (!game) return { ok: false as const, reason: "unknown game" };
    if (this.matches.activeFor(profileId).length) return { ok: false as const, reason: "already in a match" };

    const queue = this.queue(game.id);
    const mine = queue.find((e) => e.profileId === profileId);
    if (mine) {
      this.sendStatus(profileId, game.id, mine);
      return { ok: true as const, state: "waiting" };
    }
    this.leaveQueues(profileId);
    this.leaveRoom(profileId);

    const opponent = queue.shift();
    if (opponent) {
      opponent.timer?.cancel();
      // Seat order is random so neither side always moves first.
      const players: [string, string] =
        randomInt(2) === 0 ? [opponent.profileId, profileId] : [profileId, opponent.profileId];
      const m = this.start(game, players, null, null);
      for (const p of players) this.emitTo(p, "queue:status", { gameId: game.id, state: "matched", matchId: m.id });
      return { ok: true as const, state: "matched", matchId: m.id };
    }

    const entry: QueueEntry = { profileId, since: this.clock.now(), botOffered: false };
    entry.timer = this.clock.setTimeout(() => {
      entry.timer = undefined;
      entry.botOffered = true;
      this.emitTo(profileId, "queue:botOffer", { gameId: game.id });
    }, BOT_OFFER_MS);
    queue.push(entry);
    this.sendStatus(profileId, game.id, entry);
    return { ok: true as const, state: "waiting" };
  }

  leaveQueues(profileId: string) {
    for (const [gameId, queue] of this.queues) {
      const i = queue.findIndex((e) => e.profileId === profileId);
      if (i === -1) continue;
      queue[i].timer?.cancel();
      queue.splice(i, 1);
      this.emitTo(profileId, "queue:status", { gameId, state: "idle" });
    }
  }

  acceptBot(profileId: string) {
    for (const [gameId, queue] of this.queues) {
      const entry = queue.find((e) => e.profileId === profileId);
      if (!entry) continue;
      if (!entry.botOffered) return { ok: false as const, reason: "no bot offer yet" };
      queue.splice(queue.indexOf(entry), 1);
      const game = this.games.get(gameId)!;
      const botSeat: Seat = randomInt(2) === 0 ? 0 : 1;
      const players: [string, string] = botSeat === 0 ? [BOT_PLAYER, profileId] : [profileId, BOT_PLAYER];
      const m = this.start(game, players, botSeat, null);
      this.emitTo(profileId, "queue:status", { gameId, state: "matched", matchId: m.id, bot: true });
      return { ok: true as const, state: "matched", matchId: m.id };
    }
    return { ok: false as const, reason: "not in a queue" };
  }

  private queue(gameId: string) {
    let q = this.queues.get(gameId);
    if (!q) this.queues.set(gameId, (q = []));
    return q;
  }

  private sendStatus(profileId: string, gameId: string, entry: QueueEntry) {
    this.emitTo(profileId, "queue:status", {
      gameId,
      state: "waiting",
      since: entry.since,
      botOfferAt: entry.since + BOT_OFFER_MS,
      botOffered: entry.botOffered,
    });
    if (entry.botOffered) this.emitTo(profileId, "queue:botOffer", { gameId });
  }

  // ---- private rooms ----

  createRoom(profileId: string, gameId: unknown) {
    const game = typeof gameId === "string" ? this.games.get(gameId) : undefined;
    if (!game) return { ok: false as const, reason: "unknown game" };
    this.leaveQueues(profileId);
    this.leaveRoom(profileId);

    let code: string;
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      game,
      host: profileId,
      members: [{ profileId, ready: false }],
      matchId: null,
      lastMatchId: null,
      createdAt: this.clock.now(),
    };
    this.rooms.set(code, room);
    this.enter(profileId, room);
    return { ok: true as const, room: this.roomPayload(room) };
  }

  joinRoom(profileId: string, rawCode: unknown) {
    const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    const room = this.rooms.get(code);
    if (!room) return { ok: false as const, reason: "no room with that code" };
    if (!room.members.some((x) => x.profileId === profileId)) {
      if (room.members.length >= 2) return { ok: false as const, reason: "room is full" };
      this.leaveQueues(profileId);
      this.leaveRoom(profileId);
      room.members.push({ profileId, ready: false });
    }
    this.enter(profileId, room);
    return { ok: true as const, room: this.roomPayload(room) };
  }

  setReady(profileId: string, ready: boolean) {
    const room = this.currentRoom(profileId);
    if (!room) return { ok: false as const, reason: "not in a room" };
    if (room.matchId) return { ok: false as const, reason: "match already started" };
    if (ready && this.matches.activeFor(profileId).length) return { ok: false as const, reason: "already in a match" };
    room.members.find((x) => x.profileId === profileId)!.ready = ready;
    this.syncCountdown(room);
    this.broadcastRoom(room);
    return { ok: true as const, room: this.roomPayload(room) };
  }

  leaveRoom(profileId: string) {
    const room = this.currentRoom(profileId);
    if (!room) return;
    this.roomOf.delete(profileId);
    room.members = room.members.filter((x) => x.profileId !== profileId);
    this.io.in(profileRoom(profileId)).socketsLeave(roomChannel(room.code));
    room.countdown?.timer.cancel();
    room.countdown = undefined;
    if (!room.members.length) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.host === profileId) room.host = room.members[0].profileId;
    room.members.forEach((x) => (x.ready = false));
    this.broadcastRoom(room);
  }

  room(code: string) {
    const room = this.rooms.get(code.trim().toUpperCase());
    return room ? this.roomPayload(room) : null;
  }

  private currentRoom(profileId: string) {
    const code = this.roomOf.get(profileId);
    return code ? this.rooms.get(code) : undefined;
  }

  private enter(profileId: string, room: Room) {
    this.roomOf.set(profileId, room.code);
    this.io.in(profileRoom(profileId)).socketsJoin(roomChannel(room.code));
    this.broadcastRoom(room);
  }

  // ---- rematch ----

  private start(game: AnyGame, players: [string, string], botSeat: Seat | null, room: string | null) {
    const m = this.matches.create({ game, players, botSeat });
    this.rematches.set(m.id, { game, players, botSeat, room, ended: false, state: "open", wants: [], next: null });
    return m;
  }

  /** The rematch for a match the profile played, if the lobby started it. */
  private rematchFor(profileId: string, matchId: unknown) {
    const r = typeof matchId === "string" ? this.rematches.get(matchId) : undefined;
    return r && r.players.includes(profileId) ? r : undefined;
  }

  private rematchPayload(matchId: string, r: Rematch) {
    return { matchId, state: r.state, bot: r.botSeat !== null, wants: r.wants, next: r.next };
  }

  /** Whether the result card can offer a rematch, and where it stands. */
  rematchStatus(profileId: string, matchId: unknown) {
    const r = this.rematchFor(profileId, matchId);
    if (!r) return { ok: true as const, available: false };
    return { ok: true as const, available: true, ...this.rematchPayload(matchId as string, r) };
  }

  /**
   * Against the bot the next match starts at once. Against a player it is an
   * offer, and the match starts when the other player asks too. Seats swap
   * each time so the other side moves first.
   */
  requestRematch(profileId: string, matchId: unknown) {
    const r = this.rematchFor(profileId, matchId);
    if (!r) return { ok: false as const, reason: "no rematch for this match" };
    const id = matchId as string;
    if (r.state === "matched") return { ok: true as const, state: r.state, matchId: r.next };
    if (!r.ended) return { ok: false as const, reason: "match is still live" };
    if (r.state !== "open" && r.state !== "offered") return { ok: false as const, reason: `rematch ${r.state}` };
    if (!r.wants.includes(profileId)) r.wants.push(profileId);

    const humans = r.players.filter((_, seat) => seat !== r.botSeat);
    if (!humans.every((p) => r.wants.includes(p))) {
      r.state = "offered";
      this.broadcastRematch(id, r);
      return { ok: true as const, state: r.state };
    }
    if (humans.some((p) => this.matches.activeFor(p).length)) {
      r.wants = r.wants.filter((p) => p !== profileId);
      return { ok: false as const, reason: "already in a match" };
    }

    humans.forEach((p) => this.leaveQueues(p));
    const players: [string, string] = [r.players[1], r.players[0]];
    const botSeat: Seat | null = r.botSeat === null ? null : r.botSeat === 0 ? 1 : 0;
    const room = r.room ? this.rooms.get(r.room) : undefined;
    const keepRoom = room && !room.matchId && humans.every((p) => room.members.some((x) => x.profileId === p));
    const m = this.start(r.game, players, botSeat, keepRoom ? room.code : null);
    r.state = "matched";
    r.next = m.id;
    if (keepRoom) {
      room.countdown?.timer.cancel();
      room.countdown = undefined;
      room.matchId = m.id;
      room.members.forEach((x) => (x.ready = false));
      this.broadcastRoom(room);
    }
    this.broadcastRematch(id, r);
    return { ok: true as const, state: r.state, matchId: m.id };
  }

  /** Take back your own offer, or turn down the other player's. */
  cancelRematch(profileId: string, matchId: unknown) {
    const r = this.rematchFor(profileId, matchId);
    if (!r) return { ok: false as const, reason: "no rematch for this match" };
    if (r.state !== "offered") return { ok: true as const, state: r.state };
    const mine = r.wants.includes(profileId);
    r.wants = r.wants.filter((p) => p !== profileId);
    r.state = mine ? "open" : "declined";
    this.broadcastRematch(matchId as string, r);
    return { ok: true as const, state: r.state };
  }

  private broadcastRematch(matchId: string, r: Rematch) {
    const payload = this.rematchPayload(matchId, r);
    for (const p of new Set(r.players)) if (p !== BOT_PLAYER) this.emitTo(p, "rematch:update", payload);
  }

  /** Starts the 3-2-1 when both seats are ready and stops it as soon as they aren't. */
  private syncCountdown(room: Room) {
    const allReady = !room.matchId && room.members.length === 2 && room.members.every((x) => x.ready);
    if (allReady && !room.countdown) {
      room.countdown = {
        endsAt: this.clock.now() + ROOM_COUNTDOWN_MS,
        timer: this.clock.setTimeout(() => this.startRoomMatch(room), ROOM_COUNTDOWN_MS),
      };
    } else if (!allReady && room.countdown) {
      room.countdown.timer.cancel();
      room.countdown = undefined;
    }
  }

  private startRoomMatch(room: Room) {
    room.countdown = undefined;
    if (this.rooms.get(room.code) !== room) return;
    const players = room.members.map((x) => x.profileId) as [string, string];
    // Someone who got into another match meanwhile is no longer ready.
    const busy = players.filter((p) => this.matches.activeFor(p).length);
    if (busy.length) {
      room.members.forEach((x) => busy.includes(x.profileId) && (x.ready = false));
    } else {
      // Host sits first in the room list; seats are still drawn at random.
      if (randomInt(2) === 1) players.reverse();
      room.matchId = this.start(room.game, players, null, room.code).id;
    }
    this.broadcastRoom(room);
  }

  /** A match ended: rematches open for a while, and its room goes back to waiting. */
  private matchEnded(m: Match) {
    const r = this.rematches.get(m.id);
    if (r) {
      r.ended = true;
      r.timer = this.clock.setTimeout(() => {
        this.rematches.delete(m.id);
        if (r.state === "open" || r.state === "offered") {
          r.state = "closed";
          this.broadcastRematch(m.id, r);
        }
      }, REMATCH_WINDOW_MS);
    }
    for (const room of this.rooms.values()) {
      if (room.matchId !== m.id) continue;
      room.matchId = null;
      room.lastMatchId = m.id;
      room.members.forEach((x) => (x.ready = false));
      this.broadcastRoom(room);
    }
  }

  private broadcastRoom(room: Room) {
    this.io.to(roomChannel(room.code)).emit("room:update", this.roomPayload(room));
  }

  private roomPayload(room: Room) {
    return {
      code: room.code,
      link: `/r/${room.code}`,
      gameId: room.game.id,
      gameName: room.game.name,
      host: room.host,
      members: room.members.map((x) => ({
        profileId: x.profileId,
        name: this.identity.get(x.profileId)?.name ?? null,
        ready: x.ready,
        online: this.isOnline(x.profileId),
      })),
      state: room.matchId ? "playing" : room.countdown ? "countdown" : room.members.length < 2 ? "waiting" : "ready-check",
      matchId: room.matchId,
      // Time left rather than a timestamp, so client clock skew doesn't matter.
      countdownMs: room.countdown ? Math.max(0, room.countdown.endsAt - this.clock.now()) : null,
    };
  }

  private emitTo(profileId: string, event: string, data: unknown) {
    this.io.to(profileRoom(profileId)).emit(event, data);
  }

  private isOnline(profileId: string) {
    return (this.io.sockets.adapter.rooms.get(profileRoom(profileId))?.size ?? 0) > 0;
  }
}

export function lobbyRoutes(lobby: Lobby): Router {
  const router = Router();

  router.get("/api/games", (_req, res) => {
    res.json(lobby.gameList());
  });

  router.get("/api/live", (req, res) => {
    res.json(lobby.liveMatches(typeof req.query.game === "string" ? req.query.game : undefined));
  });

  // The /r/<code> page looks the room up before joining it.
  router.get("/api/rooms/:code", (req, res) => {
    const room = lobby.room(req.params.code);
    if (!room) {
      res.status(404).json({ error: "room not found" });
      return;
    }
    res.json(room);
  });

  return router;
}
