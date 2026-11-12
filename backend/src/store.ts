import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// Small key/value store. Each module keeps its data under its own key.
export interface Store {
  read<T>(key: string, fallback: T): T;
  write<T>(key: string, value: T): void;
  remove(key: string): void;
}

export class MemoryStore implements Store {
  protected data: Record<string, unknown> = {};

  read<T>(key: string, fallback: T): T {
    return key in this.data ? (this.data[key] as T) : fallback;
  }

  write<T>(key: string, value: T): void {
    this.data[key] = value;
  }

  remove(key: string): void {
    delete this.data[key];
  }
}

export interface FileStoreOptions {
  /** Where backup copies go. Default: a `backups` folder beside the data file. */
  backupDir?: string;
  /** How often a write also takes a backup copy. Default 1 hour; 0 turns backups off. */
  backupEveryMs?: number;
  /** How many backup copies to keep (oldest go first). Default 72. */
  keepBackups?: number;
  now?: () => number;
  /** Test hook: replaces the file write, so a failing disk can be simulated. */
  writeFile?: (path: string, text: string) => void;
}

export const BACKUP_EVERY_MS = 60 * 60 * 1000;
export const KEEP_BACKUPS = 72;

// In-memory store mirrored to a JSON file on every write. Writes go to a temp
// file first and are renamed into place, so a crash never leaves half a file.
//
// A write only counts once it is on disk: if the file write fails, memory is
// rolled back to the last state that was saved and the write throws, so memory
// and disk never disagree (audit M2). Callers usually change the object they
// read in place before calling write(); the rollback replaces it too.
//
// Every `backupEveryMs` (and once on boot) the file is copied into `backupDir`,
// keeping the newest `keepBackups` copies. Copy them off the server too: they
// share its disk.
export class FileStore extends MemoryStore {
  private lastSaved: string;
  private lastBackup = 0;
  private readonly backupDir: string;
  private readonly backupEveryMs: number;
  private readonly keepBackups: number;
  private readonly now: () => number;
  private readonly writeFile: (path: string, text: string) => void;

  constructor(
    private readonly path: string,
    opts: FileStoreOptions = {},
  ) {
    super();
    this.backupDir = opts.backupDir ?? join(dirname(path), "backups");
    this.backupEveryMs = opts.backupEveryMs ?? BACKUP_EVERY_MS;
    this.keepBackups = Math.max(1, opts.keepBackups ?? KEEP_BACKUPS);
    this.now = opts.now ?? Date.now;
    this.writeFile = opts.writeFile ?? ((p, text) => writeFileSync(p, text));
    this.lastSaved = existsSync(path) ? readFileSync(path, "utf8") : "{}";
    this.data = JSON.parse(this.lastSaved);
    if (existsSync(path)) this.backup();
  }

  write<T>(key: string, value: T): void {
    super.write(key, value);
    this.flush();
  }

  remove(key: string): void {
    super.remove(key);
    this.flush();
  }

  private flush(): void {
    try {
      const text = JSON.stringify(this.data);
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      this.writeFile(tmp, text);
      renameSync(tmp, this.path);
      this.lastSaved = text;
    } catch (err) {
      this.data = JSON.parse(this.lastSaved);
      console.error(`store: write to ${this.path} failed, memory rolled back to the last saved state`, err);
      throw err;
    }
    if (this.backupEveryMs > 0 && this.now() - this.lastBackup >= this.backupEveryMs) this.backup();
  }

  /** Copy the data file into the backup folder and drop the oldest copies. Never throws. */
  backup(): string | null {
    if (this.backupEveryMs <= 0) return null;
    this.lastBackup = this.now();
    try {
      mkdirSync(this.backupDir, { recursive: true });
      const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, "-");
      const name = basename(this.path).replace(/\.json$/, "");
      const to = join(this.backupDir, `${name}-${stamp}.json`);
      copyFileSync(this.path, to);
      const old = readdirSync(this.backupDir)
        .filter((f) => f.startsWith(`${name}-`) && f.endsWith(".json"))
        .sort();
      for (const f of old.slice(0, Math.max(0, old.length - this.keepBackups))) unlinkSync(join(this.backupDir, f));
      return to;
    } catch (err) {
      console.error("store: backup failed", err);
      return null;
    }
  }
}
