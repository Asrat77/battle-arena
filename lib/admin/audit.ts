// Pure helpers behind the Audit log screen: action labels, the filter chips and
// the API `action` value each stands for, one-line summaries of an entry, the
// link to what it touched, and readable detail pairs (money in birr). No React.

import { birr, signedBirr, unitFor, type Book } from "./format";
import type { AuditEntry } from "./types";

export const AUDIT_FILTERS = ["all", "signins", "failed", "signouts", "adjustments", "deposits"] as const;
export type AuditFilter = (typeof AUDIT_FILTERS)[number];

export const AUDIT_FILTER_LABELS: Record<AuditFilter, string> = {
  all: "All",
  signins: "Sign-ins",
  failed: "Failed sign-ins",
  signouts: "Sign-outs",
  adjustments: "Adjustments",
  deposits: "Deposit decisions",
};

/** The `action` query value for each chip (all = no filter). */
export const AUDIT_FILTER_ACTIONS: Record<AuditFilter, AuditEntry["action"] | null> = {
  all: null,
  signins: "signin",
  failed: "signin-failed",
  signouts: "signout",
  adjustments: "wallet-adjust",
  deposits: "deposit-resolve",
};

export const AUDIT_PAGE_SIZE = 50;

/** The ?type= value, or "all" for anything unknown. */
export function parseAuditFilter(raw: string | null): AuditFilter {
  return (AUDIT_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as AuditFilter) : "all";
}

export const ACTION_LABELS: Record<string, string> = {
  signin: "Signed in",
  "signin-failed": "Failed sign-in",
  signout: "Signed out",
  "wallet-adjust": "Balance adjusted",
  "deposit-resolve": "Deposit decided",
};

/** "wallet-adjust" → "Balance adjusted"; an action a later release adds still reads sensibly. */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.charAt(0).toUpperCase() + action.slice(1).replace(/-/g, " ");
}

/** Pill tone word for `StatusPill` (it knows these words). */
export function actionStatus(action: string): string {
  if (action === "signin-failed") return "rejected";
  if (action === "wallet-adjust" || action === "deposit-resolve") return "review";
  return "neutral";
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const bookOf = (v: unknown): Book => (v === "play" ? "play" : "real");

/** One short line: what was done and why. Empty for plain sign-ins and sign-outs. */
export function auditSummary(e: Pick<AuditEntry, "action" | "detail">): string {
  const d = e.detail ?? {};
  if (e.action === "wallet-adjust" && typeof d.amount === "number") {
    const unit = unitFor(bookOf(d.book));
    return [`${signedBirr(d.amount)} ${unit}`, text(d.reason)].filter(Boolean).join(" · ");
  }
  if (e.action === "deposit-resolve") {
    const verb = d.approve === true ? "Approved" : "Rejected";
    const amount = typeof d.amount === "number" ? ` ${birr(d.amount)} ETB` : "";
    return [`${verb}${amount}`, text(d.reason)].filter(Boolean).join(" · ");
  }
  if (e.action === "signin-failed") return "Wrong admin token";
  return "";
}

/** Where the entry's target lives in the admin site, or null. */
export function auditTargetHref(e: Pick<AuditEntry, "action" | "target">): string | null {
  if (!e.target) return null;
  if (e.action === "wallet-adjust") return e.target === "platform" ? "/admin/wallet" : `/admin/players/${encodeURIComponent(e.target)}`;
  if (e.action === "deposit-resolve") return `/admin/deposits?tab=all&open=${encodeURIComponent(e.target)}`;
  return null;
}

/** Detail as label/value rows for the drawer; santim amounts are shown in birr (signed for an adjustment). */
export function auditFacts(e: Pick<AuditEntry, "action" | "detail">): { label: string; value: string }[] {
  const d = e.detail ?? {};
  const unit = unitFor(bookOf(d.book));
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => ({
      label: k.replace(/([A-Z])/g, " $1").toLowerCase(),
      value: typeof v === "number" && k === "amount" ? `${e.action === "wallet-adjust" ? signedBirr(v) : birr(v)} ${unit}` : String(v),
    }));
}
