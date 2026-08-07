const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");

test("Qiniu cover config maps regions and builds an HTTPS CDN URL", () => {
  const { regionUploadHost, buildCoverKey, buildPublicUrl } = require(path.join(root, "cloudfunctions/_shared/qiniu-cover"));
  assert.equal(regionUploadHost("z0"), "https://up-z0.qiniup.com");
  assert.equal(regionUploadHost("z1"), "https://up-z1.qiniup.com");
  const key = buildCoverKey("edition-covers/", "isbn_9787020024759", "jpg");
  assert.equal(key, "edition-covers/isbn_9787020024759.jpg");
  assert.equal(buildPublicUrl("https://static.irenduan.cn/", key), "https://static.irenduan.cn/edition-covers/isbn_9787020024759.jpg");
});

test("Qiniu cover config rejects insecure or malformed public domains", () => {
  const { buildPublicUrl } = require(path.join(root, "cloudfunctions/_shared/qiniu-cover"));
  assert.throws(() => buildPublicUrl("http://static.irenduan.cn", "edition-covers/a.jpg"), /HTTPS/);
  assert.throws(() => buildPublicUrl("https://static.irenduan.cn/path", "edition-covers/a.jpg"), /域名/);
});

test("edition summaries expose the direct CDN cover URL", () => {
  const { editionSummary } = require(path.join(root, "cloudfunctions/_shared/serializers"));
  const summary = editionSummary({
    _id: "isbn_9787020024759",
    title: "围城",
    cover_file_id: "",
    cover_url: "https://static.irenduan.cn/edition-covers/isbn_9787020024759.jpg"
  });
  assert.equal(summary.cover_url, "https://static.irenduan.cn/edition-covers/isbn_9787020024759.jpg");
});

test("library list aggregates shelf relations instead of counting each book", () => {
  const source = fs.readFileSync(path.join(root, "cloudfunctions/libraryService/index.js"), "utf8");
  assert.match(source, /bookshelf_books/);
  assert.match(source, /relationCountByBook/);
  assert.doesNotMatch(source, /items\.map\(\(item\)\) =>\s*ctx\.db\.collection\("bookshelf_books"\).*\.count\(\)/s);
});
