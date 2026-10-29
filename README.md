# Battle Arena

Live 1v1 games in the browser where the server is the referee and every finished match is written to a signed, hash-chained ledger that anyone can check by replaying it.

**The idea:** a game is just a rules file plus a board. Matchmaking, rooms, sync, spectating, replay, chat, rewards and the ledger are shared, so new games reuse the same infrastructure. Three games run on it today.

## Try it in five minutes (one person, one device)

1. Open the app and enter a name. A profile ID (an EVM-style address) is created for you. No wallet, no gas.
2. Quick match **Crack the Code**. Nobody else is queued, so accept the bot after 10 seconds.
3. Play to the end. Both secret codes are revealed, and the match shows as *pending*, then *recorded*.
4. Open the replay, step through it, and press **Verify**. The result hash, the committed secrets and the whole ledger chain are re-checked in your browser.
5. Open your profile for the new points, the match history and any badges. The leaderboard is unchanged, because bot matches earn no rank.
6. Play **Gebeta** or **Tic-Tac-Toe** the same way. With a second device or browser you can play a human, create a private room and share its link, or spectate with live chat.
7. Open **Ledger** to see every block, its signature and the chain check.

## Approach and decisions

### Why a platform, not one game

Spectating, replay, the result hash, rewards and the leaderboard all come from one thing: a match's ordered move log. So a game only has to define its rules (`engine/types.ts`): how to set up, which moves are legal, what a move does, when the match ends, and what each seat and a spectator may see. A new game adds rules in `engine/games/`, a registry entry, a board adapter, display metadata in `lib/gameCatalog.ts`, and rules copy. The three games prove the point:

| Game | Proves | Hidden information | Commitment |
| --- | --- | --- | --- |
| Crack the Code | simultaneous rounds, hidden secrets | each player's secret code | hash of secret + salt, revealed at the end |
| Gebeta (mancala) | turn-based play, extra turns, captures | none | none |
| Tic-Tac-Toe | three-board series, alternating openers, timed board transitions | none | none |

### Tic-Tac-Toe

A match is up to three 3×3 boards. Three in a row wins a board and earns one point. Drawn boards count toward the limit and award no points. A series ends early when the other player cannot catch up; otherwise the higher score after three boards wins, with equal scores drawing the match.

Seat 0 opens the first board. Players alternate who opens and uses X; seat identities stay the same. Turns last 30 seconds; a timeout plays the first empty square in row order. Between boards, the finished grid stays visible for three seconds before the next board starts automatically. Moves and board transitions are logged, so the entire series can be replayed and verified. Leaving forfeits the whole series.

The bot plays optimally 85% of the time and picks a weaker legal move when available the remaining 15%. Rewards and ratings apply once per series. Explorer now requires finishing all three games; existing badges are retained. Tournaments reuse the shared drawn-match policy (two rematches, then a seeded coin flip).

### Why a rewrite

This started as a Crack the Code prototype that trusted the browser: both secret codes reached both clients and clients declared their own wins. Recording that on a chain would only have made forged results permanent. So the rebuild follows one rule: **the server is the referee**. Clients send moves, never state. The server validates every move, computes every result, and sends each seat only its own view. Spectators see no hidden information until the match ends, and bots only ever see their own view.

### What the ledger does and does not do

Matches produce result blocks, plus commit blocks for games with hidden information:

- a **commit** block before play, holding the hash of each hidden secret plus a salt;
- a **result** block after play, holding the match ID, winner, timestamp and `resultHash`, which is the sha256 of the match's canonical JSON (players, seed, full move log, outcome).

Badges and token mints get their own blocks, so every reward traces to a recorded match. Blocks are signed with secp256k1 by the server and linked by hash, so editing any past block breaks every later one. The chain is simulated on the server (a testnet was not worth the risk for the demo), and sealing happens in the background so gameplay never waits on it.

**Verify** (`engine/verify.ts`) runs in the browser and does not trust the server's say-so. It replays the log from the seed, recomputes the outcome and hash, compares them with the result block, opens the commitments against the revealed secrets, and walks the chain checking every hash, link and signature.

We claim exactly this: results are **tamper-evident and checkable**. We do not claim trustless play. The server runs the matches, so it is trusted to referee, and the ledger proves only that a recorded result was never changed and matches its replay.

### Where cryptography earns its place

In Crack the Code the server answers every guess, so a dishonest server could cheat by changing a secret after the fact. Publishing `hash(secret + salt)` before round one prevents that: at the end both secrets are revealed and Verify checks every feedback ever given against them. Determinism does the rest. All randomness comes from a seeded RNG recorded in the match, so a replay is exact.

### Rewards

Points are awarded only when a match is recorded: win 10, draw 5, loss 2, any bot result 1, tournament win 30 bonus, first match of the day 3 bonus. Badges (First Blood, Codebreaker, Seed Master, On a Roll, Explorer, Champion, Watcher) and a token balance are derived from the same records. Bot matches earn reduced points and no rank. The same two players earn at most 3 rated matches against each other in 24 hours.

### Prior art

We looked at boardgame.io and Colyseus. Both are good, but both bring their own state-sync model, and we needed three things they don't give us for free: per-seat views that hide information from spectators and network traffic, a move log that is the source of truth for replay and hashing, and engine code that runs unchanged in the browser to verify results. A thin layer of our own (`engine/`, about a thousand lines) fit better.

### Known limits

- **Custodial profile IDs.** The server holds each profile's key so players need no wallet. There is no cross-device recovery and no self-custody yet.
- **Multi-account farming.** The per-pair limit stops casual farming, but one person with several accounts could still farm slowly.
- **Simulated ledger.** It is tamper-evident but run by one operator; a public testnet would remove that single point.
- **Server-trusted play,** as above.
- **Storage** is a JSON file (`DATA_FILE`), which is fine for a demo but not for scale.

### Direction

Grid games are close to configurations of a single rules file, which is the first step toward a no-code game creator. Next steps are Liar's Dice with committed seeds, wallet connect, and larger tournaments.

## What's in it

- **Games**: Crack the Code, Gebeta and Tic-Tac-Toe, each with a bot so you can play alone.
- **Play**: quick match with bot fallback, private rooms with invite links, spectating with room chat and reactions, rematches.
- **Profiles**: wallet-free signup, points, badges, a leaderboard and token rewards, plus friends and presence.
- **Tournaments**: 4-player single elimination, created by the server with bots filling empty seats.
- **Verify**: replay any finished match and check it against the ledger.

## Layout

- `engine/` shared game engine, rules, bots, replay, hashing, ledger blocks and verification. Used by both server and browser.
- `backend/src/` Express + socket.io server: identity, lobby, matches, recorder, ledger, rewards, social, tournaments.
- `app/`, `components/`, `lib/` Next.js frontend.

## Run locally

```bash
npm ci
npm run server   # API + sockets on :3001
npm run dev      # web app on :3000
npm test         # node:test suite
```

Open http://localhost:3000. With no configuration the server generates a ledger key on first run and keeps it in the data file.

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `LEDGER_PRIVATE_KEY` | server | Hex secp256k1 key that signs ledger blocks. Set it in production so the key survives a lost data file. |
| `FRONTEND_URL` | server | Allowed CORS origin, default `http://localhost:3000` |
| `PORT` | server | Server port, default `3001` |
| `DATA_FILE` | server | Where profiles and the ledger are stored, default `data/db.json` |
| `NEXT_PUBLIC_API_URL` | web | Server URL, default `http://localhost:3001` |
| `NEXT_PUBLIC_SOCKET_URL` | web | Older name for `NEXT_PUBLIC_API_URL`, still read as a fallback |

## Deploy

- **Server** (e.g. Render web service): build `npm ci`, start `npm run server`. Set `LEDGER_PRIVATE_KEY` and `FRONTEND_URL` (the frontend's origin). Mount a persistent disk and point `DATA_FILE` at it, otherwise profiles and the ledger reset on every deploy.
- **Frontend** (e.g. Vercel): set `NEXT_PUBLIC_API_URL` to the server's URL and deploy.
- Health check: `GET /health`.
