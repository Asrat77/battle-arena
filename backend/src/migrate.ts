import dotenv from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { Client as PgClient } from "pg";

/** Applies migrations/*.sql in filename order, once each, each in its own transaction. */
export async function migrate(client: Pick<Client, "query">, dir = "migrations"): Promise<string[]> {
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name as string));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    await client.query("begin");
    try {
      await client.query(readFileSync(join(dir, file), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
    applied.push(file);
  }
  return applied;
}

async function main() {
  dotenv.config({ path: [".env.local", ".env"] });
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL), e.g. via `neon env pull`.");
  const client = new PgClient({ connectionString: url });
  await client.connect();
  try {
    const applied = await migrate(client);
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
