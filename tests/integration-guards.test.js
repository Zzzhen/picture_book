const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("user service account-state policy is action specific", () => {
  const { allowedStatusesFor } = require(path.join(root, "cloudfunctions/_shared/cloud"));
  assert.deepEqual(allowedStatusesFor("userService", "bootstrap"), ["active", "disabled", "deleting", "deleted"]);
  assert.deepEqual(allowedStatusesFor("userService", "restartDeletedAccount"), ["deleted"]);
  assert.deepEqual(allowedStatusesFor("userService", "getProfile"), ["active", "deleting"]);
  assert.deepEqual(allowedStatusesFor("userService", "updateProfile"), ["active"]);
  assert.deepEqual(allowedStatusesFor("eventService", "trackBatch"), ["active", "disabled", "deleting"]);
  assert.deepEqual(allowedStatusesFor("libraryService", "listBooks"), ["active"]);
});

test("Aliyun provider endpoint must be HTTPS", () => {
  const { validateProviderEndpoint } = require(path.join(root, "cloudfunctions/_shared/provider"));
  assert.throws(() => validateProviderEndpoint("http://example.com/isbn"), (error) => error.code === "SERVER_MISCONFIGURED");
  assert.equal(validateProviderEndpoint("https://example.com/isbn").protocol, "https:");
});

test("Aliyun provider uses the documented POST form request and details[0] payload", () => {
  const { buildProviderRequest, normalizeProviderResponse } = require(path.join(root, "cloudfunctions/_shared/provider"));
  const request = buildProviderRequest(
    "https://jmisbn.market.alicloudapi.com/isbn/query",
    "9787555357902",
    "secret"
  );
  assert.equal(request.url.toString(), "https://jmisbn.market.alicloudapi.com/isbn/query");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "APPCODE secret");
  assert.match(request.options.headers["Content-Type"], /application\/x-www-form-urlencoded/);
  assert.equal(request.options.body, "isbn=9787555357902");

  const normalized = normalizeProviderResponse("9787555357902", {
    code: 200,
    msg: "成功",
    taskNo: "task-1",
    data: {
      details: [{
        title: "一粒种子的旅行",
        author: "安妮·默勒",
        publisher: "南海出版公司",
        pubDate: "2010-11",
        img: "https://img.example.com/cover.jpg",
        page: "36",
        binding: "精装"
      }]
    }
  });
  assert.equal(normalized.title, "一粒种子的旅行");
  assert.equal(normalized.contributors_text, "安妮·默勒");
  assert.equal(normalized.publish_date_text, "2010-11");
  assert.equal(normalized.page_count_text, "36");
  assert.equal(normalized.provider_task_no, "task-1");
});

test("Aliyun provider maps documented business codes before normalization", () => {
  const { interpretProviderBody } = require(path.join(root, "cloudfunctions/_shared/provider"));
  assert.equal(interpretProviderBody("9787555357902", { code: 200, data: { details: [] } }), null);
  assert.throws(
    () => interpretProviderBody("9787555357902", { code: 400, msg: "参数错误" }),
    (error) => error.code === "ISBN_PROVIDER_BAD_REQUEST" && error.retryable === false
  );
  assert.throws(
    () => interpretProviderBody("9787555357902", { code: 500, msg: "维护中" }),
    (error) => error.code === "ISBN_PROVIDER_UNAVAILABLE" && error.retryable === true
  );
  assert.throws(
    () => interpretProviderBody("9787555357902", { code: 999, msg: "其他错误" }),
    (error) => error.code === "ISBN_PROVIDER_UNAVAILABLE" && error.retryable === false
  );
});

test("non-retryable idempotency failures cannot be executed again", () => {
  const {
    idempotencyDisposition,
    encryptIdempotencyResult,
    decryptIdempotencyResult
  } = require(path.join(root, "cloudfunctions/_shared/cloud"));
  assert.deepEqual(idempotencyDisposition({ status: "completed", result: { saved: true } }), { type: "replay", result: { saved: true } });
  assert.deepEqual(idempotencyDisposition({ status: "failed_retryable" }), { type: "retry" });
  assert.throws(() => idempotencyDisposition({ status: "processing" }), (error) => error.code === "REQUEST_IN_PROGRESS");
  assert.throws(() => idempotencyDisposition({ status: "failed" }), (error) => error.code === "REQUEST_ALREADY_FAILED");
  const sensitive = { child: { birth_year_month: "2020-08" }, private_note: "只在家里看的备注" };
  const encrypted = encryptIdempotencyResult(sensitive, "unit-test-secret");
  assert.equal(JSON.stringify(encrypted).includes("2020-08"), false);
  assert.ok(Buffer.byteLength(JSON.stringify(encrypted)) < 4096);
  assert.deepEqual(decryptIdempotencyResult(encrypted, "unit-test-secret"), sensitive);
});

test("manual cover validation rejects disguised and oversized files before security API", () => {
  const { validateImageBuffer } = require(path.join(root, "cloudfunctions/_shared/content-security"));
  assert.throws(() => validateImageBuffer(Buffer.from("not-an-image")), (error) => error.code === "INVALID_COVER_FILE");
  assert.throws(() => validateImageBuffer(Buffer.alloc(5 * 1024 * 1024 + 1)), (error) => error.code === "COVER_TOO_LARGE");
});

test("account deletion drains every batch instead of stopping at 100 records", async () => {
  const { drainBatches, deletionRetryState } = require(path.join(root, "cloudfunctions/_shared/deletion"));
  const remaining = Array.from({ length: 230 }, (_, index) => ({ _id: `row_${index}` }));
  const removed = [];
  const count = await drainBatches(
    async () => remaining.slice(0, 100),
    async (row) => {
      removed.push(row._id);
      remaining.splice(remaining.findIndex((item) => item._id === row._id), 1);
    }
  );
  assert.equal(count, 230);
  assert.equal(remaining.length, 0);

  const now = new Date("2026-07-28T00:00:00.000Z");
  const deadline = new Date("2026-07-29T00:00:00.000Z");
  const retry = deletionRetryState(3, now, deadline);
  assert.equal(retry.status, "pending");
  assert.equal(retry.attempt_count, 4);
  assert.ok(retry.next_attempt_at > now && retry.next_attempt_at <= deadline);
});

test("cached-library search is reachable and manual resubmit keeps the edition ID", () => {
  const addWxml = fs.readFileSync(path.join(root, "miniprogram/pages/add-book/index.wxml"), "utf8");
  const detailJs = fs.readFileSync(path.join(root, "miniprogram/pages/book-detail/index.js"), "utf8");
  const manualJs = fs.readFileSync(path.join(root, "miniprogram/pages/manual-book-edit/index.js"), "utf8");
  assert.match(addWxml, /data-mode="cache-search"/);
  assert.match(detailJs, /editionId=/);
  assert.match(manualJs, /editionId:\s*query\.editionId/);
});

test("ISBN lookup waits on an existing 60-second lock instead of firing another provider call", () => {
  const addJs = fs.readFileSync(path.join(root, "miniprogram/pages/add-book/index.js"), "utf8");
  assert.match(addJs, /getLookupStatus/);
  assert.match(addJs, /BOOK_LOOKUP_IN_PROGRESS/);
  assert.match(addJs, /\[800,\s*1600,\s*2400\]/);
});

test("ISBN lookup commits only while it owns the exact active lock", () => {
  const { ownsLookupLock } = require(path.join(root, "cloudfunctions/bookService/index"));
  assert.equal(ownsLookupLock({ status: "querying", lock_token: "lock-a" }, "lock-a"), true);
  assert.equal(ownsLookupLock({ status: "querying", lock_token: "lock-b" }, "lock-a"), false);
  assert.equal(ownsLookupLock({ status: "found", lock_token: "lock-a" }, "lock-a"), false);
});

test("manual form does not promise fields absent from the strict cloud contract", () => {
  const manualWxml = fs.readFileSync(path.join(root, "miniprogram/pages/manual-book-edit/index.wxml"), "utf8");
  assert.doesNotMatch(manualWxml, /出版时间（可选）/);
  assert.doesNotMatch(manualWxml, /简介（可选）/);
});

test("preference component uses only section 15 enum values", () => {
  let definition;
  global.Component = (value) => { definition = value; };
  const file = path.join(root, "miniprogram/components/preference-picker/index.js");
  delete require.cache[require.resolve(file)];
  require(file);
  assert.deepEqual(definition.data.options.map((item) => item.value), [
    "recommended",
    "neutral",
    "not_recommended",
    "unmarked"
  ]);
});

test("bookshelf limits and relation counts are enforced by cloud code", () => {
  const shelfSource = fs.readFileSync(path.join(root, "cloudfunctions/bookshelfService/index.js"), "utf8");
  const librarySource = fs.readFileSync(path.join(root, "cloudfunctions/libraryService/index.js"), "utf8");
  assert.match(shelfSource, /count\.total >= 50/);
  assert.match(shelfSource, /book_count[^;\n]*500|500[^;\n]*book_count/);
  assert.match(librarySource, /book_count/);
  assert.match(librarySource, /bookshelf_books/);
});

test("administrator cover retry performs a real secured transfer", () => {
  const source = fs.readFileSync(path.join(root, "cloudfunctions/adminService/index.js"), "utf8");
  assert.match(source, /transferCover/);
  assert.match(source, /cover_origin_url/);
  assert.match(source, /cover_file_id/);
});
