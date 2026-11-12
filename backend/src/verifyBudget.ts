// A cap on verify.et checks across all players (audit review R3). Per-account and
// per-IP limits alone still let a few IPs use up the month's credits in hours, so
// player deposit checks stop for the day (or month) once a shared budget is spent.
// Every verify.et check is counted, including moderators' payout checks, but only
// deposits are refused: a payout check must still work when players used the budget.

import type { Store } from "./store";
import type { VerifyEt } from "./deposits";

const KEY = "verifyBudget";

/** VERIFY_DAILY_BUDGET / VERIFY_MONTHLY_BUDGET. verify.et's free plan has 200 checks a month. */
export const VERIFY_BUDGET = { daily: 20, monthly: 200 };

interface BudgetData {
  day: string;
  dayCount: number;
  month: string;
  monthCount: number;
}

/** Numbers from the env; "off" (or 0) turns that cap off; unreadable values keep the defaults. */
export function verifyBudgetFromEnv(env: Record<string, string | undefined> = process.env): typeof VERIFY_BUDGET {
  const read = (raw: string | undefined, fallback: number) => {
    if (raw === undefined || raw.trim() === "") return fallback;
    if (raw.trim().toLowerCase() === "off") return Infinity;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n === 0 ? Infinity : Math.floor(n);
  };
  return { daily: read(env.VERIFY_DAILY_BUDGET, VERIFY_BUDGET.daily), monthly: read(env.VERIFY_MONTHLY_BUDGET, VERIFY_BUDGET.monthly) };
}

export class VerifyBudget {
  readonly limits: typeof VERIFY_BUDGET;
  private readonly now: () => number;

  constructor(
    private readonly store: Store,
    limits: Partial<typeof VERIFY_BUDGET> = {},
    now: () => number = Date.now,
  ) {
    this.limits = { ...VERIFY_BUDGET, ...limits };
    this.now = now;
  }

  /** Counts for the current UTC day and month. */
  private data(): BudgetData {
    const iso = new Date(this.now()).toISOString();
    const day = iso.slice(0, 10);
    const month = iso.slice(0, 7);
    const d = this.store.read<BudgetData>(KEY, { day, dayCount: 0, month, monthCount: 0 });
    return {
      day,
      dayCount: d.day === day ? d.dayCount : 0,
      month,
      monthCount: d.month === month ? d.monthCount : 0,
    };
  }

  /** Checks used so far today and this month. */
  used(): { day: number; month: number } {
    const d = this.data();
    return { day: d.dayCount, month: d.monthCount };
  }

  /** Which cap is spent, or null while checks are left. */
  spent(): "day" | "month" | null {
    const d = this.data();
    if (d.monthCount >= this.limits.monthly) return "month";
    if (d.dayCount >= this.limits.daily) return "day";
    return null;
  }

  /** Count one verify.et check. */
  record(): void {
    const d = this.data();
    d.dayCount++;
    d.monthCount++;
    this.store.write(KEY, d);
  }

  /** The same verify.et client, counting every check it starts (status polls aren't new checks). */
  wrap(verifyEt: VerifyEt): VerifyEt {
    return {
      verify: (input) => {
        this.record();
        return verifyEt.verify(input);
      },
      status: (requestId) => verifyEt.status(requestId),
    };
  }
}
