// Friends, presence and notifications. Friendship is one-way and light: adding
// someone by profile ID lets you see when they are online or in a match and
// invite them to your room. Toasts go out as `notify {kind, ...}`.

import { Router } from "express";
import type { Server, Socket } from "socket.io";
import { bearerToken, type Identity } from "./identity";
import type { Lobby } from "./lobby";
import { profileRoom, type Match, type MatchRuntime } from "./matches";
import type { Recorder, StoredMatch } from "./recorder";
import type { Store } from "./store";

const FRIENDS = "friends";
export const FRIENDS_MAX = 100;

export type Status = "offline" | "online" | "in-match";

export interface Presence {
  profileId: string;
  name: string | null;
  status: Status;
  matchId: string | null;
}

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; reason: string }) => void;

export class Social {
  constructor(
    private readonly io: Server,
    private readonly store: Store,
    private readonly identity: Identity,
    private readonly matches: MatchRuntime,
    private readonly lobby: Lobby,
    recorder: Recorder,
  ) {
    matches.on("start", (m: Match) => this.matchStarted(m));
    matches.on("end", (m: Match) => m.players.forEach((p) => this.pushPresence(p)));
    recorder.on("recorded", (stored: StoredMatch | null) => {
      if (!stored) return;
      const { record, resultIndex } = stored;
      for (const p of this.humans(record.players)) {
        this.notify(p, { kind: "matchRecorded", matchId: record.matchId, gameId: record.gameId, ledgerIndex: resultIndex });
      }
    });
  }

  /** Call after the match runtime has joined the socket to its profile room. */
  attach(socket: Socket, profileId: string) {
    const reply = (ack: Ack | undefined, res: Parameters<Ack>[0]) => {
      if (typeof ack === "function") ack(res);
    };

    socket.emit("friends", { friends: this.friends(profileId) });
    // First socket for this profile: tell whoever follows them.
    if (this.socketCount(profileId) === 1) {
      this.pushPresence(profileId);
      const name = this.identity.get(profileId)?.name ?? null;
      for (const f of this.followers(profileId)) this.notify(f, { kind: "friendOnline", profileId, name });
    }

    socket.on("friend:add", (msg: { profileId?: unknown }, ack?: Ack) => reply(ack, this.add(profileId, msg?.profileId)));
    socket.on("friend:remove", (msg: { profileId?: unknown }, ack?: Ack) =>
      reply(ack, this.remove(profileId, msg?.profileId)),
    );
    socket.on("friend:list", (_msg: unknown, ack?: Ack) => {
      if (typeof _msg === "function") ack = _msg as Ack;
      reply(ack, { ok: true, friends: this.friends(profileId) });
    });
    socket.on("friend:invite", (msg: { profileId?: unknown; code?: unknown }, ack?: Ack) =>
      reply(ack, this.invite(profileId, msg?.profileId, msg?.code)),
    );

    socket.on("disconnect", () => {
      if (this.socketCount(profileId) === 0) this.pushPresence(profileId);
    });
  }

  add(profileId: string, rawId: unknown) {
    const id = typeof rawId === "string" ? rawId.trim().toLowerCase() : "";
    if (!this.identity.get(id)) return { ok: false as const, reason: "no profile with that ID" };
    if (id === profileId) return { ok: false as const, reason: "cannot add yourself" };
    const list = this.list(profileId);
    if (!list.includes(id)) {
      if (list.length >= FRIENDS_MAX) return { ok: false as const, reason: "friend list is full" };
      this.save(profileId, [...list, id]);
      this.pushFriends(profileId);
    }
    return { ok: true as const, friend: this.presence(id) };
  }

  remove(profileId: string, rawId: unknown) {
    const id = typeof rawId === "string" ? rawId.trim().toLowerCase() : "";
    const list = this.list(profileId);
    if (list.includes(id)) {
      this.save(profileId, list.filter((x) => x !== id));
      this.pushFriends(profileId);
    }
    return { ok: true as const };
  }

  /** Invite a friend to the room you are in. They get a toast with a Join link. */
  invite(profileId: string, rawId: unknown, rawCode: unknown) {
    const id = typeof rawId === "string" ? rawId.trim().toLowerCase() : "";
    if (!this.list(profileId).includes(id)) return { ok: false as const, reason: "not on your friend list" };
    const room = typeof rawCode === "string" ? this.lobby.room(rawCode) : null;
    if (!room || !room.members.some((x) => x.profileId === profileId)) {
      return { ok: false as const, reason: "you are not in that room" };
    }
    if (room.members.some((x) => x.profileId === id)) return { ok: false as const, reason: "already in the room" };
    if (room.members.length >= 2) return { ok: false as const, reason: "room is full" };
    if (this.socketCount(id) === 0) return { ok: false as const, reason: "friend is offline" };
    this.notify(id, {
      kind: "invite",
      from: { profileId, name: this.identity.get(profileId)?.name ?? null },
      code: room.code,
      link: room.link,
      gameId: room.gameId,
      gameName: room.gameName,
    });
    return { ok: true as const };
  }

  /** Your friends with their live status. */
  friends(profileId: string): Presence[] {
    return this.list(profileId).map((id) => this.presence(id));
  }

  presence(profileId: string): Presence {
    const match = this.matches.activeFor(profileId)[0];
    const online = this.socketCount(profileId) > 0;
    return {
      profileId,
      name: this.identity.get(profileId)?.name ?? null,
      status: !online ? "offline" : match ? "in-match" : "online",
      matchId: online && match ? match.id : null,
    };
  }

  notify(profileId: string, payload: Record<string, unknown>) {
    this.io.to(profileRoom(profileId)).emit("notify", payload);
  }

  private matchStarted(m: Match) {
    const players = m.players;
    for (const [seat, p] of players.entries()) {
      if (seat === m.botSeat) continue;
      const other = players[1 - seat];
      const bot = m.botSeat !== null;
      this.notify(p, {
        kind: "matchFound",
        matchId: m.id,
        gameId: m.game.id,
        gameName: m.game.name,
        bot,
        opponent: bot ? null : { profileId: other, name: this.identity.get(other)?.name ?? null },
      });
      this.pushPresence(p);
    }
  }

  /** Send a profile's current status to everyone who has them as a friend. */
  private pushPresence(profileId: string) {
    const followers = this.followers(profileId);
    if (followers.length) this.io.to(followers.map(profileRoom)).emit("presence", this.presence(profileId));
  }

  private pushFriends(profileId: string) {
    this.io.to(profileRoom(profileId)).emit("friends", { friends: this.friends(profileId) });
  }

  private humans(players: string[]) {
    return players.filter((p) => this.identity.get(p) !== null);
  }

  private followers(profileId: string) {
    const all = this.store.read<Record<string, string[]>>(FRIENDS, {});
    return Object.keys(all).filter((id) => all[id].includes(profileId));
  }

  private list(profileId: string): string[] {
    return this.store.read<Record<string, string[]>>(FRIENDS, {})[profileId] ?? [];
  }

  private save(profileId: string, list: string[]) {
    this.store.write(FRIENDS, { ...this.store.read<Record<string, string[]>>(FRIENDS, {}), [profileId]: list });
  }

  private socketCount(profileId: string) {
    return this.io.sockets.adapter.rooms.get(profileRoom(profileId))?.size ?? 0;
  }
}

export function socialRoutes(social: Social, identity: Identity): Router {
  const router = Router();

  // Your friends with live status, for the friends panel on first load.
  router.get("/api/friends", (req, res) => {
    const me = identity.byToken(bearerToken(req.headers.authorization));
    if (!me) {
      res.status(401).json({ error: "invalid or missing session token" });
      return;
    }
    res.json({ friends: social.friends(me.id) });
  });

  router.get("/api/profiles/:id/presence", (req, res) => {
    const id = req.params.id.toLowerCase();
    if (!identity.get(id)) {
      res.status(404).json({ error: "profile not found" });
      return;
    }
    res.json(social.presence(id));
  });

  return router;
}
