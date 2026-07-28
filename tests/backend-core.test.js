const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const shared = (name) => require(path.join(root, "cloudfunctions/_shared", name));

test("HMAC user IDs and relationship IDs are deterministic without exposing OPENID", () => {
  const { userIdFromOpenId, deterministicId } = shared("identity");
  const first = userIdFromOpenId("openid-secret-value", "unit-test-key");
  const second = userIdFromOpenId("openid-secret-value", "unit-test-key");
  assert.equal(first, second);
  assert.match(first, /^u_v1_[0-9a-f]{64}$/);
  assert.equal(first.includes("openid-secret-value"), false);
  assert.equal(
    deterministicId("user_book", ["u_1", "isbn_1"]),
    deterministicId("user_book", ["u_1", "isbn_1"])
  );
});

test("strict request validation rejects bad UUIDs, unknown actions and undeclared fields", () => {
  const { validateEnvelope } = shared("schema");
  const specs = { read: { fields: ["cursor"], write: false } };
  assert.throws(
    () => validateEnvelope({ action: "missing", payload: {}, requestId: crypto.randomUUID() }, specs),
    (error) => error.code === "ACTION_NOT_FOUND"
  );
  assert.throws(
    () => validateEnvelope({ action: "read", payload: { surprise: true }, requestId: crypto.randomUUID() }, specs),
    (error) => error.code === "INVALID_ARGUMENT"
  );
  assert.throws(
    () => validateEnvelope({ action: "read", payload: {}, requestId: "not-a-uuid" }, specs),
    (error) => error.code === "INVALID_ARGUMENT"
  );
});

test("signed cursors round-trip and cannot be reused with changed filters", () => {
  const { encodeCursor, decodeCursor } = shared("cursor");
  const secret = "cursor-test-secret";
  const value = encodeCursor({ value: "2026-07-28T00:00:00.000Z", id: "book_1" }, { action: "listBooks", owner: "u_1", filter: "newest" }, secret);
  assert.deepEqual(
    decodeCursor(value, { action: "listBooks", owner: "u_1", filter: "newest" }, secret),
    { value: "2026-07-28T00:00:00.000Z", id: "book_1" }
  );
  assert.throws(
    () => decodeCursor(value, { action: "listBooks", owner: "u_1", filter: "oldest" }, secret),
    (error) => error.code === "INVALID_CURSOR"
  );
});

test("search normalization and tokens are bounded and stable", () => {
  const { normalizeSearchText, buildSearchFields } = shared("search");
  assert.equal(normalizeSearchText("  ＡＢＣ  猜猜我  "), "abc 猜猜我");
  const fields = buildSearchFields(["猜猜我有多爱你", "Sam McBratney", "少年儿童出版社", "9787544290920"]);
  assert.ok(fields.search_prefixes.includes("猜猜我"));
  assert.ok(fields.search_tokens.includes("9787544290920"));
  assert.ok(fields.search_prefixes.length <= 60);
  assert.ok(fields.search_tokens.length <= 100);
});

test("cover URL policy rejects non-HTTPS and private network targets", () => {
  const { validateCoverUrl, isPrivateIp } = shared("cover-security");
  assert.throws(() => validateCoverUrl("http://example.com/cover.jpg", ["example.com"]), (error) => error.code === "UNSAFE_COVER_URL");
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("10.4.5.6"), true);
  assert.equal(isPrivateIp("100.64.0.1"), true);
  assert.equal(isPrivateIp("198.51.100.10"), true);
  assert.equal(isPrivateIp("203.0.113.9"), true);
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateIp("2001:db8::1"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(validateCoverUrl("https://img.example.com/cover.jpg", ["example.com"]).hostname, "img.example.com");
  assert.throws(
    () => validateCoverUrl("https://attacker.example.net/cover.jpg", ["example.com"]),
    (error) => error.code === "UNSAFE_COVER_URL"
  );
});

test("cover dimensions enforce 6000px edge and 24MP product limits", () => {
  const { validateDimensions } = shared("cover-transfer");
  assert.deepEqual(validateDimensions({ width: 4000, height: 6000 }), { width: 4000, height: 6000 });
  assert.throws(() => validateDimensions({ width: 6001, height: 100 }), (error) => error.code === "UNSAFE_COVER_FILE");
  assert.throws(() => validateDimensions({ width: 5000, height: 5000 }), (error) => error.code === "UNSAFE_COVER_FILE");
});

test("manual review state machine enforces rejection reason and terminal states", () => {
  const { applyReviewDecision } = shared("review");
  assert.throws(
    () => applyReviewDecision({ status: "pending" }, { decision: "reject", rejection_reason: "" }, "admin_1"),
    (error) => error.code === "INVALID_ARGUMENT"
  );
  const rejected = applyReviewDecision({ status: "pending" }, { decision: "reject", rejection_reason: "封面与书名不一致" }, "admin_1");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.rejection_reason, "封面与书名不一致");
  assert.throws(
    () => applyReviewDecision({ status: "approved" }, { decision: "reject", rejection_reason: "x" }, "admin_1"),
    (error) => error.code === "INVALID_STATE"
  );
});

test("20 concurrent identical ISBN lookups call the provider once", async () => {
  const { createLookupCoordinator } = shared("isbn-coordinator");
  let providerCalls = 0;
  const coordinator = createLookupCoordinator({
    ttlMs: 60_000,
    provider: async (isbn) => {
      providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { isbn13: isbn, title: "测试绘本" };
    }
  });
  const results = await Promise.all(Array.from({ length: 20 }, () => coordinator.lookup("9787544290920")));
  assert.equal(providerCalls, 1);
  assert.equal(results.every((result) => result.edition.title === "测试绘本"), true);
  assert.equal(results.slice(1).every((result) => result.cache_hit), true);
});

test("ISBN conflict migration preserves preference, notes and earliest creation time", () => {
  const { mergeUserBookRecords } = require(path.join(root, "cloudfunctions/adminService/index"));
  const merged = mergeUserBookRecords(
    {
      quantity: 2,
      preference: "recommended",
      private_note: "常在睡前读",
      created_at: new Date("2025-01-02T00:00:00Z")
    },
    {
      quantity: 3,
      preference: "neutral",
      private_note: "孩子会跟读",
      created_at: new Date("2024-01-02T00:00:00Z")
    }
  );
  assert.equal(merged.quantity, 5);
  assert.equal(merged.preference, "recommended");
  assert.match(merged.private_note, /常在睡前读[\s\S]*来自手工录入[\s\S]*孩子会跟读/);
  assert.equal(merged.created_at.toISOString(), "2024-01-02T00:00:00.000Z");
});
