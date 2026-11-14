import { Pool } from "pg";

// Postgres (Neon). The app uses the pooled DATABASE_URL; migrations use the
// direct DATABASE_URL_UNPOOLED connection (DDL does not belong behind a pooler).
export type Db = Pick<Pool, "query" | "end">;

export function createPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  // An idle client dying (Neon scales to zero) must not crash the process.
  pool.on("error", (err) => console.error("postgres pool error:", err.message));
  return pool;
}

/** The app's pool, or null when DATABASE_URL is unset (file/memory store only). */
export function dbFromEnv(): Pool | null {
  const url = process.env.DATABASE_URL;
  return url ? createPool(url) : null;
}

/** "ok" when a trivial query succeeds within the timeout, else "error". */
export async function checkDb(db: Db, timeoutMs = 3000): Promise<"ok" | "error"> {
  try {
    await Promise.race([
      db.query("select 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs).unref()),
    ]);
    return "ok";
  } catch (err) {
    console.error("database health check failed:", (err as Error).message);
    return "error";
  }
}
