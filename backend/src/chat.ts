// Chat: one conversation per room, shared by players and spectators. A
// private room chats under its code; a quick match (no room) chats under its
// match ID. Spectators address a room's match by match ID and land in the
// room's chat, so everyone watching sees the same messages; they keep it after
// the match ends, while the pair waits for a rematch.

import type { Server, Socket } from "socket.io";
import { systemClock, type Clock } from "./clock";
import type { Identity } from "./identity";
import { roomChannel, type Lobby } from "./lobby";
import { profileRoom, specRoom, type MatchRuntime } from "./matches";

export const MAX_CHAT_CHARS = 200;
export const RATE_LIMIT = { messages: 5, windowMs: 10_000 };
export const HISTORY_SIZE = 50;
export const REACTIONS = ["👍", "👏", "😂", "😮", "🔥", "🤝", "😭", "GG"] as const;

export interface ChatMessage {
  id: number;
  /** The chat it belongs to: a room code or a match ID. */
  roomId: string;
  from: { profileId: string; name: string | null };
  spectator: boolean;
  ts: number;
  kind: "text" | "reaction";
  text: string;
}

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; reason: string }) => void;

interface Target {
  roomId: string;
  /** socket.io channels that receive the chat. */
  channels: string[];
  /** Seated player or room member (as opposed to a spectator). */
  member: boolean;
}

export class Chat {
  private history = new Map<string, ChatMessage[]>();
  /** Send times per profile, for the rate limit (shared by text and reactions). */
  private sent = new Map<string, number[]>();
  private nextId = 1;
  private readonly clock: Clock;

  constructor(
    private readonly io: Server,
    private readonly matches: MatchRuntime,
    private readonly lobby: Lobby,
    private readonly identity: Identity,
    opts: { clock?: Clock } = {},
  ) {
    this.clock = opts.clock ?? systemClock;
  }

  attach(socket: Socket, profileId: string) {
    const reply = (ack: Ack | undefined, res: Parameters<Ack>[0]) => {
      if (res.ok === false) socket.emit("chat:error", { reason: res.reason });
      if (typeof ack === "function") ack(res);
    };

    socket.on("chat:send", (msg: { roomId?: unknown; text?: unknown }, ack?: Ack) =>
      reply(ack, this.send(socket, profileId, msg?.roomId, "text", msg?.text)),
    );
    socket.on("chat:react", (msg: { roomId?: unknown; emoji?: unknown }, ack?: Ack) =>
      reply(ack, this.send(socket, profileId, msg?.roomId, "reaction", msg?.emoji)),
    );
    socket.on("chat:history", (msg: { roomId?: unknown }, ack?: Ack) => {
      const target = this.resolve(socket, profileId, msg?.roomId);
      if (typeof target === "string") return reply(ack, { ok: false, reason: target });
      reply(ack, { ok: true, roomId: target.roomId, messages: this.history.get(target.roomId) ?? [], reactions: REACTIONS });
    });
  }

  send(socket: Socket, profileId: string, roomId: unknown, kind: ChatMessage["kind"], raw: unknown) {
    const target = this.resolve(socket, profileId, roomId);
    if (typeof target === "string") return { ok: false as const, reason: target };

    let text: string;
    if (kind === "text") {
      // Control characters out, whitespace collapsed at the ends.
      text = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
      if (!text) return { ok: false as const, reason: "message is empty" };
      if ([...text].length > MAX_CHAT_CHARS) return { ok: false as const, reason: `message is over ${MAX_CHAT_CHARS} characters` };
    } else {
      if (!REACTIONS.includes(raw as (typeof REACTIONS)[number])) return { ok: false as const, reason: "unknown reaction" };
      text = raw as string;
    }

    const now = this.clock.now();
    const recent = (this.sent.get(profileId) ?? []).filter((t) => t > now - RATE_LIMIT.windowMs);
    if (recent.length >= RATE_LIMIT.messages) {
      this.sent.set(profileId, recent);
      return { ok: false as const, reason: "slow down", retryAt: recent[0] + RATE_LIMIT.windowMs };
    }
    recent.push(now);
    this.sent.set(profileId, recent);

    const message: ChatMessage = {
      id: this.nextId++,
      roomId: target.roomId,
      from: { profileId, name: this.identity.get(profileId)?.name ?? null },
      spectator: !target.member,
      ts: now,
      kind,
      text,
    };
    const log = this.history.get(target.roomId) ?? [];
    log.push(message);
    if (log.length > HISTORY_SIZE) log.shift();
    this.history.set(target.roomId, log);
    this.io.to(target.channels).emit("chat:message", message);
    return { ok: true as const, message };
  }

  /** Which chat a roomId names and whether this socket may use it; a string is a refusal. */
  private resolve(socket: Socket, profileId: string, roomId: unknown): Target | string {
    if (typeof roomId !== "string" || !roomId) return "no such room";

    const match = this.matches.get(roomId);
    const room = match ? this.lobby.roomOfMatch(match.id) : this.lobby.roomInfo(roomId);
    if (room) {
      const member = room.members.includes(profileId);
      const watching = room.watchMatchId !== null && this.matches.isWatching(socket, room.watchMatchId);
      if (!member && !watching) return "you are not in this room";
      const channels = [roomChannel(room.code)];
      if (room.watchMatchId) channels.push(specRoom(room.watchMatchId));
      return { roomId: room.code, channels, member };
    }

    if (!match) return "no such room";
    const member = match.players.includes(profileId);
    if (!member && !this.matches.isWatching(socket, match.id)) return "you are not in this match";
    return {
      roomId: match.id,
      channels: [specRoom(match.id), ...match.players.map(profileRoom)],
      member,
    };
  }
}
