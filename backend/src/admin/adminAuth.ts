// Admin sign-in for /api/admin/*. The shared ADMIN_TOKEN is typed once and swapped for
// a short-lived session (12 h), so the admin site never has to keep the token itself.
// One guard covers every admin route: it takes X-Admin-Token (curl) or X-Admin-Session.
// Only sha256(session) is kept, in memory: a restart signs every admin out. Wrong tokens
// are rate limited per IP and globally; nothing here ever logs the token or a session id.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { RateLimiter } from "../rateLimit";
import type { AdminAudit } from "./adminAudit";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_SESSIONS = 20;
export const FAIL_WINDOW_MS = 15 * 60 * 1000;
export const FAILS_PER_IP = 10;
export const FAILS_GLOBAL = 50;
export const NAME_MAX = 40;

/** True when `given` is the admin token. Off (always false) unless the token is at least 24 characters. */
export function isAdmin(given: unknown, token = process.env.ADMIN_TOKEN): boolean {
  if (!token || token.length < 24 || typeof given !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

/** Who is calling an admin route; the guard puts it on `res.locals.admin`. */
export interface AdminCaller {
  /** The name typed at sign-in; null for a raw-token caller. */
  name: string | null;
  via: "token" | "session";
}

/** The caller the guard accepted. Only valid inside a guarded route. */
export function adminCaller(res: Response): AdminCaller {
  return res.locals.admin as AdminCaller;
}

/** The audit `actor` for a caller: the admin's name, or "token". */
export function actorOf(caller: AdminCaller): string {
  return caller.name ?? "token";
}

interface AdminSession {
  name: string;
  createdAt: number;
  expiresAt: number;
}

export interface AdminAuthOptions {
  audit: AdminAudit;
  now?: () => number;
  /** Reads ADMIN_TOKEN on every request by default, so tests can change it. */
  token?: () => string | undefined;
  ttlMs?: number;
  maxSessions?: number;
}

const hashSession = (raw: string) => createHash("sha256").update(raw).digest("hex");
const header = (req: Request, name: string) => {
  const v = req.headers[name];
  return typeof v === "string" && v ? v : null;
};
const ipOf = (req: Request) => req.ip || "unknown";

export class AdminAuth {
  private readonly sessions = new Map<string, AdminSession>();
  private readonly perIp: RateLimiter;
  private readonly global: RateLimiter;
  private readonly now: () => number;
  private readonly token: () => string | undefined;
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly audit: AdminAudit;

  constructor(opts: AdminAuthOptions) {
    this.audit = opts.audit;
    this.now = opts.now ?? Date.now;
    this.token = opts.token ?? (() => process.env.ADMIN_TOKEN);
    this.ttlMs = opts.ttlMs ?? SESSION_TTL_MS;
    this.maxSessions = opts.maxSessions ?? MAX_SESSIONS;
    this.perIp = new RateLimiter(FAILS_PER_IP, FAIL_WINDOW_MS, this.now);
    this.global = new RateLimiter(FAILS_GLOBAL, FAIL_WINDOW_MS, this.now);
  }

  /** Admin routes exist only with an ADMIN_TOKEN of 24+ characters. */
  enabled(): boolean {
    const t = this.token();
    return !!t && t.length >= 24;
  }

  /** Middleware for everything under /api/admin. */
  readonly guard: RequestHandler = (req, res, next) => {
    if (!this.enabled()) return res.status(404).json({ error: "not found" });
    const session = this.session(header(req, "x-admin-session"));
    if (session) {
      res.locals.admin = { name: session.name, via: "session" } satisfies AdminCaller;
      return next();
    }
    const given = header(req, "x-admin-token");
    if (given === null) return res.status(401).json({ error: "admin token required" });
    if (this.locked(req)) return res.status(429).json({ error: "too many failed attempts, try again later" });
    if (!isAdmin(given, this.token())) {
      this.fail(req);
      return res.status(401).json({ error: "admin token required" });
    }
    res.locals.admin = { name: null, via: "token" } satisfies AdminCaller;
    next();
  };

  /** POST /api/admin/session, mounted before the guard: it handles its own token check. */
  readonly signIn: RequestHandler = (req, res) => {
    if (!this.enabled()) return res.status(404).json({ error: "not found" });
    if (this.locked(req)) return res.status(429).json({ error: "too many failed attempts, try again later" });
    const token = this.token();
    if (!isAdmin(header(req, "x-admin-token"), token)) {
      this.fail(req);
      this.audit.add({ actor: "unknown", action: "signin-failed", ip: ipOf(req) });
      return res.status(401).json({ error: "admin token required" });
    }
    const raw = req.body?.name;
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name || name.length > NAME_MAX || (token && name.includes(token))) {
      return res.status(400).json({ error: `name required (1 to ${NAME_MAX} characters)` });
    }
    const { session, expiresAt } = this.create(name);
    this.audit.add({ actor: name, action: "signin", ip: ipOf(req) });
    res.json({ session, name, expiresAt });
  };

  /** GET and DELETE /api/admin/session; mount after the guard. */
  routes(): Router {
    const router = Router();
    router.get("/api/admin/session", (req, res) => {
      const caller = adminCaller(res);
      if (caller.via === "token") return res.json({ name: null, expiresAt: null });
      const s = this.session(header(req, "x-admin-session"));
      res.json({ name: caller.name, expiresAt: s?.expiresAt ?? null });
    });
    router.delete("/api/admin/session", (req, res) => {
      const caller = adminCaller(res);
      const raw = header(req, "x-admin-session");
      if (caller.via !== "session" || !raw) return res.status(400).json({ error: "no session to end" });
      this.sessions.delete(hashSession(raw));
      this.audit.add({ actor: actorOf(caller), action: "signout", ip: ipOf(req) });
      res.json({ ok: true });
    });
    return router;
  }

  /** Number of live sessions (for the system page later). */
  liveSessions(): number {
    this.prune();
    return this.sessions.size;
  }

  private create(name: string): { session: string; expiresAt: number } {
    this.prune();
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    const session = randomBytes(32).toString("hex");
    const createdAt = this.now();
    const expiresAt = createdAt + this.ttlMs;
    this.sessions.set(hashSession(session), { name, createdAt, expiresAt });
    return { session, expiresAt };
  }

  private session(raw: string | null): AdminSession | null {
    if (!raw) return null;
    const key = hashSession(raw);
    const s = this.sessions.get(key);
    if (!s) return null;
    if (s.expiresAt <= this.now()) {
      this.sessions.delete(key);
      return null;
    }
    return s;
  }

  private prune() {
    const now = this.now();
    for (const [k, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(k);
  }

  private locked(req: Request): boolean {
    return this.perIp.blocked(ipOf(req)) || this.global.blocked("*");
  }

  private fail(req: Request) {
    this.perIp.record(ipOf(req));
    this.global.record("*");
  }
}
