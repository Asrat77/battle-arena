import { existsSync, statSync } from "node:fs";
import { createApp } from "./app";
import { dbFromEnv } from "./db";
import { PgStore, storeKindFromEnv } from "./pgStore";
import { installProcessGuards } from "./safe";

installProcessGuards();

async function main() {
  const PORT = Number(process.env.PORT) || 3001;
  // The JSON file store is the default. STORE=postgres (plus DATABASE_URL) opts into Neon.
  // Rollback: unset STORE. DATABASE_URL alone only turns on the /health database check.
  const kind = storeKindFromEnv(process.env);
  const db = dbFromEnv();
  const store = kind === "postgres" && db ? await PgStore.open(db) : undefined;
  if (store && store.keyCount() === 0) {
    // An empty kv table next to a populated db.json means the import was skipped: starting
    // would look like every account vanished, and the first write would start a new history.
    const file = process.env.DATA_FILE || "data/db.json";
    if (existsSync(file) && statSync(file).size > 2 && process.env.ALLOW_EMPTY_KV !== "1")
      throw new Error(`Postgres kv table is empty but ${file} has data: run "npm run import:json -- ${file}" first (or set ALLOW_EMPTY_KV=1 to start fresh)`);
  }
  console.log(store ? "Store: Postgres" : "Store: JSON file");
  const { httpServer, withdrawals } = createApp({ store, db });
  // Telegram button taps and replies from moderators (no-op unless withdrawals are on).
  withdrawals.start();

  httpServer.listen(PORT, () => {
    console.log(`Battle Arena server listening on ${PORT}`);
  });

  // Save what is queued before exiting, so a deploy or restart loses nothing.
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: flushing writes`);
    httpServer.close();
    let code = 0;
    if (store) {
      const saved = await store.flush(10_000);
      if (!saved) {
        console.error(`store: SHUT DOWN WITH ${store.status().pendingWrites} UNSAVED KEYS`);
        code = 1;
      }
    }
    await db?.end().catch(() => {});
    process.exit(code);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("startup failed:", err);
  process.exit(1);
});
