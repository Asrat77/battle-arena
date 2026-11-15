// Admin read routes for players, matches and tournaments. Each route gathers what it
// needs from the owning modules' read-only accessors and builds rows with adminData.ts.
// Nothing here writes, and nothing returns profile secrets, session hashes, or the
// seed of a match that is still being played.
import { Router } from "express";
import { getGame } from "../../../engine/registry";
import type { Escrow } from "../wallet";
import {
  filterMatches,
  matchCounts,
  matchesQuery,
  matchRow,
  paged,
  passesFilter,
  perGame,
  pick,
  playerRef,
  sortUsers,
  stakeInfo,
  userRow,
  USER_FILTERS,
  USER_SORTS,
  type Book,
  type MatchRow,
  type ProfileOf,
} from "./adminData";
import { pageQuery, type AdminDeps } from "./adminRoutes";

const RECENT_MATCHES = 20;
const TXNS = 50;
const MONEY_ROWS = 20;

/** "1" → true, "0" → false, anything else → no filter. */
const flag = (raw: unknown): boolean | undefined => (raw === "1" ? true : raw === "0" ? false : undefined);
const text = (raw: unknown): string => (typeof raw === "string" ? raw.trim() : "");

export function adminPeopleRoutes(deps: AdminDeps): Router {
  const { identity, wallet, recorder, social, lobby, rewards, deposits, withdrawals, tournaments, matches } = deps;
  const router = Router();

  const profileOf: ProfileOf = (id) => identity.get(id);
  const gameName = (id: string) => lobby.gameList().find((g) => g.id === id)?.name ?? getGame(id)?.name ?? id;

  /** Every escrow bound to a match, both books, by match id. */
  const escrowsByMatch = () => {
    const out = new Map<string, { book: Book; escrow: Escrow }>();
    for (const book of ["play", "real"] as const) {
      for (const escrow of wallet.escrows(book)) if (escrow.matchId && !out.has(escrow.matchId)) out.set(escrow.matchId, { book, escrow });
    }
    return out;
  };

  const rowOf = (s: Parameters<typeof matchRow>[0], escrow: { book: Book; escrow: Escrow } | null): MatchRow =>
    matchRow(s, { gameName: gameName(s.record.gameId), profileOf, escrow });

  /** A live match as the admin sees it: names, spectators, room and stake, never the seed. */
  const liveRows = () =>
    lobby.liveMatches().map((m) => {
      const live = matches.get(m.matchId);
      return {
        matchId: m.matchId,
        gameId: m.gameId,
        gameName: m.gameName,
        players: m.players.map((p, seat) => {
          const isBot = live ? live.bots.includes(seat as 0 | 1) : p.profileId === "bot";
          return isBot ? { profileId: p.profileId, name: "Bot", username: null, bot: true } : playerRef(p.profileId, profileOf, false);
        }),
        bot: m.bot,
        startedAt: m.startedAt,
        spectators: m.spectators,
        room: m.room,
        moves: live?.log.length ?? 0,
        stake: stakeInfo(wallet.escrowOfMatch(m.matchId)),
      };
    });

  router.get("/api/admin/users", (req, res) => {
    const { page, limit } = pageQuery(req.query);
    const filter = pick(req.query.filter, USER_FILTERS, "all");
    const sort = pick(req.query.sort, USER_SORTS, "joined");
    const dir = pick(req.query.dir, ["asc", "desc"] as const, sort === "name" ? "asc" : "desc");
    const book = pick(req.query.book, ["real", "play"] as const, "real");
    const counts = matchCounts(recorder.all());
    const sessions = identity.sessionStats();
    const real = wallet.balancesIn("real");
    const play = wallet.balancesIn("play");
    const rows = identity
      .all()
      .filter((p) => matchesQuery(p, req.query.q))
      .map((p) =>
        userRow(p, {
          hasPassword: identity.account(p.id).hasPassword,
          status: social.presence(p.id).status,
          balance: { real: real[p.id] ?? 0, play: play[p.id] ?? 0 },
          matches: counts.get(p.id),
          lastSignInAt: sessions.get(p.id)?.lastAt,
        }),
      )
      .filter((r) => passesFilter(r, filter));
    res.json(paged(sortUsers(rows, sort, dir, book), page, limit));
  });

  router.get("/api/admin/users/:id", (req, res) => {
    const profile = identity.get(req.params.id);
    if (!profile) return res.status(404).json({ error: "player not found" });
    const id = profile.id;
    const presence = social.presence(id);
    const mine = recorder.forPlayer(id);
    const escrows = escrowsByMatch();
    const r = rewards.player(id);
    res.json({
      profile,
      account: identity.account(id),
      status: presence.status,
      matchId: presence.matchId,
      balances: { real: wallet.balanceIn("real", id), play: wallet.balanceIn("play", id) },
      withdrawable: wallet.withdrawable(id),
      depositPayer: deposits.payer(id),
      rewards: { points: r.points, tokens: r.tokens, overall: r.overall, games: r.games, streak: r.streak, badges: r.badges },
      perGame: perGame(mine, id),
      matches: mine.length,
      recentMatches: mine.slice(0, RECENT_MATCHES).map((s) => rowOf(s, escrows.get(s.record.matchId) ?? null)),
      txns: { real: wallet.historyIn("real", id, TXNS), play: wallet.historyIn("play", id, TXNS) },
      deposits: deposits.forAdmin(id, MONEY_ROWS),
      withdrawals: withdrawals.forAdmin(id, MONEY_ROWS),
      friendCount: social.friendCount(id),
      openSessions: identity.sessionStats().get(id)?.open ?? 0,
    });
  });

  router.get("/api/admin/matches", (req, res) => {
    const { page, limit } = pageQuery(req.query);
    const escrows = escrowsByMatch();
    const found = filterMatches(
      recorder.all(),
      {
        game: text(req.query.game) || undefined,
        player: text(req.query.player).toLowerCase() || undefined,
        staked: flag(req.query.staked),
        bot: flag(req.query.bot),
      },
      new Set(escrows.keys()),
    );
    const one = paged(found, page, limit);
    res.json({ rows: one.rows.map((s) => rowOf(s, escrows.get(s.record.matchId) ?? null)), total: one.total });
  });

  router.get("/api/admin/matches/live", (_req, res) => {
    res.json({ rows: liveRows() });
  });

  router.get("/api/admin/matches/:id", (req, res) => {
    const id = req.params.id;
    const stored = recorder.get(id);
    if (stored) {
      const escrow = wallet.escrowOfMatch(id);
      return res.json({
        ...rowOf(stored, escrow),
        commitIndex: stored.commitIndex,
        resultIndex: stored.resultIndex,
        resultHash: stored.resultHash,
        escrow: escrow ? { book: escrow.book, ...escrow.escrow } : null,
        replay: `/replay/${encodeURIComponent(id)}`,
      });
    }
    const live = liveRows().find((m) => m.matchId === id);
    if (live) return res.json({ live: true, ...live });
    res.status(404).json({ error: "match not found" });
  });

  router.get("/api/admin/tournaments", (req, res) => {
    const { page, limit } = pageQuery(req.query);
    const who = (e: { id: string; name: string; bot: boolean } | null) => (e ? { id: e.id, name: e.name, bot: e.bot } : null);
    const rows = tournaments.adminList().map((t) => {
      const host = t.host ? identity.get(t.host) : null;
      return {
        id: t.id,
        name: t.name,
        gameId: t.gameId,
        gameName: t.gameName,
        size: t.size,
        bestOf: t.bestOf,
        visibility: t.visibility,
        status: t.state,
        host: t.host ? { id: t.host, name: host?.name ?? null } : null,
        players: t.entrants.length,
        bots: t.entrants.filter((e) => e.bot).length,
        createdAt: t.createdAt,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        champion: t.state === "finished" ? who(t.champion) : null,
        link: t.link,
      };
    });
    res.json(paged(rows, page, limit));
  });

  return router;
}
