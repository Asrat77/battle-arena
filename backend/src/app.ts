import "dotenv/config";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import type { Clock } from "./clock";
import { Identity, identityRoutes } from "./identity";
import { Ledger, ledgerRoutes, type LedgerOptions } from "./ledger";
import { Lobby, lobbyRoutes, type LobbyOptions } from "./lobby";
import { MatchRuntime } from "./matches";
import { matchRoutes, Recorder } from "./recorder";
import { FileStore, type Store } from "./store";

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

  io.on("connection", (socket) => {
    matches.attach(socket, socket.data.profileId as string);
    lobby.attach(socket, socket.data.profileId as string);
  });

  return { app, httpServer, io, store, identity, ledger, matches, recorder, lobby };
}
