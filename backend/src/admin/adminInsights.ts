// Admin insight routes: the overview (live numbers, totals, KPIs with change vs the
// previous period, a zero-filled daily series, matches by game), the merged activity
// feed, and the system page (counts and booleans only, never a secret). The maths is in
// analytics.ts and the feed rows in adminActivity.ts; this file gathers the inputs from
// the modules' read-only accessors and shares the wallet log cache with the money routes.
import { Router } from "express";
import { getGame } from "../../../engine/registry";
import { checkDb } from "../db";
import { BOT_PLAYER } from "../lobby";
import { PgStore } from "../pgStore";
import { FileStore } from "../store";
import { PLATFORM_ACCOUNT } from "../wallet";
import { verifyChain } from "../walletLog";
import {
  adjustRows,
  adminRows,
  depositRows,
  matchRows,
  mergeFeed,
  parseTypes,
  signupRows,
  tournamentRows,
  withdrawalRows,
  type ActivityRow,
} from "./adminActivity";
import type { AdminAudit } from "./adminAudit";
import type { AdminAuth } from "./adminAuth";
import { matchRow, paged, pick, type Book, type ProfileOf } from "./adminData";
import { logTxnRows, storeTxnRows, type LogCache } from "./adminLedger";
import { pageQuery, type AdminDeps } from "./adminRoutes";
import { buildKpis, buildSeries, byGame, clampInt, DEFAULT_DAYS, DEFAULT_TZ, MAX_DAYS, rangeOf, type MatchEvent, type Stamped } from "./analytics";

/** Profile lookups, remembered for one request. */
const lookups = (deps: AdminDeps): ProfileOf => {
  const seen = new Map<string, ReturnType<ProfileOf>>();
  return (id) => {
    if (!seen.has(id)) seen.set(id, deps.identity.get(id));
    return seen.get(id)!;
  };
};

export function adminInsightRoutes(deps: AdminDeps, audit: AdminAudit, auth: AdminAuth, log: LogCache): Router {
  const { wallet, identity, deposits, withdrawals, recorder, lobby, tournaments, ledger, io, store } = deps;
  const now = deps.now ?? Date.now;
  const router = Router();

  const gameName = (id: string) => lobby.gameList().find((g) => g.id === id)?.name ?? getGame(id)?.name ?? id;
  const bookOf = (raw: unknown): Book => pick(raw, ["real", "play"] as const, wallet.mode);

  /** Every escrow bound to a match, both books, by match id. */
  const escrowsByMatch = () => {
    const out = new Map<string, { book: Book; escrow: ReturnType<typeof wallet.escrows>[number] }>();
    for (const book of ["play", "real"] as const) {
      for (const escrow of wallet.escrows(book)) if (escrow.matchId && !out.has(escrow.matchId)) out.set(escrow.matchId, { book, escrow });
    }
    return out;
  };

  /** Distinct profiles with an open socket. */
  const onlineIds = (): Set<string> => {
    const ids = new Set<string>();
    for (const s of io.of("/").sockets.values()) if (typeof s.data.profileId === "string") ids.add(s.data.profileId);
    return ids;
  };

  /**
   * One book's money events. Source rule: when the wallet log holds any txn for the book,
   * fees are the log's "fee" txns on the platform account and stake volume is the log's
   * "hold" txns (one per player, so both stakes of an escrow). Otherwise (the log began
   * after the book's history, or is empty) fees come from the stored transactions and stake
   * volume is 2 x stake of each escrow at its createdAt. Stored game txns are trimmed per
   * profile, so the log is the complete source whenever it has data.
   */
  const bookMoney = (book: Book): { source: "log" | "store"; stakes: Stamped[]; fees: Stamped[] } => {
    const txns = log.entries().flatMap((e) => (e.type === "txn" && e.book === book ? [e.txn] : []));
    if (txns.length > 0) {
      return {
        source: "log",
        stakes: txns.filter((t) => t.kind === "hold").map((t) => ({ ts: t.ts, amount: -t.amount })),
        fees: txns.filter((t) => t.kind === "fee" && t.profileId === PLATFORM_ACCOUNT).map((t) => ({ ts: t.ts, amount: t.amount })),
      };
    }
    return {
      source: "store",
      stakes: wallet.escrows(book).map((e) => ({ ts: e.createdAt, amount: e.stake * 2 })),
      fees: wallet.txnsIn(book).filter((t) => t.kind === "fee" && t.profileId === PLATFORM_ACCOUNT).map((t) => ({ ts: t.ts, amount: t.amount })),
    };
  };

  router.get("/api/admin/overview", (req, res) => {
    const days = clampInt(req.query.days, 1, MAX_DAYS, DEFAULT_DAYS);
    const tz = clampInt(req.query.tz, -720, 840, DEFAULT_TZ);
    const book = bookOf(req.query.book);
    const range = rangeOf(now(), days, tz);
    const escrows = escrowsByMatch();
    const stored = recorder.all();
    const profiles = identity.all();

    const matches: MatchEvent[] = stored.map(({ record: r }) => ({
      gameId: r.gameId,
      endedAt: r.endedAt,
      humans: [...new Set(r.players.filter((p) => p !== BOT_PLAYER))],
      bot: r.bot,
      staked: escrows.has(r.matchId),
    }));
    const money = bookMoney(book);
    const real = book === "real";
    const credited: Stamped[] = real
      ? deposits.all().filter((d) => d.status === "credited").map((d) => ({ ts: d.closedAt ?? d.createdAt, amount: d.amount ?? 0 }))
      : [];
    const paid: Stamped[] = real
      ? withdrawals.all().filter((w) => w.status === "paid").map((w) => ({ ts: w.closedAt ?? w.createdAt, amount: w.amount }))
      : [];
    const input = { profiles, matches, stakes: money.stakes, fees: money.fees, deposits: credited, withdrawals: paid };

    const online = onlineIds();
    const inMatch = [...online].filter((id) => deps.social.presence(id).status === "in-match").length;
    const pendingW = withdrawals.all().filter((w) => w.status === "pending");
    const review = deposits.all().filter((d) => d.status === "review");
    const recordedIds = new Set(stored.map((s) => s.record.matchId));

    res.json({
      range: { days, from: range.from, to: range.to, tz },
      book,
      now: {
        online: online.size,
        inMatch,
        liveMatches: lobby.liveMatches().length,
        queued: lobby.gameList().reduce((n, g) => n + g.queue, 0),
        pendingWithdrawals: { count: pendingW.length, amount: pendingW.reduce((s, w) => s + w.amount, 0) },
        depositsInReview: { count: review.length, amount: review.reduce((s, d) => s + (d.reviewAmount ?? 0), 0) },
        pendingWrites: store instanceof PgStore ? store.status().pendingWrites : 0,
      },
      totals: {
        players: profiles.length,
        registered: profiles.filter((p) => identity.account(p.id).hasPassword).length,
        guests: profiles.filter((p) => !identity.account(p.id).hasPassword).length,
        matches: stored.length,
        stakedMatches: [...escrows.keys()].filter((id) => recordedIds.has(id)).length,
        tournaments: tournaments.adminList().length,
      },
      kpis: buildKpis({ ...input, range }),
      series: buildSeries({ ...input, range }),
      byGame: byGame(matches, range.from, range.to, gameName),
    });
  });

  router.get("/api/admin/activity", (req, res) => {
    const { page, limit } = pageQuery(req.query);
    const want = parseTypes(req.query.type);
    const profileOf = lookups(deps);
    const parts: ActivityRow[][] = [];
    if (want.has("signup")) parts.push(signupRows(identity.all()));
    if (want.has("match")) {
      const escrows = escrowsByMatch();
      parts.push(matchRows(recorder.all().map((s) => matchRow(s, { gameName: gameName(s.record.gameId), profileOf, escrow: escrows.get(s.record.matchId) ?? null }))));
    }
    if (want.has("deposit")) parts.push(depositRows(deposits.all(), profileOf));
    if (want.has("withdrawal")) parts.push(withdrawalRows(withdrawals.all(), profileOf));
    if (want.has("adjust")) {
      // Per book: the log's adjust txns when the log has any txn for the book, else the stored ones.
      for (const book of ["real", "play"] as const) {
        const fromLog = logTxnRows(log.entries(), book, profileOf);
        parts.push(adjustRows(fromLog.length > 0 ? fromLog : storeTxnRows(wallet.txnsIn(book), book, profileOf)));
      }
    }
    if (want.has("tournament")) parts.push(tournamentRows(tournaments.adminList(), profileOf));
    if (want.has("admin")) parts.push(adminRows(audit.all()));
    res.json(paged(mergeFeed(parts), page, limit));
  });

  router.get("/api/admin/system", async (_req, res) => {
    const pg = store instanceof PgStore ? store.status() : null;
    const database = !deps.db ? "none" : pg?.lastError ? "error" : await checkDb(deps.db);
    const entries = log.entries();
    const broken = verifyChain(entries);
    const budget = deps.verifyBudget;
    const finite = (n: number) => (Number.isFinite(n) ? n : null);
    const tg = deps.telegram ?? { configured: false, moderatorChat: false, moderators: 0 };
    res.json({
      time: now(),
      uptimeMs: Math.round(process.uptime() * 1000),
      node: process.version,
      store: { kind: pg ? "postgres" : store instanceof FileStore ? "file" : "memory", pendingWrites: pg?.pendingWrites ?? 0, lastError: pg?.lastError ?? null },
      database,
      wallet: {
        mode: wallet.mode,
        config: wallet.config(),
        logEntries: entries.length,
        chain: broken ? { at: broken.at, reason: broken.reason } : "intact",
      },
      ledger: { blocks: ledger.blocks().length, pending: ledger.pendingCount() },
      verifyBudget: budget ? { used: budget.used(), limits: { daily: finite(budget.limits.daily), monthly: finite(budget.limits.monthly) } } : null,
      telegram: { configured: tg.configured, moderatorChat: tg.moderatorChat, moderators: tg.moderators },
      deposits: { enabled: deposits.enabled, accounts: deposits.accounts().length },
      withdrawals: withdrawals.config(),
      admin: { liveSessions: auth.liveSessions(), auditEntries: audit.page(0, 1).total },
      counts: {
        profiles: identity.all().length,
        matches: recorder.all().length,
        deposits: deposits.all().length,
        withdrawals: withdrawals.all().length,
        tournaments: tournaments.adminList().length,
        liveMatches: lobby.liveMatches().length,
        sockets: io.of("/").sockets.size,
      },
    });
  });

  return router;
}
