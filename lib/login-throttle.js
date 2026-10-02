// Per-account login throttling, layered on top of the per-IP auth limiter.
// Failures are counted per (account, client IP) so an attacker cannot lock a
// user out everywhere; a looser account-wide budget slows distributed guessing.
const FREE_FAILURES = 5;
const BASE_DELAY_MS = 60 * 1000;
const MAX_DELAY_MS = 15 * 60 * 1000;
const ACCOUNT_FAILURE_BUDGET = 50;
const ACCOUNT_WINDOW_MS = 60 * 60 * 1000;
const IDLE_ENTRY_MS = 24 * 60 * 60 * 1000;

function createLoginThrottle({ disabled = process.env.RATE_LIMIT_DISABLED === 'true' } = {}) {
  const pairs = new Map();
  const accounts = new Map();

  setInterval(() => {
    const cutoff = Date.now() - IDLE_ENTRY_MS;
    for (const map of [pairs, accounts]) {
      for (const [key, entry] of map) {
        if (entry.lastFailureAt < cutoff) map.delete(key);
      }
    }
  }, 10 * 60 * 1000).unref();

  // Milliseconds the caller must wait before another attempt; 0 means allowed.
  function retryAfterMs(userId, ip, now = Date.now()) {
    if (disabled) return 0;
    const lockedUntil = Math.max(
      pairs.get(`${userId}|${ip}`)?.lockedUntil || 0,
      accounts.get(userId)?.lockedUntil || 0,
    );
    return Math.max(0, lockedUntil - now);
  }

  function recordFailure(userId, ip, now = Date.now()) {
    if (disabled) return;
    const pairKey = `${userId}|${ip}`;
    const pair = pairs.get(pairKey) || { failures: 0, lockedUntil: 0, lastFailureAt: now };
    pair.failures += 1;
    pair.lastFailureAt = now;
    if (pair.failures >= FREE_FAILURES) {
      pair.lockedUntil = now + Math.min(BASE_DELAY_MS * 2 ** (pair.failures - FREE_FAILURES), MAX_DELAY_MS);
    }
    pairs.set(pairKey, pair);

    let account = accounts.get(userId);
    if (!account || now - account.windowStartedAt > ACCOUNT_WINDOW_MS) {
      account = { failures: 0, windowStartedAt: now, lockedUntil: 0, lastFailureAt: now };
    }
    account.failures += 1;
    account.lastFailureAt = now;
    if (account.failures >= ACCOUNT_FAILURE_BUDGET) account.lockedUntil = now + MAX_DELAY_MS;
    accounts.set(userId, account);
  }

  function recordSuccess(userId, ip) {
    pairs.delete(`${userId}|${ip}`);
  }

  return { retryAfterMs, recordFailure, recordSuccess };
}

module.exports = { createLoginThrottle };
