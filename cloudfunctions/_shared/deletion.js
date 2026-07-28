async function drainBatches(fetchBatch, removeItem, maxItems = 100000) {
  let removed = 0;
  while (removed < maxItems) {
    const batch = await fetchBatch();
    if (!batch.length) return removed;
    for (const item of batch) {
      await removeItem(item);
      removed += 1;
      if (removed >= maxItems) break;
    }
  }
  return removed;
}

function deletionRetryState(attemptCount, nowValue, deadlineValue) {
  const now = new Date(nowValue);
  const deadline = new Date(deadlineValue);
  const nextAttemptNumber = Number(attemptCount || 0) + 1;
  const backoffMs = Math.min(60 * 60_000, 2 ** Math.min(nextAttemptNumber, 10) * 60_000);
  const proposed = new Date(now.getTime() + backoffMs);
  return {
    status: "pending",
    attempt_count: nextAttemptNumber,
    next_attempt_at: proposed > deadline && deadline > now ? deadline : proposed
  };
}

module.exports = { drainBatches, deletionRetryState };
