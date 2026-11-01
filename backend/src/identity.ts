import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { Router, type Response } from "express";
import { isAvatar } from "../../engine/avatars";
import { sha256Hex } from "../../engine/hash";
import { RateLimiter } from "./rateLimit";
import type { Store } from "./store";

export interface Profile {
  id: string; // EVM-style address, 0x + 40 hex
  name: string;
  /** Unique @handle, lowercase. Every profile has one; guests get an automatic one. */
  username: string;
  createdAt: number;
  /** Picked picture (engine/avatars); absent means the id-derived default. */
  avatar?: string;
}

interface StoredProfile extends Omit<Profile, "username"> {
  publicKey: string;
  privateKey: string; // custodial: the server holds the key, no wallet needed
  username?: string; // only missing on profiles saved before handles existed (backfilled on load)
  usernameChangedAt?: number; // last rename of the @handle; absent until the first one
  passwordHash?: string; // scrypt, `salt:hash` hex; absent for a guest
}

const PROFILES = "profiles";
const SESSIONS = "sessions"; // sha256(token) -> profile id

export const NAME_MAX = 24;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const USERNAME = /^[a-z0-9_]{3,20}$/;
const USERNAME_MAX = 20;
/** Handles nobody can take: they read as the system or a bot. */
const RESERVED = new Set(["bot", "admin", "arena", "system", "guest"]);

/** After changing your @username you wait this long to change it again (the first change is free). */
export const USERNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** Availability checks per IP per minute: enough for typing, too few for scraping every name. */
export const USERNAME_CHECK_MAX = 30;

// Failed sign-ins per username: after MAX_FAILS the account waits LOCK_MS.
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, "hex"), 32), expected);
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function normalUsername(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().replace(/^@/, "").toLowerCase() : "";
}

function parseUsername(raw: unknown): string {
  const username = normalUsername(raw);
  if (!USERNAME.test(username)) throw new AuthError("username must be 3 to 20 letters, numbers or underscores");
  if (RESERVED.has(username)) throw new AuthError("that username is taken", 409);
  return username;
}

function parsePassword(raw: unknown, label = "password"): string {
  const password = typeof raw === "string" ? raw : "";
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new AuthError(`${label} must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`);
  }
  return password;
}

function parseName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > NAME_MAX) throw new AuthError(`name must be 1 to ${NAME_MAX} characters`);
  return name;
}

/** A handle base from a display name: "Abebe K." -> "abebe_k". Never shorter than 3. */
function handleBase(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, USERNAME_MAX - 4)
    .replace(/_+$/, "");
  return base.length >= 3 && !RESERVED.has(base) ? base : "player";
}

export function addressFromPublicKey(publicKey: Uint8Array): string {
  const uncompressed = secp256k1.ProjectivePoint.fromHex(publicKey).toRawBytes(false);
  return `0x${bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20))}`;
}

function hashToken(token: string): string {
  return sha256Hex(token);
}

function toProfile({ id, name, username, createdAt, avatar }: StoredProfile): Profile {
  return { id, name, username: username!, createdAt, ...(avatar && { avatar }) };
}

export interface IdentityOptions {
  /** Called after a profile's public fields change (rename, new picture). */
  onChange?: (profile: Profile) => void;
}

export class Identity {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
    private readonly opts: IdentityOptions = {},
  ) {
    this.backfillUsernames();
  }

  /** Profiles saved before everyone had a handle get one from their name. Idempotent. */
  private backfillUsernames() {
    const profiles = this.profiles();
    const missing = Object.values(profiles)
      .filter((p) => !p.username)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (!missing.length) return;
    const taken = new Set(Object.values(profiles).flatMap((p) => (p.username ? [p.username] : [])));
    for (const p of missing) {
      p.username = this.freeHandle(p.name, taken);
      taken.add(p.username);
    }
    this.store.write(PROFILES, profiles);
  }

  /** The first free handle for a name: abebe, abebe_2, abebe_3, ... */
  private freeHandle(name: string, taken: Set<string> = this.usernames()): string {
    const base = handleBase(name);
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}_${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private usernames(): Set<string> {
    return new Set(Object.values(this.profiles()).flatMap((p) => (p.username ? [p.username] : [])));
  }

  private changed(stored: StoredProfile) {
    this.opts.onChange?.(toProfile(stored));
  }

  private stored(token: unknown): StoredProfile {
    const me = this.byToken(token);
    if (!me) throw new AuthError("invalid or missing session token", 401);
    return this.profiles()[me.id];
  }

  private profiles() {
    return this.store.read<Record<string, StoredProfile>>(PROFILES, {});
  }

  private sessions() {
    return this.store.read<Record<string, string>>(SESSIONS, {});
  }

  private fails = new Map<string, { count: number; until: number }>();

  private newSession(id: string): string {
    const token = randomBytes(32).toString("hex");
    this.store.write(SESSIONS, { ...this.sessions(), [hashToken(token)]: id });
    return token;
  }

  private findByUsername(username: string): StoredProfile | undefined {
    return Object.values(this.profiles()).find((p) => p.username === username);
  }

  /** Profiles whose username starts with `q`, then ones whose display name contains it. Case-insensitive. */
  search(rawQuery: unknown, limit = 8): Profile[] {
    const q = typeof rawQuery === "string" ? rawQuery.trim().toLowerCase().replace(/^@/, "") : "";
    if (q.length < 2) return [];
    const all = Object.values(this.profiles());
    const byHandle = all.filter((p) => p.username?.startsWith(q)).sort((a, b) => a.username!.localeCompare(b.username!));
    const byName = all
      .filter((p) => !p.username?.startsWith(q) && p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...byHandle, ...byName].slice(0, limit).map(toProfile);
  }

  /** A profile by its sign-in username (case-insensitive), or null. */
  byUsername(rawUsername: unknown): Profile | null {
    const username = normalUsername(rawUsername);
    const stored = username ? this.findByUsername(username) : undefined;
    return stored ? toProfile(stored) : null;
  }

  /** Is this handle free to take? Invalid handles are never available. */
  usernameStatus(raw: unknown, forId?: string): { username: string; available: boolean; reason?: string } {
    const username = normalUsername(raw);
    try {
      parseUsername(username);
    } catch (err) {
      return { username, available: false, reason: (err as Error).message };
    }
    const owner = this.findByUsername(username);
    if (owner && owner.id !== forId) return { username, available: false, reason: "that username is taken" };
    return { username, available: true };
  }

  /**
   * New profile. A username is optional: a guest without one gets a handle made
   * from the display name. A password makes the profile one you can sign back into.
   * The display name may be left out when a username is given; it then defaults to it.
   */
  signup(
    rawName: unknown,
    credentials?: { username?: unknown; password?: unknown },
    rawAvatar?: unknown,
  ): { profile: Profile; token: string } {
    const wantsUsername = credentials?.username != null && credentials.username !== "";
    const wantsPassword = credentials?.password != null && credentials.password !== "";
    if (wantsPassword && !wantsUsername) throw new AuthError("pick a username to go with the password");
    const chosen = wantsUsername ? parseUsername(credentials!.username) : null;
    const password = wantsPassword ? parsePassword(credentials!.password) : null;

    const name = rawName == null || rawName === "" ? (chosen ?? parseName(rawName)) : parseName(rawName);
    if (rawAvatar != null && !isAvatar(rawAvatar)) throw new AuthError("unknown avatar");
    if (chosen && this.findByUsername(chosen)) throw new AuthError("that username is taken", 409);

    const privateKey = secp256k1.utils.randomPrivateKey();
    const publicKey = secp256k1.getPublicKey(privateKey);
    const stored: StoredProfile = {
      id: addressFromPublicKey(publicKey),
      name,
      username: chosen ?? this.freeHandle(name),
      createdAt: this.now(),
      ...(rawAvatar != null && { avatar: rawAvatar as string }),
      publicKey: bytesToHex(publicKey),
      privateKey: bytesToHex(privateKey),
      ...(password && { passwordHash: hashPassword(password) }),
    };

    this.store.write(PROFILES, { ...this.profiles(), [stored.id]: stored });
    return { profile: toProfile(stored), token: this.newSession(stored.id) };
  }

  /**
   * Give a guest profile a password so it can be signed into again. The username
   * is optional: left out, the guest keeps the handle they already have.
   */
  claim(token: unknown, rawUsername: unknown, rawPassword: unknown): Profile {
    const me = this.stored(token);
    if (me.passwordHash) throw new AuthError("this profile already has a password", 409);
    const username = rawUsername == null || rawUsername === "" ? me.username! : parseUsername(rawUsername);
    const password = parsePassword(rawPassword);
    const owner = this.findByUsername(username);
    if (owner && owner.id !== me.id) throw new AuthError("that username is taken", 409);
    const profiles = this.profiles();
    profiles[me.id] = { ...me, username, passwordHash: hashPassword(password) };
    this.store.write(PROFILES, profiles);
    if (username !== me.username) this.changed(profiles[me.id]);
    return toProfile(profiles[me.id]);
  }

  /** Change your display name and/or @username. An empty name resets it to the username. */
  update(token: unknown, changes: { name?: unknown; username?: unknown }): Profile {
    const me = this.stored(token);
    const next: StoredProfile = { ...me };
    if (changes.username !== undefined) {
      const username = parseUsername(changes.username);
      if (username !== me.username) {
        const owner = this.findByUsername(username);
        if (owner && owner.id !== me.id) throw new AuthError("that username is taken", 409);
        const wait = (me.usernameChangedAt ?? -Infinity) + USERNAME_COOLDOWN_MS - this.now();
        if (wait > 0) {
          const days = Math.ceil(wait / 86_400_000);
          throw new AuthError(`you changed your username recently, you can change it again in ${days} ${days === 1 ? "day" : "days"}`, 429);
        }
        next.username = username;
        next.usernameChangedAt = this.now();
      }
    }
    if (changes.name !== undefined) {
      next.name = changes.name === "" || changes.name === null ? next.username! : parseName(changes.name);
    }
    if (next.name === me.name && next.username === me.username) return toProfile(me);
    const profiles = this.profiles();
    profiles[me.id] = next;
    this.store.write(PROFILES, profiles);
    // The old handle is free again; a stale lockout on it should not follow the new owner.
    if (next.username !== me.username) this.fails.delete(me.username!);
    this.changed(next);
    return toProfile(next);
  }

  /** Change the password. Every other signed-in device is signed out; this one stays. */
  changePassword(token: unknown, rawCurrent: unknown, rawNext: unknown): Profile {
    const me = this.stored(token);
    if (!me.passwordHash) throw new AuthError("this profile has no password yet; add one first", 409);
    const current = typeof rawCurrent === "string" ? rawCurrent : "";
    if (!checkPassword(current, me.passwordHash)) throw new AuthError("current password is wrong", 403);
    const next = parsePassword(rawNext, "new password");
    const profiles = this.profiles();
    profiles[me.id] = { ...me, passwordHash: hashPassword(next) };
    this.store.write(PROFILES, profiles);
    const keep = hashToken(token as string);
    const sessions = Object.fromEntries(Object.entries(this.sessions()).filter(([hash, id]) => id !== me.id || hash === keep));
    this.store.write(SESSIONS, sessions);
    return toProfile(profiles[me.id]);
  }

  setAvatar(token: unknown, rawAvatar: unknown): Profile {
    const me = this.stored(token);
    if (!isAvatar(rawAvatar)) throw new AuthError("unknown avatar");
    const profiles = this.profiles();
    profiles[me.id] = { ...me, avatar: rawAvatar };
    this.store.write(PROFILES, profiles);
    this.changed(profiles[me.id]);
    return toProfile(profiles[me.id]);
  }

  login(rawUsername: unknown, rawPassword: unknown): { profile: Profile; token: string } {
    const username = normalUsername(rawUsername);
    const password = typeof rawPassword === "string" ? rawPassword : "";
    const fail = this.fails.get(username);
    if (fail && fail.count >= MAX_FAILS && fail.until > this.now()) {
      throw new AuthError("too many attempts, wait a minute and try again", 429);
    }
    const stored = this.findByUsername(username);
    // Hash even for unknown names so timing does not reveal which usernames exist.
    const ok = stored?.passwordHash ? checkPassword(password, stored.passwordHash) : (hashPassword(password), false);
    if (!stored || !ok) {
      this.fails.set(username, {
        count: (fail && fail.until > this.now() ? fail.count : 0) + 1,
        until: this.now() + LOCK_MS,
      });
      throw new AuthError("wrong username or password", 401);
    }
    this.fails.delete(username);
    return { profile: toProfile(stored), token: this.newSession(stored.id) };
  }

  logout(token: unknown): void {
    if (typeof token !== "string" || !token) return;
    const { [hashToken(token)]: _gone, ...rest } = this.sessions();
    this.store.write(SESSIONS, rest);
  }

  /** Extra fields only the owner sees: whether the profile has a password (a guest does not). */
  account(id: string): { hasPassword: boolean; usernameChangeAt: number | null } {
    const stored = this.profiles()[id];
    const at = stored?.usernameChangedAt ? stored.usernameChangedAt + USERNAME_COOLDOWN_MS : 0;
    return { hasPassword: Boolean(stored?.passwordHash), usernameChangeAt: at > this.now() ? at : null };
  }

  get(id: string): Profile | null {
    const stored = this.profiles()[id.toLowerCase()];
    return stored ? toProfile(stored) : null;
  }

  byToken(token: unknown): Profile | null {
    if (typeof token !== "string" || !token) return null;
    const id = this.sessions()[hashToken(token)];
    return id ? this.get(id) : null;
  }
}

export function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

function fail(res: Response, err: unknown) {
  const status = err instanceof AuthError ? err.status : 400;
  res.status(status).json({ error: (err as Error).message });
}

export function identityRoutes(identity: Identity): Router {
  const router = Router();

  router.post("/api/signup", (req, res) => {
    try {
      res.status(201).json(identity.signup(req.body?.name, req.body, req.body?.avatar));
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/api/login", (req, res) => {
    try {
      res.json(identity.login(req.body?.username, req.body?.password));
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/api/logout", (req, res) => {
    identity.logout(bearerToken(req.headers.authorization));
    res.status(204).end();
  });

  router.post("/api/me/credentials", (req, res) => {
    try {
      const profile = identity.claim(bearerToken(req.headers.authorization), req.body?.username, req.body?.password);
      res.json({ ...profile, ...identity.account(profile.id) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.put("/api/me/avatar", (req, res) => {
    try {
      const profile = identity.setAvatar(bearerToken(req.headers.authorization), req.body?.avatar);
      res.json({ ...profile, ...identity.account(profile.id) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.patch("/api/me", (req, res) => {
    try {
      const profile = identity.update(bearerToken(req.headers.authorization), {
        name: req.body?.name,
        username: req.body?.username,
      });
      res.json({ ...profile, ...identity.account(profile.id) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/api/me/password", (req, res) => {
    try {
      const profile = identity.changePassword(bearerToken(req.headers.authorization), req.body?.current, req.body?.next);
      res.json({ ...profile, ...identity.account(profile.id) });
    } catch (err) {
      fail(res, err);
    }
  });

  const checkLimit = new RateLimiter(USERNAME_CHECK_MAX, 60_000);
  router.get("/api/usernames/:username", (req, res) => {
    if (!checkLimit.take(req.ip ?? "")) {
      res.status(429).json({ error: "too many checks, wait a minute and try again" });
      return;
    }
    const me = identity.byToken(bearerToken(req.headers.authorization));
    res.json(identity.usernameStatus(req.params.username, me?.id));
  });

  router.get("/api/me", (req, res) => {
    const profile = identity.byToken(bearerToken(req.headers.authorization));
    if (!profile) {
      res.status(401).json({ error: "invalid or missing session token" });
      return;
    }
    res.json({ ...profile, ...identity.account(profile.id) });
  });

  router.get("/api/profiles/:id", (req, res, next) => {
    if (req.params.id === "search") return next(); // served by socialRoutes
    const profile = identity.get(req.params.id);
    if (!profile) {
      res.status(404).json({ error: "profile not found" });
      return;
    }
    res.json(profile);
  });

  return router;
}
