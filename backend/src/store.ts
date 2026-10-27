import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Small key/value store. Each module keeps its data under its own key.
export interface Store {
  read<T>(key: string, fallback: T): T;
  write<T>(key: string, value: T): void;
}

export class MemoryStore implements Store {
  protected data: Record<string, unknown> = {};

  read<T>(key: string, fallback: T): T {
    return key in this.data ? (this.data[key] as T) : fallback;
  }

  write<T>(key: string, value: T): void {
    this.data[key] = value;
  }
}

// In-memory store mirrored to a JSON file on every write. Writes go to a temp
// file first and are renamed into place, so a crash never leaves half a file.
export class FileStore extends MemoryStore {
  constructor(private readonly path: string) {
    super();
    if (existsSync(path)) {
      this.data = JSON.parse(readFileSync(path, "utf8"));
    }
  }

  write<T>(key: string, value: T): void {
    super.write(key, value);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.path);
  }
}
