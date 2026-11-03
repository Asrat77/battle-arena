# AWS deploy (single EC2 instance, Kamal)

`deploy/terraform` creates the server: Ubuntu 24.04 on a t3.small with a 30 GB
gp3 disk, an Elastic IP, and a security group open on 22 (your IP), 80 and 443.
Its state is local and gitignored. Changing the startup script no longer
replaces the instance, because the instance's disk holds the data.

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

```sh
export KAMAL_REGISTRY_PASSWORD=$(gh auth token)   # needs write:packages
kamal deploy
```

Kamal builds from the last commit, so commit first. Check with
`https://api.34.252.38.138.sslip.io/health`, and see logs with
`kamal app logs -r api`.

Data (profiles, ledger) lives in the `battle-arena_arena-data` Docker volume
on the instance's disk, mounted at `/data`. It survives deploys and restarts,
not a terminated instance, so copy `db.json` off the server now and then.
