import type { Db } from "./db";
import { MemoryStore } from "./store";

export interface PgStoreOptions {
  /** Table holding the documents. Default "kv"; tests pass "<throwaway schema>.kv". */
  table?: string;
  /** First retry delay after a failed write, doubling up to maxBackoffMs. Default 500 ms. */
  backoffMs?: number;
  maxBackoffMs?: number;
  log?: (msg: string, err?: unknown) => void;
}

export interface PgStoreStatus {
  /** Keys written in memory but not yet committed to Postgres. */
  pendingWrites: number;
  /** The last write error while writes are failing; null once a write has succeeded. */
  lastError: string | null;
}

const TABLE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

/**
 * The same synchronous Store the app already uses, persisted to the Postgres `kv` table.
 *
 * - The whole key/value set is loaded at boot (`PgStore.open`); reads are served from memory.
 * - write()/remove() change memory at once and queue the change. The value is serialised at
 *   call time, so later in-place edits by the caller are not half-saved.
 * - One worker commits the queue in order. All keys queued at that moment go in one
 *   statement (atomic); several writes to a key between commits collapse to the last one.
 * - A failed commit is logged, kept queued and retried with backoff; status() shows it.
 * - `flush()` waits until the queue is empty. Call it before exit: whatever is still queued
 *   when the process dies (kill -9) is lost, nothing older than that is.
 */
export class PgStore extends MemoryStore {
  /** key -> serialised JSON, or null for a delete. Insertion order is not significant: last write wins. */
  private pending = new Map<string, string | null>();
  private working = false;
  private lastError: string | null = null;
  private wake: (() => void) | null = null;
  private idleWaiters: Array<() => void> = [];
  private readonly table: string;
  private readonly backoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly log: (msg: string, err?: unknown) => void;
  private inFlight = 0;

  private constructor(
    private readonly db: Db,
    data: Record<string, unknown>,
    opts: PgStoreOptions,
  ) {
    super();
    this.data = data;
    this.table = opts.table ?? "kv";
    if (!TABLE.test(this.table)) throw new Error(`invalid table name: ${this.table}`);
    this.backoffMs = opts.backoffMs ?? 500;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.log = opts.log ?? ((msg, err) => console.error(msg, err ?? ""));
  }

  static async open(db: Db, opts: PgStoreOptions = {}): Promise<PgStore> {
    const table = opts.table ?? "kv";
    if (!TABLE.test(table)) throw new Error(`invalid table name: ${table}`);
    const { rows } = await db.query(`select key, value from ${table}`);
    const data: Record<string, unknown> = {};
    for (const r of rows) data[r.key as string] = r.value;
    return new PgStore(db, data, opts);
  }

  write<T>(key: string, value: T): void {
    // Memory keeps the caller's own object (modules hold references and edit them in place);
    // the queue gets a snapshot taken now.
    super.write(key, value);
    this.pending.set(key, JSON.stringify(value) ?? null);
    this.kick();
  }

  remove(key: string): void {
    super.remove(key);
    this.pending.set(key, null);
    this.kick();
  }

  /** How many keys were loaded or written (0 on a fresh, never-imported database). */
  keyCount(): number {
    return Object.keys(this.data).length;
  }

  status(): PgStoreStatus {
    return { pendingWrites: this.pending.size + this.inFlight, lastError: this.lastError };
  }

  /**
   * Resolves true once everything written so far is committed. With `timeoutMs`, resolves
   * false if that did not happen in time (it is still retrying). A retry waiting out its
   * backoff is run at once, so a shutdown flush does not sit through the delay.
   */
  async flush(timeoutMs?: number): Promise<boolean> {
    if (this.pending.size === 0 && !this.working) return true;
    this.wake?.();
    const idle = new Promise<boolean>((resolve) => this.idleWaiters.push(() => resolve(true)));
    if (timeoutMs === undefined) return idle;
    let timer: NodeJS.Timeout;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([idle, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private kick(): void {
    if (this.working) return;
    this.working = true;
    // Next microtask, not now: writes made in the same synchronous call (e.g. signup saves the
    // profile and the session) land in one batch, so a crash never keeps half of them.
    queueMicrotask(() => void this.run());
  }

  private async run(): Promise<void> {
    let delay = this.backoffMs;
    while (this.pending.size > 0) {
      const batch = this.pending;
      this.pending = new Map();
      this.inFlight = batch.size;
      try {
        await this.commit(batch);
        this.inFlight = 0;
        if (this.lastError) this.log("store: Postgres writes recovered");
        this.lastError = null;
        delay = this.backoffMs;
      } catch (err) {
        this.inFlight = 0;
        // Put the batch back underneath anything written meanwhile (newer wins) and retry.
        for (const [k, v] of batch) if (!this.pending.has(k)) this.pending.set(k, v);
        this.lastError = (err as Error).message;
        this.log(`store: WRITE TO POSTGRES FAILED (${this.pending.size} keys unsaved, retrying in ${delay} ms)`, err);
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, delay);
          t.unref(); // a test (or a dead process) must not be kept alive only by a retry timer
          this.wake = () => {
            clearTimeout(t);
            resolve();
          };
        });
        this.wake = null;
        delay = Math.min(delay * 2, this.maxBackoffMs);
      }
    }
    this.working = false;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  private async commit(batch: Map<string, string | null>): Promise<void> {
    const keys: string[] = [];
    const values: string[] = [];
    const removed: string[] = [];
    for (const [k, v] of batch) {
      if (v === null) removed.push(k);
      else {
        keys.push(k);
        values.push(v);
      }
    }
    // One statement, so a batch is all-or-nothing.
    await this.db.query(
      `with del as (delete from ${this.table} where key = any($3::text[]))
       insert into ${this.table} (key, value)
       select k, v::jsonb from unnest($1::text[], $2::text[]) as t(k, v)
       on conflict (key) do update
         set value = excluded.value, version = ${this.table}.version + 1, updated_at = now()`,
      [keys, values, removed],
    );
  }
}

/**
 * Which store the server uses. Postgres only when STORE=postgres is set on purpose: merely
 * having DATABASE_URL (it is in the Kamal secrets already) must never switch production
 * onto a database that has not been imported.
 */
export function storeKindFromEnv(env: Record<string, string | undefined>): "file" | "postgres" {
  const store = (env.STORE ?? "").trim().toLowerCase();
  if (store === "" || store === "file") return "file";
  if (store !== "postgres") throw new Error(`STORE must be "file" or "postgres", got "${env.STORE}"`);
  if (!env.DATABASE_URL) throw new Error("STORE=postgres needs DATABASE_URL");
  return "postgres";
}
