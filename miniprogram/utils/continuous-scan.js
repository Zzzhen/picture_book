const SESSION_VERSION = 2;

function createContinuousSession(scanSessionId) {
  return {
    version: SESSION_VERSION,
    scanSessionId,
    session: { total: 0, successful: 0, skipped: 0, failures: 0 },
    scanItems: [],
    selectedShelf: null,
    submissionStarted: false
  };
}

function mergeScanItem(items, lookup) {
  const key = lookup.edition_id || lookup.isbn13;
  const index = items.findIndex((item) => (item.edition_id || item.isbn13) === key);
  if (index < 0) {
    return items.concat({
      ...lookup,
      scan_count: 1,
      committed_count: 0,
      commit_operations: [],
      user_book_id: "",
      status: "pending",
      error_message: ""
    });
  }
  return items.map((item, itemIndex) => itemIndex === index
    ? { ...item, ...lookup, scan_count: (item.scan_count || 1) + 1 }
    : item);
}

function removeScanItem(items, editionId) {
  return items.filter((item) => item.edition_id !== editionId);
}

function sessionTotals(items) {
  return items.reduce((totals, item) => ({
    uniqueCount: totals.uniqueCount + 1,
    copyCount: totals.copyCount + (item.scan_count || 0),
    committedCount: totals.committedCount + (item.committed_count || 0)
  }), { uniqueCount: 0, copyCount: 0, committedCount: 0 });
}

function prepareCommitOperations(item, createRequestId) {
  const existing = Array.isArray(item.commit_operations) ? item.commit_operations.slice(0, item.scan_count) : [];
  while (existing.length < item.scan_count) {
    existing.push({ request_id: createRequestId(), status: "pending" });
  }
  return { ...item, commit_operations: existing };
}

function resetFailedCommitOperations(item, createRequestId) {
  const operations = (item.commit_operations || []).map((operation) => operation.status === "failed"
    ? { request_id: createRequestId(), status: "pending" }
    : { ...operation });
  return {
    ...item,
    commit_operations: operations,
    status: operations.every((operation) => operation.status === "completed") ? "added" : "pending",
    error_message: ""
  };
}

function isAmbiguousCommitError(error = {}) {
  const code = String(error.code || "").toUpperCase();
  if (!code) return true;
  if ([
    "NETWORK_ERROR",
    "REQUEST_IN_PROGRESS",
    "CLOUD_FUNCTION_TIMEOUT",
    "TIMEOUT",
    "DATABASE_ERROR",
    "INTERNAL_ERROR",
    "SYSTEM_ERROR"
  ].includes(code)) return true;
  const message = String(error.errMsg || error.message || "").toLowerCase();
  return message.includes("timeout") || message.includes("network") || message.includes("cloud.callfunction:fail");
}

module.exports = {
  SESSION_VERSION,
  createContinuousSession,
  mergeScanItem,
  removeScanItem,
  sessionTotals,
  prepareCommitOperations,
  resetFailedCommitOperations,
  isAmbiguousCommitError
};
