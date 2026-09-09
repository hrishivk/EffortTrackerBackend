// A tiny fixed-window rate limiter, in memory.
//
// Used on POST /role-user/workspaces/join and nothing else. Every other
// workspace endpoint needs an id the caller already has, so a wrong guess costs
// the attacker a lookup and gains them nothing. The join endpoint is the one
// place where a WRONG guess is cheap and a RIGHT guess is worth something, so
// it is the one place worth throttling.
//
// In memory, deliberately: this project runs a single node process and has no
// Redis. The trade-off is that the counter resets on restart and would be
// per-process behind a load balancer — enough to stop a script hammering keys,
// not a distributed attack. If this ever runs multi-process, move the counter
// to a shared store; the call site does not change.
interface Window {
  count: number;
  // When the current window expires, as epoch ms.
  resetAt: number;
}

export class RateLimiter {
  private windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  // Returns null when the call is allowed, or the seconds to wait when it is
  // not — the caller puts that in the message so the UI can say when to retry.
  public check(key: string): number | null {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return null;
    }

    if (existing.count >= this.limit) {
      return Math.ceil((existing.resetAt - now) / 1000);
    }

    existing.count += 1;
    return null;
  }

  // A successful join should not count against the caller's budget — the limit
  // exists to make GUESSING expensive, not to ration legitimate joins.
  public forget(key: string): void {
    this.windows.delete(key);
  }

  // Expired windows would otherwise accumulate one entry per user forever.
  // Cheap because it only runs when a new window opens.
  private sweep(now: number): void {
    if (this.windows.size < 1000) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
