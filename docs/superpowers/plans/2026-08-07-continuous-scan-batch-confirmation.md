# Continuous Scan Batch Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace immediate continuous-scan writes with an automatic scan loop, a recoverable pending list, one unified library commit, and an optional single-shelf assignment on `pages/add-book/index`.

**Architecture:** Extract pure continuous-scan session transformations into `miniprogram/utils/continuous-scan.js`, leaving WeChat lifecycle, camera, cloud calls, storage, and navigation in the page controller. Each scanned copy receives a stable persisted UUID before `libraryService.addBook`; ambiguous retries reuse that UUID, while explicit business failures receive a new UUID only after a user retry. The existing native scan UI and cloud service contracts remain unchanged.

**Tech Stack:** Native WeChat Mini Program JavaScript/WXML/WXSS, WeChat Cloud Functions, CommonJS, `node:test`, project design tokens.

---

## File map

- Create `miniprogram/utils/continuous-scan.js`: pure versioned-session, merge, delete, totals, commit-operation, and error-classification helpers.
- Create `tests/continuous-scan.test.js`: behavioral unit coverage for the pure session model and stable request IDs.
- Modify `tests/frontend-behavior.test.js`: page-controller and template contract coverage for automatic scanning, delayed writes, same-page review, shelf selection, and removal of summary mode.
- Modify `miniprogram/pages/add-book/index.js`: scanner loop, cache recovery, pending list, batch commit, partial retry, shelf selection, and completion.
- Modify `miniprogram/pages/add-book/index.wxml`: success/pause/review/submission states and fixed confirmation action.
- Modify `miniprogram/pages/add-book/index.wxss`: scan ticket, consistent book rows, destructive remove action, shelf row, and safe-area bottom bar.
- Modify `家庭数字绘本馆 V1.md`: update continuous-scan product and acceptance rules.
- Modify `家庭数字绘本馆 UI与Figma设计规范.md`: replace summary screen with same-page review and optional shelf selection.
- Modify `docs/ui-skill-visual-review.md`: record the visual review for the changed page states.

### Task 1: Pure continuous-scan session model

**Files:**
- Create: `tests/continuous-scan.test.js`
- Create: `miniprogram/utils/continuous-scan.js`

- [ ] **Step 1: Write the failing helper tests**

Add tests that require the wished-for helper API and assert:

```js
const {
  createContinuousSession,
  mergeScanItem,
  removeScanItem,
  sessionTotals,
  prepareCommitOperations,
  isAmbiguousCommitError
} = require("../miniprogram/utils/continuous-scan");

test("duplicate ISBN scans merge into one pending row and increase copies", () => {
  const first = mergeScanItem([], lookup("isbn_1", "9780000000001"));
  const second = mergeScanItem(first, lookup("isbn_1", "9780000000001"));
  assert.equal(second.length, 1);
  assert.equal(second[0].scan_count, 2);
  assert.deepEqual(sessionTotals(second), { uniqueCount: 1, copyCount: 2, committedCount: 0 });
});

test("commit operations persist one stable request ID per copy", () => {
  const ids = ["request-a", "request-b"];
  const item = prepareCommitOperations({ ...lookup("isbn_1", "9780000000001"), scan_count: 2 }, () => ids.shift());
  assert.deepEqual(item.commit_operations.map((operation) => operation.request_id), ["request-a", "request-b"]);
  assert.deepEqual(prepareCommitOperations(item, () => "unexpected").commit_operations, item.commit_operations);
});
```

- [ ] **Step 2: Run the helper tests and verify RED**

Run: `node --test tests/continuous-scan.test.js`

Expected: FAIL with `Cannot find module '../miniprogram/utils/continuous-scan'`.

- [ ] **Step 3: Implement the minimal pure helper module**

Implement and export:

```js
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
  if (index < 0) return items.concat({ ...lookup, scan_count: 1, committed_count: 0, commit_operations: [], status: "pending", error_message: "" });
  return items.map((item, itemIndex) => itemIndex === index ? { ...item, scan_count: item.scan_count + 1 } : item);
}
```

Also implement immutable `removeScanItem`, numeric `sessionTotals`, stable `prepareCommitOperations`, and `isAmbiguousCommitError` where missing/transport errors, `NETWORK_ERROR`, `REQUEST_IN_PROGRESS`, timeout, database, and internal errors are ambiguous.

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run: `node --test tests/continuous-scan.test.js`

Expected: all helper tests PASS.

- [ ] **Step 5: Commit the pure model**

```bash
git add tests/continuous-scan.test.js miniprogram/utils/continuous-scan.js
git commit -m "feat: add continuous scan session model"
```

### Task 2: Automatic scan loop and recoverable pending list

**Files:**
- Modify: `tests/frontend-behavior.test.js`
- Modify: `miniprogram/pages/add-book/index.js`

- [ ] **Step 1: Replace obsolete continuous-scan source assertions with failing behavior contracts**

Assert that the controller contains `startContinuousScan`, `stopContinuousScan`, `scheduleNextScan`, `removeScanItem`, and an 800ms feedback delay; assert that successful lookup merges `scanItems` and does not call `libraryService.addBook` inside the camera success stage. Assert that camera cancellation calls `stopContinuousScan`, that failures pause, and that 24-hour version-2 recovery restores `scanItems` without automatically reopening the camera.

- [ ] **Step 2: Run the frontend test and verify RED**

Run: `node --test tests/frontend-behavior.test.js`

Expected: FAIL because the new controller methods and delayed-write structure do not exist.

- [ ] **Step 3: Implement lifecycle-safe automatic scanning**

Update the controller to:

```js
const SUCCESS_FEEDBACK_MS = 800;

startContinuousScan() {
  if (this.data.submissionStarted || this.data.submitting) return;
  if (this.data.session.total >= 100) return this.stopContinuousScan("本轮已达到 100 次上限");
  this._autoScanning = true;
  this.scanContinuous();
},

scheduleNextScan() {
  this.clearScanTimer();
  this._scanTimer = setTimeout(() => {
    if (this._autoScanning && this._pageAlive && !this.data.submitting) this.scanContinuous();
  }, SUCCESS_FEEDBACK_MS);
}
```

Wrap `wx.scanCode` in a promise, enforce a `_scanOpening` lock, increment the attempt count once per non-cancel outcome, run the existing ISBN lookup/polling path, merge standard edition fields into `scanItems`, persist, show success, and schedule the next scan. Cancellation stops the loop and keeps the draft. A non-cancel failure calls `markScanFailure` and leaves the phase paused.

Implement a modal-confirmed `removeScanItem` that is disabled after submission begins. Add timer cleanup in `onHide`/`onUnload`, async lifecycle/session guards, version-2 cache restore, and cleanup of incompatible old cache.

- [ ] **Step 4: Run tests and syntax checks**

Run:

```bash
node --test tests/continuous-scan.test.js tests/frontend-behavior.test.js
node --check miniprogram/pages/add-book/index.js
```

Expected: PASS and no syntax output.

- [ ] **Step 5: Commit the scan loop**

```bash
git add tests/frontend-behavior.test.js miniprogram/pages/add-book/index.js
git commit -m "feat: collect continuous scans before confirmation"
```

### Task 3: Stable batch commit and optional shelf assignment

**Files:**
- Modify: `tests/continuous-scan.test.js`
- Modify: `tests/frontend-behavior.test.js`
- Modify: `miniprogram/pages/add-book/index.js`

- [ ] **Step 1: Add failing commit-flow tests**

Cover these contracts:

```js
test("ambiguous commit errors retain the stable request ID", () => {
  assert.equal(isAmbiguousCommitError({ code: "REQUEST_IN_PROGRESS" }), true);
  assert.equal(isAmbiguousCommitError({ code: "QUANTITY_LIMIT" }), false);
});
```

Add page assertions for explicit `createRequestId`, third-argument request ID reuse in `services.library`, `committed_count`, `processInChunks`, `listShelves`, `addBooks`, and no shelf write when `selectedShelf` is absent.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/continuous-scan.test.js tests/frontend-behavior.test.js`

Expected: FAIL on missing batch commit and shelf methods.

- [ ] **Step 3: Implement batch commit**

Add `chooseShelf`, `confirmBatch`, `commitCopy`, `commitPendingItems`, `addCommittedBooksToShelf`, `completeContinuousSession`, and `retryFailedItems`.

Before the first write, prepare all per-copy operations and persist them. For each incomplete operation call:

```js
await services.library("addBook", {
  edition_id: item.edition_id,
  quantity_delta: 1,
  scan_session_id: this.data.scanSessionId
}, operation.request_id);
```

On success mark the operation completed, increment `committed_count`, save `user_book_id`, persist, and track `added`/`duplicate`. On an ambiguous error keep the same request ID; on a definitive error mark failed, and generate a new ID only when the user explicitly retries. Continue other rows after one row fails.

When every copy is completed, re-fetch shelves. If a target exists, add unique `user_book_id` values in chunks of 50. If no shelf is selected, issue no shelf write. Clear the draft and return to `/pages/library/index` only after the required writes finish.

- [ ] **Step 4: Run tests and syntax checks**

Run:

```bash
node --test tests/continuous-scan.test.js tests/frontend-behavior.test.js
node --check miniprogram/pages/add-book/index.js
```

Expected: PASS.

- [ ] **Step 5: Commit batch persistence**

```bash
git add tests/continuous-scan.test.js tests/frontend-behavior.test.js miniprogram/pages/add-book/index.js
git commit -m "feat: confirm scanned books in a recoverable batch"
```

### Task 4: Same-page review UI

**Files:**
- Modify: `tests/frontend-behavior.test.js`
- Modify: `miniprogram/pages/add-book/index.wxml`
- Modify: `miniprogram/pages/add-book/index.wxss`

- [ ] **Step 1: Add failing template and style assertions**

Assert the template contains “开始扫码”, “选择书架（可选）”, “确认入馆”, scan-item removal, success and paused actions; assert it does not contain `mode === 'summary'`, “继续扫码”, “结束并查看汇总”, or “再扫一轮”. Assert the stylesheet has a fixed safe-area bottom action bar and a consistent cover host.

- [ ] **Step 2: Run the frontend test and verify RED**

Run: `node --test tests/frontend-behavior.test.js`

Expected: FAIL because the legacy summary interface remains.

- [ ] **Step 3: Build the review interface**

Use the existing paper/forest/vermillion tokens. Structure the continuous mode as:

```text
┌ 本轮 N 种 · M 册 ─────── 进度 / 100 ┐
│ scanning ticket / state banner      │
├ pending book row: cover, metadata, × │
├ pending book row: cover, metadata, × │
│ 开始扫码                             │
│ 选择书架（可选）             更换   │
└─────────────────────────────────────┘
╔ fixed safe-area bar: 确认入馆（M册） ╗
```

Use 96×128rpx cover hosts, one-line truncation for title/author, “本轮 N 册” as the only per-row badge, and vermillion only for removal/failure. Disable removal and scanning once submission begins. Show `重试扫码 / 手工录入 / 跳过并继续 / 结束扫码` in paused state. Keep one dominant fixed bottom action.

- [ ] **Step 4: Run template tests and JSON parsing**

Run:

```bash
node --test tests/frontend-behavior.test.js
node -e "JSON.parse(require('fs').readFileSync('miniprogram/pages/add-book/index.json','utf8'))"
```

Expected: PASS.

- [ ] **Step 5: Commit the interface**

```bash
git add tests/frontend-behavior.test.js miniprogram/pages/add-book/index.wxml miniprogram/pages/add-book/index.wxss
git commit -m "feat: redesign continuous scan review interface"
```

### Task 5: Product docs, visual review, and full verification

**Files:**
- Modify: `家庭数字绘本馆 V1.md`
- Modify: `家庭数字绘本馆 UI与Figma设计规范.md`
- Modify: `docs/ui-skill-visual-review.md`

- [ ] **Step 1: Update product and UI documents**

Replace immediate-add/summary wording with the final rules: auto-next after 800ms, cancellation ends scanning, same-page pending list, duplicate ISBN merge, delete-before-submit, unified confirmation, stable request IDs, partial retry, and optional one-shelf assignment after successful library writes.

- [ ] **Step 2: Record the frontend-design review**

Add the changed page states and results for hierarchy, real copy, empty/error/partial states, 320/375/430px behavior, safe area, restrained bookplate identity, and removal of template-like summary cards.

- [ ] **Step 3: Run the complete automated verification**

Run:

```bash
node --test tests/*.test.js
node scripts/check-project.js
node scripts/build-cloudfunctions.js
git diff --check
```

Expected: all tests pass, project check passes, cloud functions package, and no whitespace errors.

- [ ] **Step 4: Inspect the final diff and repository status**

Run:

```bash
git status --short
git diff --stat HEAD~3..HEAD
```

Expected: only intentional continuous-scan and documentation changes remain.

- [ ] **Step 5: Commit documentation**

```bash
git add "家庭数字绘本馆 V1.md" "家庭数字绘本馆 UI与Figma设计规范.md" docs/ui-skill-visual-review.md
git commit -m "docs: update continuous scan confirmation flow"
```

