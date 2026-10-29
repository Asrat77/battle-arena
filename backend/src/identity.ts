import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { Router, type Response } from "express";
import { sha256Hex } from "../../engine/hash";
import type { Store } from "./store";

export interface Profile {
  id: string; // EVM-style address, 0x + 40 hex
  name: string;
  createdAt: number;
}

interface StoredProfile extends Profile {
  publicKey: string;
  privateKey: string; // custodial: the server holds the key, no wallet needed
  username?: string; // sign-in handle, lowercase; set when the profile is claimed
  passwordHash?: string; // scrypt, `salt:hash` hex
}

const PROFILES = "profiles";
const SESSIONS = "sessions"; // sha256(token) -> profile id

export const NAME_MAX = 24;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const USERNAME = /^[a-z0-9_]{3,20}$/;

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

function parseCredentials(rawUsername: unknown, rawPassword: unknown): { username: string; password: string } {
  const username = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";
  if (!USERNAME.test(username)) throw new AuthError("username must be 3 to 20 letters, numbers or underscores");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new AuthError(`password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`);
  }
  return { username, password };
}

export function addressFromPublicKey(publicKey: Uint8Array): string {
  const uncompressed = secp256k1.ProjectivePoint.fromHex(publicKey).toRawBytes(false);
  return `0x${bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20))}`;
}

function hashToken(token: string): string {
  return sha256Hex(token);
}

function toProfile({ id, name, createdAt }: StoredProfile): Profile {
  return { id, name, createdAt };
}

export class Identity {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

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

  signup(rawName: unknown, credentials?: { username?: unknown; password?: unknown }): { profile: Profile; token: string } {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name || name.length > NAME_MAX) {
      throw new Error(`name must be 1 to ${NAME_MAX} characters`);
    }

    const creds =
      credentials?.username || credentials?.password ? parseCredentials(credentials.username, credentials.password) : null;
    if (creds && this.findByUsername(creds.username)) throw new AuthError("that username is taken", 409);

    const privateKey = secp256k1.utils.randomPrivateKey();
    const publicKey = secp256k1.getPublicKey(privateKey);
    const stored: StoredProfile = {
      id: addressFromPublicKey(publicKey),
      name,
      createdAt: this.now(),
      publicKey: bytesToHex(publicKey),
      privateKey: bytesToHex(privateKey),
      ...(creds && {
        username: creds.username,
        passwordHash: hashPassword(creds.password),
      }),
    };

    this.store.write(PROFILES, { ...this.profiles(), [stored.id]: stored });
    return { profile: toProfile(stored), token: this.newSession(stored.id) };
  }

  /** Give a guest profile a username and password so it can be signed into again. */
  claim(token: unknown, rawUsername: unknown, rawPassword: unknown): Profile {
    const me = this.byToken(token);
    if (!me) throw new AuthError("invalid or missing session token", 401);
    const profiles = this.profiles();
    if (profiles[me.id].passwordHash) throw new AuthError("this profile already has a password", 409);
    const { username, password } = parseCredentials(rawUsername, rawPassword);
    if (this.findByUsername(username)) throw new AuthError("that username is taken", 409);
    profiles[me.id] = {
      ...profiles[me.id],
      username,
      passwordHash: hashPassword(password),
    };
    this.store.write(PROFILES, profiles);
    return toProfile(profiles[me.id]);
  }

  login(rawUsername: unknown, rawPassword: unknown): { profile: Profile; token: string } {
    const username = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";
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

  /** The signed-in view of a profile: includes the sign-in username, if it has one. */
  account(id: string): { username: string | null } {
    return { username: this.profiles()[id]?.username ?? null };
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
      res.status(201).json(identity.signup(req.body?.name, req.body));
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

  router.get("/api/me", (req, res) => {
    const profile = identity.byToken(bearerToken(req.headers.authorization));
    if (!profile) {
      res.status(401).json({ error: "invalid or missing session token" });
      return;
    }
    res.json({ ...profile, ...identity.account(profile.id) });
  });

  router.get("/api/profiles/:id", (req, res) => {
    const profile = identity.get(req.params.id);
    if (!profile) {
      res.status(404).json({ error: "profile not found" });
      return;
    }
    res.json(profile);
  });

  return router;
}
