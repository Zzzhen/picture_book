const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SESSION_VERSION,
  createContinuousSession,
  mergeScanItem,
  removeScanItem,
  sessionTotals,
  prepareCommitOperations,
  resetFailedCommitOperations,
  isAmbiguousCommitError
} = require("../miniprogram/utils/continuous-scan");

function lookup(editionId = "isbn_9780000000001", isbn13 = "9780000000001") {
  return {
    edition_id: editionId,
    isbn13,
    title: "测试绘本",
    contributors_text: "测试作者",
    publisher: "测试出版社",
    cover_file_id: "cloud://covers/test.jpg",
    cache_hit: true,
    provider_called: false
  };
}

test("continuous session starts as a versioned empty draft", () => {
  const draft = createContinuousSession("scan_1");
  assert.equal(draft.version, SESSION_VERSION);
  assert.equal(draft.scanSessionId, "scan_1");
  assert.deepEqual(draft.session, { total: 0, successful: 0, skipped: 0, failures: 0 });
  assert.deepEqual(draft.scanItems, []);
  assert.equal(draft.selectedShelf, null);
  assert.equal(draft.submissionStarted, false);
});

test("duplicate ISBN scans merge into one pending row and increase copies", () => {
  const first = mergeScanItem([], lookup());
  const second = mergeScanItem(first, lookup());

  assert.equal(first.length, 1);
  assert.equal(first[0].scan_count, 1);
  assert.equal(second.length, 1);
  assert.equal(second[0].scan_count, 2);
  assert.deepEqual(sessionTotals(second), { uniqueCount: 1, copyCount: 2, committedCount: 0 });
});

test("the same ISBN merges even when inconsistent edition IDs are returned", () => {
  const first = mergeScanItem([], lookup("edition_a", "9780000000001"));
  const second = mergeScanItem(first, lookup("edition_b", "9780000000001"));

  assert.equal(second.length, 1);
  assert.equal(second[0].scan_count, 2);
});

test("a pending row can be removed without mutating the original list", () => {
  const original = [mergeScanItem([], lookup())[0], mergeScanItem([], lookup("isbn_2", "9780000000002"))[0]];
  const next = removeScanItem(original, "isbn_9780000000001");

  assert.equal(original.length, 2);
  assert.deepEqual(next.map((item) => item.edition_id), ["isbn_2"]);
});

test("commit operations persist one stable request ID per copy", () => {
  const requestIds = ["request-a", "request-b"];
  const item = prepareCommitOperations({ ...mergeScanItem([], lookup())[0], scan_count: 2 }, () => requestIds.shift());
  const restored = prepareCommitOperations(item, () => "unexpected");

  assert.deepEqual(item.commit_operations, [
    { request_id: "request-a", status: "pending" },
    { request_id: "request-b", status: "pending" }
  ]);
  assert.deepEqual(restored.commit_operations, item.commit_operations);
});

test("only explicit failed operations receive a new request ID on user retry", () => {
  const item = {
    ...mergeScanItem([], lookup())[0],
    scan_count: 3,
    commit_operations: [
      { request_id: "completed-id", status: "completed" },
      { request_id: "ambiguous-id", status: "processing" },
      { request_id: "failed-id", status: "failed" }
    ]
  };
  const next = resetFailedCommitOperations(item, () => "replacement-id");

  assert.deepEqual(next.commit_operations, [
    { request_id: "completed-id", status: "completed" },
    { request_id: "ambiguous-id", status: "processing" },
    { request_id: "replacement-id", status: "pending" }
  ]);
});

test("ambiguous commit errors retain the stable request ID", () => {
  assert.equal(isAmbiguousCommitError({ code: "REQUEST_IN_PROGRESS" }), true);
  assert.equal(isAmbiguousCommitError({ code: "NETWORK_ERROR" }), true);
  assert.equal(isAmbiguousCommitError({ errMsg: "cloud.callFunction:fail timeout" }), true);
  assert.equal(isAmbiguousCommitError({ code: "QUANTITY_LIMIT" }), false);
  assert.equal(isAmbiguousCommitError({ code: "BOOK_NOT_FOUND" }), false);
});
