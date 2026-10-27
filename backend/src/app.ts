import "dotenv/config";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";

export function createApp() {
  const origin = process.env.FRONTEND_URL || "http://localhost:3000";

  const app = express();
  app.use(cors({ origin, credentials: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin, methods: ["GET", "POST"], credentials: true },
  });

  return { app, httpServer, io };
}
