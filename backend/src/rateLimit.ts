// Sliding-window limiter keyed by caller (an IP). Memory only: a restart resets it.

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and returns true, or returns false when `key` is over the limit. */
  take(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    this.hits.set(key, [...recent, now]);
    if (this.hits.size > 5000) {
      for (const [k, ts] of this.hits) if (!ts.some((t) => t > now - this.windowMs)) this.hits.delete(k);
    }
    return true;
  }
}
