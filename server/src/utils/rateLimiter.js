const DEFAULT_WINDOW_MS = 60 * 1000;

export class SlidingWindowRateLimiter {
  constructor({ windowMs = DEFAULT_WINDOW_MS, max = 60 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
  }

  check(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = this.hits.get(key) || [];
    let idx = 0;
    while (idx < timestamps.length && timestamps[idx] <= windowStart) {
      idx += 1;
    }
    const active = idx > 0 ? timestamps.slice(idx) : timestamps;
    if (active.length >= this.max) {
      const retryAfterMs = Math.max(0, active[0] + this.windowMs - now);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }
    active.push(now);
    this.hits.set(key, active);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
