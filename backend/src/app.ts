import "dotenv/config";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import type { Clock } from "./clock";
import { Chat } from "./chat";
import { Identity, identityRoutes } from "./identity";
import { Ledger, ledgerRoutes, type LedgerOptions } from "./ledger";
import { Lobby, lobbyRoutes, type LobbyOptions } from "./lobby";
import { MatchRuntime, profileRoom, type Match } from "./matches";
import { matchRoutes, Recorder, type StoredMatch } from "./recorder";
import { rewardRoutes, Rewards } from "./rewards";
import { Social, socialRoutes } from "./social";
import { FileStore, type Store } from "./store";
import { tournamentRoutes, Tournaments } from "./tournaments";

export interface AppOptions {
  store?: Store;
  ledger?: LedgerOptions;
  clock?: Clock;
  games?: LobbyOptions["games"];
}

export function createApp(options: AppOptions = {}) {
  const origin = process.env.FRONTEND_URL || "http://localhost:3000";
  const store = options.store ?? new FileStore(process.env.DATA_FILE || "data/db.json");
  const identity = new Identity(store);
  const ledger = new Ledger(store, options.ledger);

  const app = express();
  app.use(cors({ origin, credentials: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(identityRoutes(identity));
  app.use(ledgerRoutes(ledger));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin, methods: ["GET", "POST"], credentials: true },
    // A phone that locks or loses signal leaves no close frame. Ping often so a
    // dead socket leaves the queue in ~15 s instead of ~45 s and isn't paired.
    pingInterval: 10_000,
    pingTimeout: 5_000,
  });

  // Sockets authenticate with the session token from signup: io(url, { auth: { token } }).
  io.use((socket, next) => {
    const profile = identity.byToken(socket.handshake.auth?.token);
    if (!profile) return next(new Error("unauthorized"));
    socket.data.profileId = profile.id;
    next();
  });

  const matches = new MatchRuntime(io, { clock: options.clock });
  const recorder = new Recorder(store, ledger, matches);
  app.use(matchRoutes(recorder, matches));
  const lobby = new Lobby(io, matches, identity, { clock: options.clock, games: options.games });
  app.use(lobbyRoutes(lobby));
  const rewards = new Rewards(store, ledger, {
    isPlayer: (id) => identity.get(id) !== null,
    nameOf: (id) => identity.get(id)?.name ?? id,
    notify: (id, payload) => io.to(profileRoom(id)).emit("notify", payload),
  });
  recorder.on("recorded", (stored: StoredMatch) => rewards.matchRecorded(stored));
  app.use(rewardRoutes(rewards, (id) => identity.get(id) !== null));
  // Watching a match to the end counts towards the Watcher badge.
  matches.on("spectated", (m: Match, ids: string[]) => ids.forEach((id) => rewards.spectated(id, m.id, m.endedAt ?? Date.now())));
  const chat = new Chat(io, matches, lobby, identity, { clock: options.clock });
  const social = new Social(io, store, identity, matches, lobby, recorder);
  app.use(socialRoutes(social, identity));
  const tournaments = new Tournaments(store, io, matches, identity, {
    clock: options.clock,
    games: options.games,
    onChampion: (id, tournamentId, ts) => rewards.tournamentWon(id, tournamentId, ts),
  });
  app.use(tournamentRoutes(tournaments));

  io.on("connection", (socket) => {
    matches.attach(socket, socket.data.profileId as string);
    lobby.attach(socket, socket.data.profileId as string);
    chat.attach(socket, socket.data.profileId as string);
    social.attach(socket, socket.data.profileId as string);
    tournaments.attach(socket, socket.data.profileId as string);
  });

  return { app, httpServer, io, store, identity, ledger, matches, recorder, lobby, rewards, chat, social, tournaments };
}
