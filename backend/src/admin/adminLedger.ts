// Pure helpers for the admin money pages: a short cache in front of the wallet log
// (the file log re-reads its whole file on every call), transaction rows with
// filters, escrow rows, and the admin views of deposits and withdrawals. Nothing
// here writes money; adminMoney.ts gathers the inputs and serves the routes.
import type { Deposit } from "../deposits";
import { PLATFORM_ACCOUNT, type Escrow, type Txn } from "../wallet";
import type { LogEntry } from "../walletLog";
import type { Withdrawal } from "../withdrawals";
import { matchesQuery, type Book, type ProfileOf } from "./adminData";

export const LOG_CACHE_MS = 5_000;

/** Reads the log at most once per `ttlMs`; every admin read of the log goes through one of these. */
export class LogCache {
  private cached: LogEntry[] | null = null;
  private readAt = 0;

  constructor(
    private readonly read: () => LogEntry[],
    private readonly now: () => number = Date.now,
    private readonly ttlMs = LOG_CACHE_MS,
  ) {}

  entries(): LogEntry[] {
    const t = this.now();
    if (this.cached === null || t - this.readAt >= this.ttlMs || t < this.readAt) {
      this.cached = this.read();
      this.readAt = t;
    }
    return this.cached;
  }
}

/** A player as money rows show them; the platform account reads as "Platform". */
export interface Who {
  id: string;
  name: string | null;
  username: string | null;
}

export function whoOf(id: string, profileOf: ProfileOf): Who {
  if (id === PLATFORM_ACCOUNT) return { id, name: "Platform", username: null };
  const p = profileOf(id);
  return { id, name: p?.name ?? null, username: p?.username ?? null };
}

/** Name or @username contains `q`, or the id starts with it (see matchesQuery); unknown ids match by id only. */
export function whoMatches(who: Who, q: string): boolean {
  return matchesQuery({ id: who.id, name: who.name ?? "", username: who.username ?? "" }, q);
}

/** The trimmed, lower-cased search text, or "" for none. */
export function queryText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** A whole number of ms from a query value, or null. */
export function msQuery(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

// ---- transactions ----

export interface TxnRow {
  /** Position in the log; null for a row read from the store. */
  seq: number | null;
  ts: number;
  book: Book;
  id: string;
  profileId: string;
  name: string | null;
  username: string | null;
  kind: string;
  amount: number;
  balance: number;
  ref: string | null;
  note: string | null;
  by: string | null;
}

/** A transaction as it was saved (log or store); only the fields the admin row uses. */
type SavedTxn = Pick<Txn, "id" | "profileId" | "amount" | "balance" | "ref" | "ts" | "note" | "by"> & { kind: string };

export function txnRow(book: Book, t: SavedTxn, seq: number | null, profileOf: ProfileOf): TxnRow {
  const who = whoOf(t.profileId, profileOf);
  return {
    seq,
    ts: t.ts,
    book,
    id: t.id,
    profileId: t.profileId,
    name: who.name,
    username: who.username,
    kind: t.kind,
    amount: t.amount,
    balance: t.balance,
    ref: t.ref,
    note: t.note ?? null,
    by: t.by ?? null,
  };
}

/** One book's transactions from the log, newest first. */
export function logTxnRows(entries: LogEntry[], book: Book, profileOf: ProfileOf): TxnRow[] {
  const out: TxnRow[] = [];
  for (const e of entries) if (e.type === "txn" && e.book === book) out.push(txnRow(book, e.txn, e.seq, profileOf));
  return out.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
}

/** One book's stored (hot) transactions, newest first; used while the log has none for the book. */
export function storeTxnRows(txns: Txn[], book: Book, profileOf: ProfileOf): TxnRow[] {
  return txns.map((t) => txnRow(book, t, null, profileOf)).reverse();
}

export interface TxnFilter {
  kinds: string[];
  profileId: string;
  from: number | null;
  to: number | null;
  q: string;
}

/** `from` and `to` are inclusive ms. `q` matches the player (name, @username, id prefix), or a txn id or ref prefix. */
export function filterTxns(rows: TxnRow[], f: TxnFilter): TxnRow[] {
  return rows.filter((r) => {
    if (f.kinds.length > 0 && !f.kinds.includes(r.kind)) return false;
    if (f.profileId && r.profileId !== f.profileId) return false;
    if (f.from !== null && r.ts < f.from) return false;
    if (f.to !== null && r.ts > f.to) return false;
    if (f.q) {
      const q = f.q.replace(/^@/, "");
      const ids = r.id.toLowerCase().startsWith(q) || (r.ref !== null && r.ref.toLowerCase().startsWith(q));
      if (!ids && !whoMatches({ id: r.profileId, name: r.name, username: r.username }, f.q)) return false;
    }
    return true;
  });
}

// ---- escrows ----

export interface EscrowRow extends Omit<Escrow, "players"> {
  book: Book;
  /** Seat order, as in the escrow (`winner` is an index into it). */
  players: Who[];
  pot: number;
  /** What the winner takes (or would take while held); 0 once refunded. */
  prize: number;
  fee: number;
}

export function escrowRow(book: Book, e: Escrow, profileOf: ProfileOf): EscrowRow {
  const pot = e.stake * 2;
  const fee = e.status === "refunded" ? 0 : Math.floor((pot * e.feeBps) / 10_000);
  return { ...e, book, players: e.players.map((id) => whoOf(id, profileOf)), pot, prize: e.status === "refunded" ? 0 : pot - fee, fee };
}

// ---- deposits and withdrawals ----

export type AdminDeposit = Omit<Deposit, "alertMessageId"> & { player: Who };
export type AdminWithdrawal = Omit<Withdrawal, "alertMessageId" | "promptMessageId" | "forcePromptMessageId" | "approval"> & {
  /** A large payout waiting for a second moderator, without the first one's Telegram id. */
  approval?: { reference: string; by: string; forced: { by: string; reason: string } | null } | null;
  player: Who;
};

/** Every deposit field except the Telegram message id, plus the player. */
export function adminDeposit(x: Deposit, profileOf: ProfileOf): AdminDeposit {
  const { alertMessageId: _alert, ...rest } = x;
  return { ...rest, player: whoOf(x.profileId, profileOf) };
}

/** Every withdrawal field except Telegram message and user ids, plus the player. */
export function adminWithdrawal(w: Withdrawal, profileOf: ProfileOf): AdminWithdrawal {
  const { alertMessageId: _a, promptMessageId: _p, forcePromptMessageId: _f, approval, ...rest } = w;
  const out: AdminWithdrawal = { ...rest, player: whoOf(w.profileId, profileOf) };
  if (approval !== undefined) out.approval = approval ? { reference: approval.reference, by: approval.by, forced: approval.forced } : null;
  return out;
}

/** Newest first; with no status filter, the ones waiting on a human (`first`) come first. */
export function orderMoney<T extends { status: string; createdAt: number; id: string }>(rows: T[], first: string | null): T[] {
  return [...rows].sort((a, b) => {
    if (first) {
      const fa = a.status === first ? 0 : 1;
      const fb = b.status === first ? 0 : 1;
      if (fa !== fb) return fa - fb;
    }
    return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
  });
}

const has = (text: string | null | undefined, q: string) => !!text && text.toLowerCase().includes(q);

/** Reference, payer or sender name, deposit id prefix, or the player. */
export function depositMatches(x: AdminDeposit, q: string): boolean {
  if (!q) return true;
  const bare = q.replace(/^@/, "");
  return has(x.reference, bare) || has(x.payerName, q) || has(x.senderName, q) || x.id.startsWith(bare) || whoMatches(x.player, q);
}

/** Account, payout reference, pay-to name, withdrawal id prefix, or the player. */
export function withdrawalMatches(w: AdminWithdrawal, q: string): boolean {
  if (!q) return true;
  const bare = q.replace(/^@/, "");
  return has(w.account, bare) || has(w.reference, bare) || has(w.payToName, q) || w.id.startsWith(bare) || whoMatches(w.player, q);
}

/** Count and sum of `amount` over rows. */
export function tally<T>(rows: T[], amount: (row: T) => number): { count: number; amount: number } {
  return { count: rows.length, amount: rows.reduce((s, r) => s + amount(r), 0) };
}
