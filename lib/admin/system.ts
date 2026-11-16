// Pure helpers behind the System health screen: turns GET system into a list of
// checks (ok, warn, alert or off) with one sentence each, the overall verdict,
// and how full the verify.et budget is. No React, so it is tested alone.

import { count, duration, num } from "./format";
import type { SystemInfo } from "./types";

export type CheckState = "ok" | "warn" | "alert" | "off";

export interface Check {
  id: "store" | "chain" | "ledger" | "telegram" | "verify" | "payments";
  label: string;
  state: CheckState;
  text: string;
}

const RANK: Record<CheckState, number> = { ok: 0, off: 0, warn: 1, alert: 2 };

/** Fraction of a budget used (0..1+), or null when the limit is off. */
export function budgetShare(used: number, limit: number | null): number | null {
  return limit && limit > 0 ? used / limit : null;
}

function verifyCheck(b: NonNullable<SystemInfo["verifyBudget"]>): Check {
  const day = budgetShare(b.used.day, b.limits.daily);
  const month = budgetShare(b.used.month, b.limits.monthly);
  const worst = Math.max(day ?? 0, month ?? 0);
  if (day === null && month === null) return { id: "verify", label: "Receipt checks", state: "ok", text: `${count(b.used.day, "check")} today, no limit set.` };
  if (worst >= 1) return { id: "verify", label: "Receipt checks", state: "alert", text: "The verify.et budget is used up. New deposits go to review until it resets." };
  if (worst >= 0.8) return { id: "verify", label: "Receipt checks", state: "warn", text: `${Math.round(worst * 100)}% of the verify.et budget is used.` };
  return { id: "verify", label: "Receipt checks", state: "ok", text: `${Math.round(worst * 100)}% of the verify.et budget used.` };
}

/** One check per thing that can go wrong, worst first is left to `overall`; order here is the screen order. */
export function healthChecks(s: SystemInfo): Check[] {
  const out: Check[] = [];

  if (s.database === "error" || s.store.lastError) {
    out.push({ id: "store", label: "Storage", state: "alert", text: s.store.lastError ? `A save failed: ${s.store.lastError}` : "The database does not answer." });
  } else if (s.store.kind === "memory") {
    out.push({ id: "store", label: "Storage", state: "warn", text: "Running in memory. Nothing is kept after a restart." });
  } else if (s.store.pendingWrites > 0) {
    out.push({ id: "store", label: "Storage", state: "warn", text: `${count(s.store.pendingWrites, "write")} not saved yet.` });
  } else {
    out.push({ id: "store", label: "Storage", state: "ok", text: s.store.kind === "postgres" ? "Postgres is connected and everything is saved." : "Saved to the data file." });
  }

  out.push(
    s.wallet.chain === "intact"
      ? { id: "chain", label: "Wallet log", state: "ok", text: `${count(s.wallet.logEntries, "entry", "entries")}, hash chain intact.` }
      : { id: "chain", label: "Wallet log", state: "alert", text: `The hash chain breaks at entry ${num(s.wallet.chain.at)}: ${s.wallet.chain.reason}` },
  );

  out.push(
    s.ledger.pending > 0
      ? { id: "ledger", label: "Match ledger", state: "warn", text: `${count(s.ledger.blocks, "block")} written, ${s.ledger.pending} waiting to be recorded.` }
      : { id: "ledger", label: "Match ledger", state: "ok", text: `${count(s.ledger.blocks, "block")} written, none waiting.` },
  );

  const needsTelegram = s.deposits.enabled || s.withdrawals.enabled;
  if (!s.telegram.configured) {
    out.push({ id: "telegram", label: "Telegram", state: needsTelegram ? "alert" : "off", text: needsTelegram ? "The bot is not configured, but money flows need it." : "Not configured (deposits and payouts are off)." });
  } else if (!s.telegram.moderatorChat || s.telegram.moderators === 0) {
    out.push({ id: "telegram", label: "Telegram", state: "warn", text: !s.telegram.moderatorChat ? "No moderator chat is set, so alerts have nowhere to go." : "No moderators are listed to approve payouts." });
  } else {
    out.push({ id: "telegram", label: "Telegram", state: "ok", text: `Bot on, ${count(s.telegram.moderators, "moderator")} listed.` });
  }

  if (s.verifyBudget) out.push(verifyCheck(s.verifyBudget));
  else out.push({ id: "verify", label: "Receipt checks", state: "off", text: "verify.et is not set up, so receipts cannot be checked." });

  out.push(
    s.wallet.mode === "real"
      ? { id: "payments", label: "Real money", state: s.deposits.enabled && s.withdrawals.enabled ? "ok" : "warn", text: s.deposits.enabled && s.withdrawals.enabled ? "Deposits and withdrawals are on." : `${s.deposits.enabled ? "" : "Deposits are off. "}${s.withdrawals.enabled ? "" : "Withdrawals are off."}`.trim() }
      : { id: "payments", label: "Real money", state: "off", text: "Play-money mode. No real deposits or payouts." },
  );
  return out;
}

export function overall(checks: readonly Check[]): CheckState {
  return checks.reduce<CheckState>((w, c) => (RANK[c.state] > RANK[w] ? c.state : w), "ok");
}

export const OVERALL_TEXT: Record<"ok" | "warn" | "alert", string> = {
  ok: "Everything looks healthy",
  warn: "Needs a look",
  alert: "Something is wrong",
};

export function uptimeText(ms: number): string {
  return duration(Math.max(0, ms)).replace(/ \d+s$/, "");
}
