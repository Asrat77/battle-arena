// Who did what as admin, and when. Kept in the store (key `adminAudit`, newest 2000)
// so it survives restarts. Secrets never go in: the admin token and session ids are
// not passed here, and any text that still contains the token is redacted on write.
import { randomBytes } from "node:crypto";
import type { Store } from "../store";

export const AUDIT_KEY = "adminAudit";
export const AUDIT_KEEP = 2000;
export const AUDIT_PAGE_MAX = 200;

export type AdminAction = "signin" | "signin-failed" | "signout" | "wallet-adjust" | "deposit-resolve";
export type AuditDetail = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  id: string;
  ts: number;
  /** The name typed at sign-in, or "token" for a raw X-Admin-Token caller. */
  actor: string;
  action: AdminAction;
  target?: string;
  detail?: AuditDetail;
  ip?: string;
}

export interface AuditInput {
  actor: string;
  action: AdminAction;
  target?: string;
  detail?: AuditDetail;
  ip?: string;
}

export class AdminAudit {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
    /** Current admin token, only used to scrub it from anything written. */
    private readonly secret: () => string | undefined = () => undefined,
  ) {}

  add(input: AuditInput): AuditEntry {
    const entry: AuditEntry = { id: randomBytes(8).toString("hex"), ts: this.now(), actor: this.clean(input.actor), action: input.action };
    if (input.target !== undefined) entry.target = this.clean(input.target);
    if (input.detail) entry.detail = Object.fromEntries(Object.entries(input.detail).map(([k, v]) => [k, typeof v === "string" ? this.clean(v) : v]));
    if (input.ip) entry.ip = input.ip;
    const all = this.store.read<AuditEntry[]>(AUDIT_KEY, []);
    this.store.write(AUDIT_KEY, [...all, entry].slice(-AUDIT_KEEP));
    return entry;
  }

  /** Newest first. `limit` is clamped to 1..200. */
  page(page = 0, limit = 50): { rows: AuditEntry[]; total: number } {
    const all = this.store.read<AuditEntry[]>(AUDIT_KEY, []);
    const size = Math.min(AUDIT_PAGE_MAX, Math.max(1, Math.floor(limit) || 50));
    const from = Math.max(0, Math.floor(page) || 0) * size;
    const newest = [...all].reverse();
    return { rows: newest.slice(from, from + size), total: all.length };
  }

  private clean(text: string): string {
    const s = this.secret();
    return s && s.length >= 8 ? text.split(s).join("[redacted]") : text;
  }
}
