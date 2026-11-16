// CSV columns for the admin lists that had no export yet (deposits, withdrawals,
// tournaments, activity, audit log), plus one file-name helper. Money is given
// in birr as numbers and times as ISO (UTC) text, like the match and ledger exports.

import type { CsvColumn } from "./csv";
import { bankLabel } from "./players";
import type { ActivityRow, AdminDeposit, AdminWithdrawal, AuditEntry, TournamentRow } from "./types";

const iso = (ts: number | null | undefined) => (ts == null ? "" : new Date(ts).toISOString());
const birr = (santim: number | null | undefined) => (santim == null ? "" : santim / 100);

export const DEPOSIT_CSV_COLUMNS: CsvColumn<AdminDeposit>[] = [
  { header: "deposit id", value: (d) => d.id },
  { header: "created", value: (d) => iso(d.createdAt) },
  { header: "closed", value: (d) => iso(d.closedAt) },
  { header: "status", value: (d) => d.status },
  { header: "player id", value: (d) => d.player.id },
  { header: "player", value: (d) => d.player.name ?? "" },
  { header: "username", value: (d) => d.player.username ?? "" },
  { header: "bank", value: (d) => bankLabel(d.bank) },
  { header: "reference", value: (d) => d.reference },
  { header: "amount birr", value: (d) => birr(d.amount) },
  { header: "in review birr", value: (d) => birr(d.reviewAmount) },
  { header: "payer name", value: (d) => d.payerName ?? "" },
  { header: "sender name", value: (d) => d.senderName ?? "" },
  { header: "paid at", value: (d) => iso(d.paidAt) },
  { header: "closed by", value: (d) => d.closedBy ?? "" },
  { header: "reason", value: (d) => d.reason ?? "" },
  { header: "review why", value: (d) => d.reviewWhy ?? "" },
];

export const WITHDRAWAL_CSV_COLUMNS: CsvColumn<AdminWithdrawal>[] = [
  { header: "withdrawal id", value: (w) => w.id },
  { header: "created", value: (w) => iso(w.createdAt) },
  { header: "closed", value: (w) => iso(w.closedAt) },
  { header: "status", value: (w) => w.status },
  { header: "player id", value: (w) => w.player.id },
  { header: "player", value: (w) => w.player.name ?? "" },
  { header: "username", value: (w) => w.player.username ?? "" },
  { header: "bank", value: (w) => bankLabel(w.bank) },
  { header: "account", value: (w) => w.account },
  { header: "pay to name", value: (w) => w.payToName ?? "" },
  { header: "amount birr", value: (w) => w.amount / 100 },
  { header: "payout reference", value: (w) => w.reference ?? "" },
  { header: "closed by", value: (w) => w.closedBy ?? "" },
  { header: "forced by", value: (w) => w.forced?.by ?? "" },
  { header: "unverified", value: (w) => Boolean(w.unverified) },
];

export const TOURNAMENT_CSV_COLUMNS: CsvColumn<TournamentRow>[] = [
  { header: "tournament id", value: (t) => t.id },
  { header: "name", value: (t) => t.name },
  { header: "game", value: (t) => t.gameName },
  { header: "status", value: (t) => t.status },
  { header: "size", value: (t) => t.size },
  { header: "best of", value: (t) => t.bestOf },
  { header: "visibility", value: (t) => t.visibility },
  { header: "players", value: (t) => t.players },
  { header: "bots", value: (t) => t.bots },
  { header: "host", value: (t) => t.host?.name ?? "" },
  { header: "champion", value: (t) => t.champion?.name ?? "" },
  { header: "created", value: (t) => iso(t.createdAt) },
  { header: "started", value: (t) => iso(t.startedAt) },
  { header: "ended", value: (t) => iso(t.endedAt) },
];

export const ACTIVITY_CSV_COLUMNS: CsvColumn<ActivityRow>[] = [
  { header: "time", value: (a) => iso(a.ts) },
  { header: "type", value: (a) => a.type },
  { header: "title", value: (a) => a.title },
  { header: "player id", value: (a) => a.actor?.id ?? "" },
  { header: "player", value: (a) => a.actor?.name ?? "" },
  { header: "amount birr", value: (a) => birr(a.amount) },
  { header: "link", value: (a) => a.link ?? "" },
];

export const AUDIT_CSV_COLUMNS: CsvColumn<AuditEntry>[] = [
  { header: "time", value: (a) => iso(a.ts) },
  { header: "id", value: (a) => a.id },
  { header: "admin", value: (a) => a.actor },
  { header: "action", value: (a) => a.action },
  { header: "target", value: (a) => a.target ?? "" },
  { header: "detail", value: (a) => (a.detail ? JSON.stringify(a.detail) : "") },
  { header: "ip", value: (a) => a.ip ?? "" },
];

/** "deposits-review-2026-11-16.csv": what is exported, the filters that narrow it, and the (UTC) day. */
export function exportFilename(what: string, filters: readonly (string | null | undefined | false)[] = [], now = Date.now()): string {
  const parts = [what, ...filters.filter((f): f is string => Boolean(f)).map((f) => f.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")), new Date(now).toISOString().slice(0, 10)];
  return `${parts.filter(Boolean).join("-")}.csv`;
}
