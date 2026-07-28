const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("database, migration, build and UI review artifacts exist", () => {
  const files = [
    "database/indexes.json",
    "database/security-rules.json",
    "database/migrations/001-initial.js",
    "database/migrations/001-rollback.md",
    "scripts/run-tests.js",
    "scripts/check-project.js",
    "scripts/build-cloudfunctions.js",
    "docs/ui-skill-visual-review.md"
  ];
  assert.deepEqual(files.filter((file) => !fs.existsSync(path.join(root, file))), []);
});

test("database JSON artifacts parse and do not expose client writes", () => {
  const indexes = JSON.parse(fs.readFileSync(path.join(root, "database/indexes.json"), "utf8"));
  const rules = JSON.parse(fs.readFileSync(path.join(root, "database/security-rules.json"), "utf8"));
  assert.ok(indexes.collections.length >= 12);
  assert.equal(rules.default.read, false);
  assert.equal(rules.default.write, false);
});

test("README documents all required real-world setup and recovery steps", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  for (const phrase of [
    "USER_ID_SECRET",
    "ALIYUN_ISBN_APPCODE",
    "ALIYUN_ISBN_ENDPOINT",
    "微信开发者工具",
    "定时触发器",
    "回滚",
    "备份",
    "恢复",
    "真机验收"
  ]) {
    assert.ok(readme.includes(phrase), `README missing ${phrase}`);
  }
});
