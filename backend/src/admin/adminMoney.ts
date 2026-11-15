// Admin money routes: wallet summary, transactions from the hash-chained log, escrows,
// deposits and withdrawals (read only), and one write: approve or reject a deposit in
// review, the same as the Telegram buttons. Withdrawals stay in Telegram on purpose.
// The wallet log is read through one short cache (LogCache) because the file log
// re-reads its whole file; nothing here changes how money is written or logged.
import { Router } from "express";
import { MIN_DEPOSIT, type DepositStatus } from "../deposits";
import { PLATFORM_ACCOUNT } from "../wallet";
import type { WithdrawalStatus } from "../withdrawals";
import type { AdminAudit } from "./adminAudit";
import { actorOf, adminCaller } from "./adminAuth";
import { paged, pick, type Book, type ProfileOf } from "./adminData";
import {
  adminDeposit,
  adminWithdrawal,
  depositMatches,
  escrowRow,
  filterTxns,
  type LogCache,
  logTxnRows,
  msQuery,
  orderMoney,
  queryText,
  storeTxnRows,
  tally,
  withdrawalMatches,
} from "./adminLedger";
import { pageQuery, type AdminDeps } from "./adminRoutes";

const DEPOSIT_STATUSES: readonly DepositStatus[] = ["checking", "review", "credited", "rejected"];
const WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = ["pending", "paid", "rejected", "cancelled"];
const ESCROW_STATUSES = ["held", "settled", "refunded"] as const;
export const REASON_MIN = 5;
export const REASON_MAX = 300;

/** One of `allowed`, or null (no filter) when missing or unknown. */
const oneOf = <T extends string>(raw: unknown, allowed: readonly T[]): T | null =>
  typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;

export function adminMoneyRoutes(deps: AdminDeps, audit: AdminAudit, log: LogCache): Router {
  const { wallet, identity, deposits, withdrawals } = deps;
  const router = Router();

  /** Profile lookups, remembered for one request (a page of rows names the same players often). */
  const lookups = (): ProfileOf => {
    const seen = new Map<string, ReturnType<ProfileOf>>();
    return (id) => {
      if (!seen.has(id)) seen.set(id, identity.get(id));
      return seen.get(id)!;
    };
  };
  const bookOf = (raw: unknown): Book => pick(raw, ["real", "play"] as const, wallet.mode);

  router.get("/api/admin/wallet/summary", (req, res) => {
    const book = bookOf(req.query.book);
    const balances = wallet.balancesIn(book);
    let playerBalances = 0;
    for (const [id, amount] of Object.entries(balances)) if (id !== PLATFORM_ACCOUNT) playerBalances += amount;
    const held = wallet.escrows(book).filter((e) => e.status === "held");
    const adjusts = wallet.txnsIn(book).filter((t) => t.kind === "adjust");
    const real = book === "real";
    const allDeposits = real ? deposits.all() : [];
    const allWithdrawals = real ? withdrawals.all() : [];
    const limits = withdrawals.config();
    res.json({
      book,
      mode: wallet.mode,
      playerBalances,
      platformBalance: Object.hasOwn(balances, PLATFORM_ACCOUNT) ? balances[PLATFORM_ACCOUNT] : 0,
      heldInEscrow: held.reduce((s, e) => s + 2 * e.stake, 0),
      heldEscrows: held.length,
      deposits: tally(
        allDeposits.filter((x) => x.status === "credited"),
        (x) => x.amount ?? 0,
      ),
      withdrawals: {
        paid: tally(
          allWithdrawals.filter((w) => w.status === "paid"),
          (w) => w.amount,
        ),
        pending: tally(
          allWithdrawals.filter((w) => w.status === "pending"),
          (w) => w.amount,
        ),
      },
      depositsInReview: tally(
        allDeposits.filter((x) => x.status === "review"),
        (x) => x.reviewAmount ?? 0,
      ),
      adjustments: { count: adjusts.length, net: adjusts.reduce((s, t) => s + t.amount, 0) },
      legacyReport: wallet.legacyReport(),
      config: {
        ...wallet.config(),
        depositHoldMs: wallet.depositHoldMs,
        depositsEnabled: deposits.enabled,
        minDeposit: MIN_DEPOSIT,
        withdrawals: limits,
      },
    });
  });

  router.get("/api/admin/wallet/transactions", (req, res) => {
    const { page, limit } = pageQuery(req.query);
    const book = bookOf(req.query.book);
    const profileOf = lookups();
    let source: "log" | "store" = "log";
    let rows = logTxnRows(log.entries(), book, profileOf);
    // The log only began with the audit code: before any logged txn, show what the store kept.
    if (rows.length === 0) {
      source = "store";
      rows = storeTxnRows(wallet.txnsIn(book), book, profileOf);
    }
    const kinds = typeof req.query.kind === "string" ? req.query.kind.split(",").map((k) => k.trim()).filter(Boolean) : [];
    const found = filterTxns(rows, {
      kinds,
      profileId: typeof req.query.profileId === "string" ? req.query.profileId.trim() : "",
      from: msQuery(req.query.from),
      to: msQuery(req.query.to),
      q: queryText(req.query.q),
    });
    res.json({ ...paged(found, page, limit), source });
  });

  router.get("/api/admin/wallet/escrows", (req, res) => {
    const { page, limit } = pageQuery(req.query);
    const book = bookOf(req.query.book);
    const status = oneOf(req.query.status, ESCROW_STATUSES);
    const profileOf = lookups();
    const found = wallet
      .escrows(book)
      .filter((e) => !status || e.status === status)
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    const one = paged(found, page, limit);
    res.json({ rows: one.rows.map((e) => escrowRow(book, e, profileOf)), total: one.total });
  });

  router.get("/api/admin/deposits", (req, res) => {
    const { page, limit } = pageQuery(req.query);
    const status = oneOf(req.query.status, DEPOSIT_STATUSES);
    const q = queryText(req.query.q);
    const profileOf = lookups();
    const rows = deposits
      .all()
      .filter((x) => !status || x.status === status)
      .map((x) => adminDeposit(x, profileOf))
      .filter((x) => depositMatches(x, q));
    res.json(paged(orderMoney(rows, status ? null : "review"), page, limit));
  });

  router.get("/api/admin/withdrawals", (req, res) => {
    const { page, limit } = pageQuery(req.query);
    const status = oneOf(req.query.status, WITHDRAWAL_STATUSES);
    const q = queryText(req.query.q);
    const profileOf = lookups();
    const rows = withdrawals
      .all()
      .filter((w) => !status || w.status === status)
      .map((w) => adminWithdrawal(w, profileOf))
      .filter((w) => withdrawalMatches(w, q));
    res.json(paged(orderMoney(rows, status ? null : "pending"), page, limit));
  });

  /**
   * Approve (credit) or reject (free the reference) a deposit in review, as the Telegram
   * buttons do, attributed to `admin:<name>`. The written reason goes to the audit log
   * only; the player sees the usual text.
   */
  router.post("/api/admin/deposits/:id/resolve", (req, res) => {
    const { approve, reason } = req.body ?? {};
    if (typeof approve !== "boolean") return res.status(400).json({ error: "approve must be true or false" });
    const why = typeof reason === "string" ? reason.trim() : "";
    if (why.length < REASON_MIN || why.length > REASON_MAX) {
      return res.status(400).json({ error: `give a reason (${REASON_MIN} to ${REASON_MAX} characters)` });
    }
    const id = req.params.id;
    const current = deposits.get(id);
    if (!current) return res.status(404).json({ error: "deposit not found" });
    if (current.status !== "review") return res.status(409).json({ error: `this deposit is ${current.status}, not in review` });
    // Approving with real money off would only turn into a rejection: refuse instead.
    if (approve && wallet.mode !== "real") return res.status(409).json({ error: "real money is off, so a deposit can't be credited" });
    const caller = adminCaller(res);
    const by = caller.name ? `admin:${caller.name}` : "admin";
    const x = deposits.resolveFromAdmin(id, approve, by);
    if (!x) return res.status(409).json({ error: "this deposit is no longer in review" });
    console.warn(`deposits: ${by} ${approve ? "approved" : "rejected"} deposit ${id} (now ${x.status})`);
    audit.add({
      actor: actorOf(caller),
      action: "deposit-resolve",
      target: id,
      detail: {
        approve,
        reason: why,
        profileId: x.profileId,
        amount: x.reviewAmount ?? x.amount ?? null,
        bank: x.bank,
        reference: x.reference,
        status: x.status,
        by,
      },
      ip: req.ip,
    });
    res.json(adminDeposit(x, lookups()));
  });

  return router;
}
