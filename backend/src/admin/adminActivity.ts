// The merged activity feed for the admin site: sign-ups, finished matches, deposits,
// withdrawals, manual adjustments, tournaments and admin actions as one newest-first
// list of short sentences. Pure: each builder turns plain rows into feed rows; the
// route in adminInsights.ts gathers the inputs and pages the result.
import type { Deposit } from "../deposits";
import type { Profile } from "../identity";
import type { Withdrawal } from "../withdrawals";
import type { AuditEntry } from "./adminAudit";
import type { MatchRow, ProfileOf } from "./adminData";
import type { TxnRow } from "./adminLedger";

export const ACTIVITY_TYPES = ["signup", "match", "deposit", "withdrawal", "adjust", "tournament", "admin"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
/** The newest this many rows are kept before paging. */
export const ACTIVITY_CAP = 5000;

export interface Actor {
  id: string;
  name: string;
  username: string | null;
}

export interface ActivityRow {
  /** "<type>:<source id>", unique in the feed. */
  id: string;
  ts: number;
  type: ActivityType;
  title: string;
  actor: Actor | null;
  /** Santim, or null. */
  amount: number | null;
  /** Admin site path. */
  link: string | null;
  meta: Record<string, string | number | boolean | null>;
}

/** The types asked for in `?type=a,b`; unknown names are ignored, and none valid means all. */
export function parseTypes(raw: unknown): Set<ActivityType> {
  const asked = typeof raw === "string" ? raw.split(",").map((t) => t.trim()) : [];
  const valid = ACTIVITY_TYPES.filter((t) => asked.includes(t));
  return new Set(valid.length > 0 ? valid : ACTIVITY_TYPES);
}

const birr = (santim: number) => `${(Math.abs(santim) / 100).toFixed(2)} birr`;
const BANKS: Record<string, string> = { telebirr: "Telebirr", cbe: "CBE" };
const bank = (b: string) => BANKS[b] ?? b;

const actorOfProfile = (id: string, profileOf: ProfileOf): Actor => {
  const p = profileOf(id);
  return { id, name: p?.name ?? "Someone", username: p?.username ?? null };
};
const nameOf = (id: string, profileOf: ProfileOf) => profileOf(id)?.name ?? "Someone";
const playerLink = (id: string) => `/admin/players/${id}`;

export function signupRows(profiles: Profile[]): ActivityRow[] {
  return profiles.map((p) => ({
    id: `signup:${p.id}`,
    ts: p.createdAt,
    type: "signup",
    title: `${p.name} joined`,
    actor: { id: p.id, name: p.name, username: p.username },
    amount: null,
    link: playerLink(p.id),
    meta: {},
  }));
}

/** One row per recorded match: "Abebe beat Sara at Gebeta" or "Abebe and Sara drew at Gebeta". */
export function matchRows(matches: MatchRow[]): ActivityRow[] {
  return matches.map((m) => {
    const [a, b] = m.players;
    const winner = m.outcome.winner === null || m.outcome.draw ? null : m.players[m.outcome.winner];
    const loser = winner ? (winner === a ? b : a) : null;
    const nm = (p: { name: string | null }) => p.name ?? "Someone";
    const title = winner && loser ? `${nm(winner)} beat ${nm(loser)} at ${m.gameName}` : `${nm(a)} and ${nm(b)} drew at ${m.gameName}`;
    const lead = winner ?? a;
    return {
      id: `match:${m.matchId}`,
      ts: m.endedAt,
      type: "match",
      title,
      actor: lead.bot ? null : { id: lead.profileId, name: nm(lead), username: lead.username },
      amount: m.stake ? m.stake.amount : null,
      link: `/admin/matches?open=${encodeURIComponent(m.matchId)}`,
      meta: { gameId: m.gameId, bot: m.bot, staked: m.stake !== null, ...(m.stake ? { book: m.stake.book } : {}) },
    };
  });
}

/** A deposit shows up when it is made and again when it is credited or rejected. */
export function depositRows(list: Deposit[], profileOf: ProfileOf): ActivityRow[] {
  const out: ActivityRow[] = [];
  for (const d of list) {
    const who = nameOf(d.profileId, profileOf);
    const base = { type: "deposit" as const, actor: actorOfProfile(d.profileId, profileOf), link: "/admin/deposits" };
    out.push({
      ...base,
      id: `deposit:${d.id}:new`,
      ts: d.createdAt,
      title: `${who} sent a ${bank(d.bank)} deposit for checking`,
      amount: d.reviewAmount ?? d.amount ?? null,
      meta: { status: d.status, bank: d.bank },
    });
    if (d.closedAt !== null && (d.status === "credited" || d.status === "rejected")) {
      out.push({
        ...base,
        id: `deposit:${d.id}:closed`,
        ts: d.closedAt,
        title: d.status === "credited" ? `${who}'s ${bank(d.bank)} deposit was credited` : `${who}'s ${bank(d.bank)} deposit was rejected`,
        amount: d.status === "credited" ? d.amount : (d.reviewAmount ?? d.amount ?? null),
        meta: { status: d.status, bank: d.bank, by: d.closedBy ?? null },
      });
    }
  }
  return out;
}

/** A withdrawal shows up when requested and again when paid, rejected or cancelled. */
export function withdrawalRows(list: Withdrawal[], profileOf: ProfileOf): ActivityRow[] {
  const out: ActivityRow[] = [];
  for (const w of list) {
    const who = nameOf(w.profileId, profileOf);
    const base = { type: "withdrawal" as const, actor: actorOfProfile(w.profileId, profileOf), link: "/admin/withdrawals", amount: w.amount };
    out.push({ ...base, id: `withdrawal:${w.id}:new`, ts: w.createdAt, title: `${who} asked to withdraw ${birr(w.amount)} to ${bank(w.bank)}`, meta: { status: w.status, bank: w.bank } });
    if (w.closedAt !== null && w.status !== "pending") {
      const verb = { paid: "was paid", rejected: "was rejected", cancelled: "was cancelled" }[w.status];
      out.push({
        ...base,
        id: `withdrawal:${w.id}:closed`,
        ts: w.closedAt,
        title: `${who}'s ${birr(w.amount)} withdrawal ${verb}`,
        meta: { status: w.status, bank: w.bank, by: w.closedBy ?? null },
      });
    }
  }
  return out;
}

/** Manual balance adjustments (adjust transactions of either book). */
export function adjustRows(rows: TxnRow[]): ActivityRow[] {
  return rows
    .filter((t) => t.kind === "adjust")
    .map((t) => {
      const platform = t.profileId === "platform";
      const who = platform ? "the platform" : (t.name ?? "someone");
      return {
        id: `adjust:${t.book}:${t.id}`,
        ts: t.ts,
        type: "adjust" as const,
        title: `${t.by ?? "An admin"} ${t.amount >= 0 ? "credited" : "debited"} ${birr(t.amount)} ${t.amount >= 0 ? "to" : "from"} ${who} (${t.book})`,
        actor: platform ? null : { id: t.profileId, name: t.name ?? "Someone", username: t.username },
        amount: t.amount,
        link: platform ? "/admin/wallet" : playerLink(t.profileId),
        meta: { book: t.book, by: t.by },
      };
    });
}

export interface TournamentInput {
  id: string;
  name: string;
  gameName: string;
  state: string;
  createdAt: number;
  endedAt: number | null;
  host: string | null;
  champion: { id: string; name: string; bot: boolean } | null;
}

/** Created, and finished with the champion's name. */
export function tournamentRows(list: TournamentInput[], profileOf: ProfileOf): ActivityRow[] {
  const out: ActivityRow[] = [];
  for (const t of list) {
    const link = "/admin/tournaments";
    out.push({
      id: `tournament:${t.id}:created`,
      ts: t.createdAt,
      type: "tournament",
      title: `${t.host ? nameOf(t.host, profileOf) : "Someone"} created the ${t.gameName} tournament "${t.name}"`,
      actor: t.host ? actorOfProfile(t.host, profileOf) : null,
      amount: null,
      link,
      meta: { gameName: t.gameName, status: t.state },
    });
    if (t.state === "finished" && t.endedAt !== null) {
      out.push({
        id: `tournament:${t.id}:finished`,
        ts: t.endedAt,
        type: "tournament",
        title: t.champion ? `${t.champion.name} won the ${t.gameName} tournament "${t.name}"` : `The ${t.gameName} tournament "${t.name}" finished`,
        actor: t.champion && !t.champion.bot ? actorOfProfile(t.champion.id, profileOf) : null,
        amount: null,
        link,
        meta: { gameName: t.gameName, status: "finished" },
      });
    }
  }
  return out;
}

/** Admin sign-ins, sign-outs and deposit decisions. Failed sign-ins are noise; adjustments are already `adjust` rows. */
export function adminRows(entries: AuditEntry[]): ActivityRow[] {
  return entries
    .filter((e) => e.action !== "signin-failed" && e.action !== "wallet-adjust")
    .map((e) => {
      const d = e.detail ?? {};
      let title = `${e.actor} did ${e.action}`;
      if (e.action === "signin") title = `${e.actor} signed in to the admin site`;
      else if (e.action === "signout") title = `${e.actor} signed out of the admin site`;
      else if (e.action === "deposit-resolve") title = `${e.actor} ${d.approve ? "approved" : "rejected"} a deposit in review`;
      return {
        id: `admin:${e.id}`,
        ts: e.ts,
        type: "admin" as const,
        title,
        actor: { id: "admin", name: e.actor, username: null },
        amount: typeof d.amount === "number" ? d.amount : null,
        link: "/admin/audit",
        meta: { action: e.action, ...(e.target ? { target: e.target } : {}), ...(typeof d.approve === "boolean" ? { approve: d.approve } : {}) },
      };
    });
}

/** Newest first (ties by id), cut to the newest ACTIVITY_CAP. */
export function mergeFeed(parts: ActivityRow[][]): ActivityRow[] {
  return parts
    .flat()
    .sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id))
    .slice(0, ACTIVITY_CAP);
}
