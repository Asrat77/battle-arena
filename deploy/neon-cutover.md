# Cutover: JSON file store -> Neon Postgres

Moves profiles, sessions, wallets, the ledger and the rest of `db.json` into the
Neon `kv` table. **Rehearsed on a Neon branch only; this has not been run in
production.** Do it in a quiet hour: there is a short write freeze.

What moves and what does not:

- `db.json` (every top-level key: `profiles`, `sessions`, `wallet:play`,
  `wallet:real`, `ledgerKey`, ...) moves to `kv`.
- `wallet-log.jsonl` **stays a file** in `/data` on the server for now. Keep the
  `/data` volume mounted; the api still appends to it.
- `/data/backups/` (FileStore backups) stop being written once Postgres is the
  store. Neon's point-in-time restore replaces them; see "After" below.

How the app picks its store: **`db.json` (`FileStore`) is the default.** Postgres
(`PgStore`) is used only when `STORE=postgres` is set (and `DATABASE_URL` too).
`DATABASE_URL` alone, which is already an api secret in `config/deploy.yml`,
only turns on the database check in `/health`; it does not move the data. So a
normal `kamal deploy` is safe before the cutover. `STORE` is deliberately not in
`config/deploy.yml` yet: it is added in step 5 and removed again to roll back.
If `STORE=postgres` is set while `kv` is empty and `/data/db.json` has data, the
api refuses to start (set `ALLOW_EMPTY_KV=1` to override): the safety net for
importing late.

Writes are acknowledged before Postgres confirms them (memory first, saved in
the background, usually within tens of ms). A SIGTERM (deploy, restart) flushes
first. A crash (`kill -9`, power loss) can lose only that last unsaved moment,
and all keys written in one request are saved together or not at all.

## 0. Before you start (on your Mac)

```sh
git pull                      # on main, with the PgStore change merged
neon env pull                 # .env.local now has DATABASE_URL + DATABASE_URL_UNPOOLED (production branch)
npm run migrate               # kv table exists (already applied by #114; prints "up to date")
psql "$DATABASE_URL_UNPOOLED" -Atc 'select count(*) from kv'   # must be 0 before the import
```

## 1. Back up, off the server

```sh
H=ubuntu@34.252.38.138; V=/var/lib/docker/volumes/battle-arena_arena-data/_data
mkdir -p cutover-backup && cd cutover-backup
ssh $H "sudo cat $V/db.json" > db.json
ssh $H "sudo cat $V/wallet-log.jsonl" > wallet-log.jsonl   # may not exist on an older deploy: that is fine
ssh $H "sudo sh -c 'ls -t $V/backups/*.json $V/db.backup-*.json 2>/dev/null | head -1 | xargs -r cat'" > newest-backup.json
shasum -a 256 db.json wallet-log.jsonl > SHA256SUMS
cd ..
```

Keep these files until the cutover has been fine for a week.

## 2. Dry run against the real data (no changes saved)

```sh
npm run import:json -- cutover-backup/db.json --dry-run
```

It imports inside one transaction, reads every key back, compares values, then
rolls back. Expect `dry run OK: N keys imported and verified, then rolled back`.
Any `MISMATCH` line or a non-zero exit: stop and ask.

## 3. Freeze writes and take the final copy

Players keep playing while step 1 was running, so copy again with no writes in
flight. Stop the api (the web container can stay up; the site just shows
errors for a minute):

```sh
kamal app stop -r api
ssh $H "sudo cat $V/db.json" > cutover-backup/db.final.json
ssh $H "sudo cat $V/wallet-log.jsonl" > cutover-backup/wallet-log.final.jsonl   # skip if absent
```

## 4. Import for real

```sh
npm run import:json -- cutover-backup/db.final.json
```

Expect `import OK: N keys imported and verified`. (Run from the Mac with the
direct URL from `.env.local`. Re-running is safe: it overwrites with the same
data.) If it fails nothing was saved; restart the old api with
`kamal app start -r api` (still the file store: `STORE` is not set yet) and stop.

## 5. Switch on Postgres and deploy

In `config/deploy.yml`, under the api `env:` -> `clear:` block, add
`STORE: postgres`, and commit that change (Kamal builds from the last commit).

```sh
git status                    # clean
export KAMAL_REGISTRY_PASSWORD=$(gh auth token)
kamal env push
kamal deploy
```

The new api container starts on Postgres and logs `Store: Postgres`.

## 6. Smoke test

```sh
API=https://api.34.252.38.138.sslip.io
curl -s $API/health      # {"ok":true,"database":"ok","pendingWrites":0}
kamal app logs -r api | grep "Store:"     # Store: Postgres
```

Then in the browser: sign in with an existing account (balance and history
there), sign up a new account, play a match against the bot, and check
`$API/api/ledger` still verifies (the block count only goes up). With
`ADMIN_TOKEN` set: `curl -H "X-Admin-Token: $ADMIN_TOKEN" $API/api/admin/wallet/reconcile`
should say `ok:true`. Restart once (`kamal app boot -r api`) and confirm the new
account and the match are still there.

## Rollback

Up to the first smoke-test write, the file is still the truth: remove
`STORE: postgres` from `config/deploy.yml`, commit, `kamal deploy`. The api is
back on `/data/db.json`. `/data` stays mounted throughout.

After players have written to Postgres, rolling back loses those changes
unless you export them first (ask before doing that; the file would need to be
regenerated from `kv`).

## After

- `/health` shows `database` and `pendingWrites`. `"database":"error"` means
  writes are failing and being retried (the api logs `WRITE TO POSTGRES FAILED`).
- Neon keeps history for point-in-time restore (see the project's restore window
  in the Neon console); that replaces `/data/backups`.
- Rolling restarts: Kamal sends SIGTERM and the api flushes up to 10 s of
  queued writes before exiting.
