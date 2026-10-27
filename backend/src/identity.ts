import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { Router } from "express";
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
}

const PROFILES = "profiles";
const SESSIONS = "sessions"; // sha256(token) -> profile id

export const NAME_MAX = 24;

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

  signup(rawName: unknown): { profile: Profile; token: string } {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name || name.length > NAME_MAX) {
      throw new Error(`name must be 1 to ${NAME_MAX} characters`);
    }

    const privateKey = secp256k1.utils.randomPrivateKey();
    const publicKey = secp256k1.getPublicKey(privateKey);
    const stored: StoredProfile = {
      id: addressFromPublicKey(publicKey),
      name,
      createdAt: this.now(),
      publicKey: bytesToHex(publicKey),
      privateKey: bytesToHex(privateKey),
    };
    const token = randomBytes(32).toString("hex");

    this.store.write(PROFILES, { ...this.profiles(), [stored.id]: stored });
    this.store.write(SESSIONS, { ...this.sessions(), [hashToken(token)]: stored.id });
    return { profile: toProfile(stored), token };
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

export function identityRoutes(identity: Identity): Router {
  const router = Router();

  router.post("/api/signup", (req, res) => {
    try {
      res.status(201).json(identity.signup(req.body?.name));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get("/api/me", (req, res) => {
    const profile = identity.byToken(bearerToken(req.headers.authorization));
    if (!profile) {
      res.status(401).json({ error: "invalid or missing session token" });
      return;
    }
    res.json(profile);
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
