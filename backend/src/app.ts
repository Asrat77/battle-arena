import "dotenv/config";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { Identity, identityRoutes } from "./identity";
import { Ledger, ledgerRoutes, type LedgerOptions } from "./ledger";
import { FileStore, type Store } from "./store";

export interface AppOptions {
  store?: Store;
  ledger?: LedgerOptions;
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

  return { app, httpServer, io, store, identity, ledger };
}
