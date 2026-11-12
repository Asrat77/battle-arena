# AWS deploy (single EC2 instance, Kamal)

`deploy/terraform` creates the server: Ubuntu 24.04 on a t3.small with a 30 GB
gp3 disk, an Elastic IP, and a security group open on 22 (your IP), 80 and 443.
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

If writing `db.json` ever fails (disk full), the change is undone in memory
and the request fails, so balances never drift from what is on disk.
