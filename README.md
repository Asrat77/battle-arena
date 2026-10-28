# Battle Arena

Live 1v1 games in the browser where the server is the referee and every finished match is written to a signed, hash-chained ledger that anyone can verify by replaying it.

## What's in it

- **Games**: Crack the Code (guess the hidden number) and Gebeta (mancala), each with a bot so you can play alone.
- **Play**: quick match with bot fallback, private rooms, spectating with room chat, and 4-player single-elimination tournaments.
- **Profiles**: wallet-free signup with a local keypair, points, badges, a leaderboard and token rewards, plus friends and presence.
- **Verify**: every match record holds its moves and seed, so the replay page re-runs the game and checks the result and ledger signature.

## Layout

- `engine/` shared game engine, rules, bots, replay and verification (used by both server and browser)
- `backend/src/` Express + socket.io server: identity, lobby, matches, ledger, rewards, social, tournaments
- `app/`, `components/`, `lib/` Next.js frontend

## Run locally

```bash
npm ci
npm run server   # API + sockets on :3001
npm run dev      # web app on :3000
npm test         # node:test suite
```

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `LEDGER_PRIVATE_KEY` | server | Key that signs ledger entries (set this in production) |
| `FRONTEND_URL` | server | Allowed CORS origin, default `http://localhost:3000` |
| `PORT` | server | Server port, default `3001` |
| `DATA_FILE` | server | Where profiles and the ledger are stored |
| `NEXT_PUBLIC_API_URL` | web | Server URL, default `http://localhost:3001` |
| `NEXT_PUBLIC_SOCKET_URL` | web | Older name for `NEXT_PUBLIC_API_URL`, still read as a fallback |

## Deploy

Server (e.g. Render): build `npm ci`, start `npm run server`, set `LEDGER_PRIVATE_KEY` and `FRONTEND_URL`. Frontend (e.g. Vercel): set `NEXT_PUBLIC_API_URL` to the server URL.
