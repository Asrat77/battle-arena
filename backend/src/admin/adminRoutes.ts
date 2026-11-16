// Every /api/admin/* route in one router, behind one guard. Mounted once in app.ts.
// Later admin tasks add their read routes here, using the modules in AdminDeps.
// Order matters: sign-in first (it checks the token itself), then the guard, then
// everything else. Nothing under /api/admin may be mounted outside this router.
import { Router } from "express";
import type { Server } from "socket.io";
import type { Db } from "../db";
import type { Deposits } from "../deposits";
import type { Identity } from "../identity";
import type { Ledger } from "../ledger";
import type { Lobby } from "../lobby";
import type { MatchRuntime } from "../matches";
import type { Recorder } from "../recorder";
import type { Rewards } from "../rewards";
import type { Social } from "../social";
import type { Store } from "../store";
import type { Tournaments } from "../tournaments";
import type { VerifyBudget } from "../verifyBudget";
import { walletAdminRoutes, type Wallet } from "../wallet";
import type { Withdrawals } from "../withdrawals";
import { AdminAudit } from "./adminAudit";
import { AdminAuth } from "./adminAuth";
import { adminInsightRoutes } from "./adminInsights";
import { LogCache } from "./adminLedger";
import { adminMoneyRoutes } from "./adminMoney";
import { adminPeopleRoutes } from "./adminPeople";

export interface AdminDeps {
  store: Store;
  wallet: Wallet;
  identity: Identity;
  deposits: Deposits;
  withdrawals: Withdrawals;
  recorder: Recorder;
  matches: MatchRuntime;
  lobby: Lobby;
  rewards: Rewards;
  social: Social;
  tournaments: Tournaments;
  ledger: Ledger;
  io: Server;
  /** For the system page: the Postgres pool (null or missing: none), the verify.et budget, and Telegram flags (booleans and counts only). */
  db?: Db | null;
  verifyBudget?: VerifyBudget | null;
  telegram?: { configured: boolean; moderatorChat: boolean; moderators: number };
  /** Test hooks: time and the admin token (default Date.now and process.env.ADMIN_TOKEN). */
  now?: () => number;
  token?: () => string | undefined;
}

/** Reads `page` (from 0) and `limit` (1..max, default 50) from a query string. */
export function pageQuery(query: Record<string, unknown>, max = 200): { page: number; limit: number } {
  const page = Math.max(0, Math.floor(Number(query.page)) || 0);
  const limit = Math.min(max, Math.max(1, Math.floor(Number(query.limit)) || 50));
  return { page, limit };
}

/**
 * The admin router. In a route, read the caller with `adminCaller(res)` and write an audit
 * entry with `audit.add({ actor: actorOf(adminCaller(res)), action, target, detail, ip: req.ip })`.
 * Add new routes above the closing JSON 404.
 */
export function adminRoutes(deps: AdminDeps): Router {
  const token = deps.token ?? (() => process.env.ADMIN_TOKEN);
  const audit = new AdminAudit(deps.store, deps.now, token);
  const auth = new AdminAuth({ audit, now: deps.now, token });
  const router = Router();

  router.post("/api/admin/session", auth.signIn);
  router.use("/api/admin", auth.guard);
  router.use(auth.routes());

  router.get("/api/admin/audit", (req, res) => {
    const { page, limit } = pageQuery(req.query);
    const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : "");
    res.json(audit.page(page, limit, { action: text(req.query.action).split(","), q: text(req.query.q) }));
  });

  router.use(walletAdminRoutes(deps.wallet, audit));
  router.use(adminPeopleRoutes(deps));
  // One cache in front of the wallet log, shared by every admin route that reads it.
  const log = new LogCache(() => deps.wallet.logEntries(), deps.now);
  router.use(adminMoneyRoutes(deps, audit, log));
  router.use(adminInsightRoutes(deps, audit, auth, log));

  // Guarded but unknown: JSON, not Express's HTML page.
  router.use("/api/admin", (_req, res) => res.status(404).json({ error: "not found" }));
  return router;
}
