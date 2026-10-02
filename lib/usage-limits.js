// Per-user model usage limits: a daily message quota persisted in SQLite and a
// cap on simultaneous streams held in memory (the server is a single process).
function createUsageLimits({ usageQueries, dailyMessageLimit, maxConcurrentStreams, dayOffsetHours }) {
  const activeStreams = new Map();

  function usageDay(now = Date.now()) {
    return new Date(now + dayOffsetHours * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  // Reserves one generation for the user. Returns a lease with release(), or
  // a { status, error } denial. Admins are exempt from the daily quota.
  function acquire(user) {
    const active = activeStreams.get(user.id) || 0;
    if (active >= maxConcurrentStreams) {
      return { status: 429, error: '已有回答正在生成，请等它完成或停止后再发送' };
    }
    const day = usageDay();
    if (dailyMessageLimit > 0 && user.role !== 'admin') {
      const used = usageQueries.getDaily.get(user.id, day)?.messages || 0;
      if (used >= dailyMessageLimit) {
        return { status: 429, error: `今日消息额度（${dailyMessageLimit} 条）已用完，请明天再来` };
      }
    }
    usageQueries.incrementDaily.run(user.id, day);
    activeStreams.set(user.id, active + 1);

    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        const remaining = (activeStreams.get(user.id) || 1) - 1;
        if (remaining > 0) activeStreams.set(user.id, remaining);
        else activeStreams.delete(user.id);
      },
    };
  }

  return { acquire, usageDay };
}

module.exports = { createUsageLimits };
