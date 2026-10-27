// Injectable time source so timers (turn deadlines, disconnect forfeits, bot
// delays) can be driven by tests without waiting.

export type TimerHandle = { cancel(): void };

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const h = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(h) };
  },
};

/** Manual clock for tests: time only moves on advance(). */
export class FakeClock implements Clock {
  private t: number;
  private timers: { at: number; id: number; fn: () => void }[] = [];
  private nextId = 0;

  constructor(start = 1_000_000) {
    this.t = start;
  }

  now() {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const timer = { at: this.t + Math.max(0, ms), id: this.nextId++, fn };
    this.timers.push(timer);
    return { cancel: () => (this.timers = this.timers.filter((x) => x !== timer)) };
  }

  /** Move time forward, firing due timers in order (including ones they schedule). */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
}
