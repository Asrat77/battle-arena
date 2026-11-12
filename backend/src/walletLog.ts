// Append-only, hash-chained record of every wallet balance change (audit M1).
//
// Each line holds one entry and the hash of the entry before it, so editing,
// dropping or reordering a past line breaks the chain from that point on. The
// wallet appends after each saved change; reconcile() in wallet.ts replays the
// log and compares it with the balances in db.json, which shows any balance
// changed outside the wallet (a hand-edited db.json) or a change that was
// never logged.
//
// The log is the full history. The wallet's own store keeps only recent game
// transactions per player (audit L2); older ones live here.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type LogBook = "play" | "real";

export interface LogTxn {
  id: string;
  profileId: string;
  kind: string;
  amount: number;
  balance: number;
  ref: string | null;
  ts: number;
  /** Why, for a manual adjustment. */
  note?: string;
  /** Who, for a manual adjustment. */
  by?: string;
}

export type LogBody =
  /** Balances when the log started (or after a wipe): replay starts from here. */
  | { type: "open"; book: LogBook; balances: Record<string, number> }
  | { type: "txn"; book: LogBook; txn: LogTxn };

export type LogEntry = LogBody & { seq: number; ts: number; prev: string; hash: string };

export const GENESIS = "0".repeat(64);

export function entryHash(prev: string, e: Omit<LogEntry, "prev" | "hash">): string {
  const { seq, ts, ...body } = e;
  return createHash("sha256").update(prev).update(JSON.stringify({ seq, ts, body })).digest("hex");
}

/** Where the chain first breaks, or null when every entry links to the one before. */
export function verifyChain(entries: LogEntry[]): { at: number; reason: string } | null {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return { at: i, reason: `entry ${i} has seq ${e.seq}` };
    if (e.prev !== prev) return { at: i, reason: `entry ${i} does not link to entry ${i - 1}` };
    const { prev: _p, hash, ...rest } = e;
    if (entryHash(prev, rest) !== hash) return { at: i, reason: `entry ${i} was changed after it was written` };
    prev = hash;
  }
  return null;
}

export interface TxnLog {
  append(body: LogBody, ts: number): LogEntry;
  entries(): LogEntry[];
  /** True when nothing has been written yet. */
  empty(): boolean;
}

abstract class ChainedLog implements TxnLog {
  protected seq = 0;
  protected prev = GENESIS;

  append(body: LogBody, ts: number): LogEntry {
    const base = { ...body, seq: this.seq, ts } as Omit<LogEntry, "prev" | "hash">;
    const entry = { ...base, prev: this.prev, hash: entryHash(this.prev, base) } as LogEntry;
    this.write(entry);
    this.seq++;
    this.prev = entry.hash;
    return entry;
  }

  empty(): boolean {
    return this.seq === 0;
  }

  protected abstract write(entry: LogEntry): void;
  abstract entries(): LogEntry[];
}

export class MemoryTxnLog extends ChainedLog {
  private list: LogEntry[] = [];

  protected write(entry: LogEntry) {
    this.list.push(entry);
  }

  entries(): LogEntry[] {
    return this.list;
  }
}

/** One JSON entry per line, only ever appended to. */
export class FileTxnLog extends ChainedLog {
  constructor(private readonly path: string) {
    super();
    const all = this.entries();
    const last = all.findLast((e) => e.seq >= 0);
    if (last) {
      this.seq = last.seq + 1;
      this.prev = last.hash;
    }
    const broken = verifyChain(all);
    if (broken) console.error(`wallet log ${path}: chain broken at ${broken.at}: ${broken.reason}`);
  }

  protected write(entry: LogEntry) {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }

  entries(): LogEntry[] {
    if (!existsSync(this.path)) return [];
    const out: LogEntry[] = [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // A line cut short by a crash mid-append; verifyChain reports the gap.
        out.push({ seq: -1, ts: 0, type: "open", book: "play", balances: {}, prev: "", hash: "" });
      }
    }
    return out;
  }
}
