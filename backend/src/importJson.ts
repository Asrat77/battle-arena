import dotenv from "dotenv";
import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { Client } from "pg";

export interface ImportResult {
  keys: number;
  mismatches: string[];
  /** True when the transaction was rolled back (--dry-run). */
  rolledBack: boolean;
}

/**
 * Upsert every top-level key of a FileStore db.json into the kv table inside ONE transaction,
 * then read them all back and compare (key count, and deep equality of every value).
 * With dryRun the transaction is rolled back after that check, so nothing is kept.
 * Idempotent: re-running bumps `version` but leaves the data the same.
 * Any mismatch rolls the whole import back.
 */
export async function importJson(
  client: Pick<Client, "query">,
  data: Record<string, unknown>,
  opts: { dryRun?: boolean; table?: string } = {},
): Promise<ImportResult> {
  const table = opts.table ?? "kv";
  const keys = Object.keys(data);
  // What the database will hold: JSON round-trip (drops undefined, normalises like jsonb will).
  const expected = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const mismatches: string[] = [];
  await client.query("begin");
  try {
    await client.query(
      `insert into ${table} (key, value)
       select k, v::jsonb from unnest($1::text[], $2::text[]) as t(k, v)
       on conflict (key) do update
         set value = excluded.value, version = ${table}.version + 1, updated_at = now()`,
      [keys, keys.map((k) => JSON.stringify(data[k]))],
    );
    const { rows } = await client.query(`select key, value from ${table}`);
    const got = new Map<string, unknown>(rows.map((r) => [r.key as string, r.value]));
    if (got.size !== keys.length) mismatches.push(`key count: file has ${keys.length}, table has ${got.size}`);
    for (const k of keys) {
      if (!got.has(k)) mismatches.push(`missing key: ${k}`);
      else if (!isDeepStrictEqual(got.get(k), expected[k])) mismatches.push(`value differs: ${k}`);
    }
    for (const k of got.keys()) if (!(k in expected)) mismatches.push(`unexpected key in table: ${k}`);
    const rollback = opts.dryRun || mismatches.length > 0;
    await client.query(rollback ? "rollback" : "commit");
    return { keys: keys.length, mismatches, rolledBack: rollback };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
}

async function main() {
  dotenv.config({ path: [".env.local", ".env"] });
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) throw new Error("usage: npm run import:json -- <db.json> [--dry-run]");
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL).");
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${path} is not a JSON object`);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const res = await importJson(client, data, { dryRun });
    for (const m of res.mismatches) console.error(`MISMATCH: ${m}`);
    if (res.mismatches.length) {
      console.error(`import FAILED and was rolled back (${res.mismatches.length} problems)`);
      process.exit(1);
    }
    console.log(
      res.rolledBack
        ? `dry run OK: ${res.keys} keys imported and verified, then rolled back (nothing saved)`
        : `import OK: ${res.keys} keys imported and verified`,
    );
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
