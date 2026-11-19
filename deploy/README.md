# AWS deploy (single EC2 instance, Kamal)

`deploy/terraform` creates the server: Ubuntu 24.04 on a t3.small with a 30 GB
gp3 disk, a separate 20 GB data volume for the Docker volumes, an Elastic IP,
and a security group open on 80 and 443 only. SSH goes over Tailscale (see
"Server access and data volume" below).
Its state is local and gitignored. The instance's disk holds the data of every
app on it, so Terraform must never replace it: `aws_instance.web` ignores
changes to the startup script and to the AMI, and has `prevent_destroy`. A plan
that would destroy the server now fails instead of running.

The AMI comes from Canonical's "current Ubuntu 24.04" SSM parameter, which
moves with every Ubuntu release. Before the AMI was ignored, that made any
later apply replace the server: on 2026-11-10 an apply meant only to update
`ssh_cidr` terminated it and deleted both apps' data. To move to a newer image
on purpose, back up first, then build a new server and restore onto it.

Always read the plan before applying, and stop if it says "must be replaced".

Kamal (`config/deploy.yml`) builds the image on the server, pushes it to
`ghcr.io/asrat77/battle-arena`, and runs two roles behind kamal-proxy, which
terminates HTTPS:

- `web`: Next.js on `https://34.252.38.138.sslip.io`
- `api`: the Node server on `https://api.34.252.38.138.sslip.io`

The proxy routes by host name, so other apps can share the server. Bunna
Passport runs there too.

## Deploy

Once: copy `.kamal/secrets.example` to `.kamal/secrets` and fill in
`LEDGER_PRIVATE_KEY`. It must never change, or the ledger's signatures stop
verifying. Install Kamal with `gem install kamal`. Docker must run locally for
the registry login.

Staked-match settings (`WALLET_MODE`, `VERIFY_ET_KEY`, `DEPOSIT_*`,
`TELEGRAM_*`) live in `.env.local`; the lines in `.kamal/secrets.example` read
them from there at deploy time, so there is one copy. After changing one, run
`kamal env push` and `kamal app boot -r api` (or a full `kamal deploy`).

```sh
export KAMAL_REGISTRY_PASSWORD=$(gh auth token)   # needs write:packages
kamal deploy
```

### Automatic deploys

`.github/workflows/deploy.yml` deploys `main` after CI (`.github/workflows/ci.yml`:
lint, test, build) passes on it. The runner joins the tailnet as an ephemeral
node tagged `tag:ci`, which may reach only `100.85.9.76:22`; port 22 stays closed
to the internet. It builds the image on the runner, runs `npm run migrate`
against Neon, then `kamal deploy`, and checks `/` and `/health`. A failure pings
`TELEGRAM_MODERATOR_CHAT`. `.kamal/hooks/pre-deploy` runs
`battle-arena-backup-offsite` on the server before every deploy, from the Mac
too; skip it with `ARENA_SKIP_PREDEPLOY_BACKUP=1`.

Manual deploy or rollback: Actions → Deploy → Run workflow (`rollback` takes the
commit SHA of a release; `kamal app versions` lists them). Deploying from the
Mac still works as before.

One-time setup. The Tailscale `tag:ci` policy rule, the OAuth client and the
`~/.ssh/deploy-ci` key are shared with bunna-passport (see its
docs/OPERATIONS.md, "Automatic deploys"). Then:

1. https://github.com/users/Asrat77/packages/container/battle-arena/settings →
   Manage Actions access → add `battle-arena` with the **Write** role.
2. From this folder on the Mac:

   ```sh
   R=Asrat77/battle-arena
   gh secret set TS_OAUTH_CLIENT_ID -R $R      # paste, Enter
   gh secret set TS_OAUTH_SECRET -R $R         # paste, Enter
   gh secret set DEPLOY_SSH_KEY -R $R < ~/.ssh/deploy-ci
   gh secret set DEPLOY_SSH_KNOWN_HOSTS -R $R -b "$(ssh-keyscan -t ed25519 100.85.9.76 2>/dev/null)"
   KAMAL_REGISTRY_PASSWORD=x kamal secrets print | while IFS='=' read -r k v; do
     case "$k" in
       LEDGER_PRIVATE_KEY|WALLET_MODE|VERIFY_ET_KEY|DEPOSIT_TELEBIRR|DEPOSIT_CBE|TELEGRAM_BOT_TOKEN|TELEGRAM_MODERATOR_CHAT|DATABASE_URL|DATABASE_URL_UNPOOLED|STORE|REAL_MONEY_LEGAL_OK|ADMIN_TOKEN)
         gh secret set "$k" -R $R -b "$v" ;;
     esac
   done
   gh secret list -R $R    # expect 16 names
   ```

### Database (Neon Postgres)

The Neon project is linked by `neon.ts`. `neon deploy` (or `neon env pull`)
writes `DATABASE_URL` (pooled, used by the app) and `DATABASE_URL_UNPOOLED`
(direct, used by migrations) into `.env.local`. The secrets file reads both
from there, like the other settings. Apply schema changes with:

```sh
npm run migrate    # runs migrations/*.sql once each, in order
```

`/health` on the API reports `"database": "ok"` or `"error"` when
`DATABASE_URL` is set (and `pendingWrites` when Postgres is the store). The api
keeps its data in `db.json` unless `STORE=postgres` is also set, which moves it
to the Postgres `kv` table; having `DATABASE_URL` alone changes nothing about
where data lives. `STORE` is not in `config/deploy.yml` yet. Moving existing
data over: see `deploy/neon-cutover.md`.

### Real money stays off by default

`WALLET_MODE=real` alone does nothing: the server also needs
`REAL_MONEY_LEGAL_OK=1`, which should be set only once real-money play is
legally cleared (betting licence, age/KYC checks, terms). Without it the api
logs a warning and runs play money. `REAL_MONEY_LEGAL_OK` is deliberately not in
`config/deploy.yml` yet; to turn real money on, add it to `.env.local`, to
`.kamal/secrets` (same `$(grep ...)` line as the others) and to the `secret:`
list in `config/deploy.yml`, then deploy.

Play and real balances live in separate books (`wallet:play`, `wallet:real` in
`db.json`). The first boot after this change moves the old shared book to play
money, because it mixed faucet birr with real deposits. Real money it held is
listed under `walletLegacyReport` in `db.json` (and in the boot log) so those
players can be refunded by hand.

Kamal builds from the last commit, so commit first. Check with
`https://api.34.252.38.138.sslip.io/health`, and see logs with
`kamal app logs -r api`.

Data (profiles, ledger, wallets) lives in the `battle-arena_arena-data` Docker
volume on the instance's disk, mounted at `/data`. It survives deploys and
restarts, not a terminated instance. The api copies `db.json` into
`/data/backups/` on every boot and then hourly, keeping the newest 72 copies
(three days). Those copies share the server's disk, so also copy the newest
one off the server now and then:

```sh
ssh ubuntu@34.252.38.138 'sudo sh -c "ls -t /var/lib/docker/volumes/battle-arena_arena-data/_data/backups/*.json | head -1 | xargs cat"' > db-backup.json
```

### Wallet records

Every balance change is also appended to `/data/wallet-log.jsonl`, each line
hash-linked to the one before, so a changed or deleted line is detectable. Back
it up with `db.json` and never edit it. With `ADMIN_TOKEN` set (it is a secret
in `config/deploy.yml`, filled from `.kamal/secrets`):

```sh
H="X-Admin-Token: $ADMIN_TOKEN"; API=https://api.34.252.38.138.sslip.io
curl -H "$H" $API/api/admin/wallet/reconcile        # ok:false lists balances that differ from the log
curl -H "$H" "$API/api/admin/wallet/fees?book=real"  # platform fees per day and what was taken out
# A manual credit (or a debit with a negative amount; "platform" takes fees out). Amounts in santim.
curl -H "$H" -H 'content-type: application/json' -d '{"book":"real","profileId":"0x...","amount":10000,"reason":"deposit 123 approved by hand","by":"asrat"}' $API/api/admin/wallet/adjust
```

Use the adjust route instead of editing `db.json` by hand: a hand edit shows up
as a mismatch in reconcile. The wallet keeps only each player's newest 200 game
transactions in `db.json`; the log keeps them all.

If writing `db.json` ever fails (disk full), the change is undone in memory
and the request fails, so balances never drift from what is on disk.

## Admin site

The admin site lives at `https://34.252.38.138.sslip.io/admin` (the web app). It
reads and changes data through the API's `/api/admin/*` routes. Nothing here is
deployed by the code change that added it: it goes live with the next `kamal deploy`.

**How sign-in works.** An admin opens `/admin/login`, types their name and the
`ADMIN_TOKEN` once, and the web server (not the browser) sends it to the API. The
API answers with a random session id that lives in its memory for 12 hours. The
web server keeps that id in an httpOnly, same-site-strict cookie (`ba_admin`,
path `/admin`) and calls the API for the browser through `/admin/api/*`. The token
is never stored, logged, put in a URL or sent to the browser; `ADMIN_TOKEN` is not
in the browser bundle. Sessions are in memory, so every API restart (a deploy,
a crash) signs all admins out. Sign-ins and sign-outs are in the audit log.

**Setting it up.**
- `ADMIN_TOKEN` must be set on the API and be at least 24 characters. If it is
  unset or shorter, every `/api/admin/*` route answers 404 as if it did not exist.
  Make one with `openssl rand -base64 36`.
- The web container needs no new environment: it already has `NEXT_PUBLIC_API_URL`
  (baked into the image) and uses it to reach the API. `ADMIN_API_URL` is optional
  and only for pointing the web server at an internal API address.

**Sign-in limit.** 10 wrong tokens in 15 minutes from one address lock sign-in
with a 429 until the window passes or the API restarts. All sign-ins reach the API
from the web server, so they share one address: 10 wrong tries by anyone lock
every admin out for up to 15 minutes. Restarting the API clears it (and signs
everyone out anyway).

**Rotating `ADMIN_TOKEN`.**
1. Put the new value in `.kamal/secrets` (or wherever `ADMIN_TOKEN` comes from).
2. Run `kamal deploy` (this version has no `env push`; a deploy uploads the env).
3. The API restart ends every old session, and the old token stops working.
   Admins sign in again with the new one. Do this after the token has been
   printed or pasted anywhere it should not be.

**What the site can change.** Almost everything is read-only: players, matches,
tournaments, activity, wallet, withdrawals, reconcile, audit log, system health.
Withdrawals are read-only on purpose: payouts stay in Telegram with its checks.
Two things can be written, both recorded in the audit log with who did it:
- a manual wallet adjustment (the Adjust dialog on the wallet and player pages,
  same as `POST /api/admin/wallet/adjust` above; needs a note);
- approving or rejecting a deposit that is in review.

The browser may only make those two writes (the web server refuses any other
write), and both need the site's own Origin and an `X-Admin-CSRF` header.
There are no bans or password resets.

## Server access and data volume

Added after the 2026-11-10 incident. Three things protect the server now:

- **Data volume.** Every Docker volume (both apps' data, kamal-proxy's config)
  lives on `aws_ebs_volume.data`, bind-mounted at `/var/lib/docker/volumes`,
  so paths inside the containers and in the backup scripts did not change.
  The volume has `prevent_destroy` and is not deleted with the instance; a
  rebuilt server's first-boot script mounts it again. Docker refuses to start
  if it is not mounted, so the apps never come up on empty volumes.
- **Nightly snapshots.** A Data Lifecycle Manager policy snapshots the data
  volume and the root disk at 01:00 UTC and keeps 14 days. They stay in this
  AWS account; the encrypted age+rclone backups to R2 cover losing the account.
- **No public SSH.** Port 22 is closed to the internet. SSH goes over
  Tailscale with the usual key. If Tailscale ever breaks, Session Manager still
  opens a shell with no open port:
  `aws ssm start-session --target $(terraform output -raw instance_id)`
  (needs `brew install --cask session-manager-plugin`). For a one-off, an apply
  with `-var ssh_cidr=<your ip>/32` opens 22 to one address again.

### One-time setup, in this order

1. **Tailscale on the server** (port 22 is still open at this point):

   ```sh
   ssh -i ~/.ssh/battle-arena ubuntu@34.252.38.138
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up --hostname=battle-arena   # open the URL it prints, sign in
   tailscale ip -4                              # note the 100.x.y.z address
   ```

   In the Tailscale admin console (Machines, battle-arena, the ... menu), choose
   **Disable key expiry**, or the server drops off the tailnet in 180 days.
   Install Tailscale on the Mac (`brew install --cask tailscale`), sign in to
   the same account, and check `ssh -i ~/.ssh/battle-arena ubuntu@100.x.y.z`
   works. Do not go on until it does.

2. **Point Kamal at the Tailscale address.** Done: `config/deploy.yml` uses
   the server's Tailscale IP `100.85.9.76` for `hosts:` and `builder.remote`
   (the `proxy.host` lines keep the public names). Bunna reads
   `BUNNA_DEPLOY_HOST` from its `.env.deploy`.

3. **Terraform.** Read the plan before applying:

   ```sh
   cd deploy/terraform
   terraform plan -out=harden.plan
   ```

   Expect `8 to add, 2 to change, 0 to destroy`: the data volume and its
   attachment, the snapshot policy and its role, the Session Manager role and
   instance profile; in place, the instance (instance profile, root disk tags)
   and the security group (SSH rule removed). **Stop if any line says "must be
   replaced" or the destroy count is not 0.** Then:

   ```sh
   terraform apply harden.plan
   ```

   An `AccessDenied` on the IAM or DLM resources means the deploy user cannot
   create roles: run the same two commands with an admin profile
   (`AWS_PROFILE=...`).

4. **Move the Docker volumes** (both apps down for about a minute; pick a quiet
   time, not 00:10 to 00:30 UTC when the backups run):

   ```sh
   VOL=$(terraform output -raw data_volume_id)
   cd ../..
   ssh -i ~/.ssh/battle-arena ubuntu@100.x.y.z "sudo bash -s $VOL" < deploy/move-volumes-to-ebs.sh
   ```

   If anything fails after Docker stops, the script puts the old volumes back
   and starts Docker again. Then check both apps (`/health` here, `/up` on
   Bunna), and `sudo reboot` once at a quiet time to prove the mounts come back
   on boot. After a week: `sudo rm -rf /var/lib/docker/volumes.pre-ebs`.

