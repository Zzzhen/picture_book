const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "package.json",
  "project.config.json",
  "miniprogram/app.js",
  "miniprogram/app.json",
  "miniprogram/app.wxss",
  "miniprogram/config/env.js",
  "miniprogram/services/api.js",
  "miniprogram/pages/bootstrap/index.js",
  "miniprogram/pages/onboarding/index.js",
  "miniprogram/pages/library/index.js",
  "miniprogram/pages/daily-pick/index.js",
  "miniprogram/pages/daily-pick/index.json",
  "miniprogram/pages/daily-pick/index.wxml",
  "miniprogram/pages/daily-pick/index.wxss",
  "miniprogram/pages/add-book/index.js",
  "miniprogram/pages/book-confirm/index.js",
  "miniprogram/pages/book-detail/index.js",
  "miniprogram/pages/bookshelves/index.js",
  "miniprogram/pages/bookshelf-detail/index.js",
  "miniprogram/pages/bookshelf-edit/index.js",
  "miniprogram/pages/bookshelf-book-picker/index.js",
  "miniprogram/pages/bookshelf-book-picker/index.json",
  "miniprogram/pages/bookshelf-book-picker/index.wxml",
  "miniprogram/pages/bookshelf-book-picker/index.wxss",
  "miniprogram/pages/manual-book-edit/index.js",
  "miniprogram/pages/profile/index.js",
  "miniprogram/pages/profile-edit/index.js",
  "miniprogram/pages/feedback/index.js",
  "miniprogram/pages/admin/index.js",
  "cloudfunctions/userService/index.js",
  "cloudfunctions/bookService/index.js",
  "cloudfunctions/libraryService/index.js",
  "cloudfunctions/bookshelfService/index.js",
  "cloudfunctions/eventService/index.js",
  "cloudfunctions/adminService/index.js",
  "cloudfunctions/shareService/index.js",
  "cloudfunctions/maintenanceService/index.js",
  "database/collections.md",
  "database/indexes.md",
  "database/database-security-rules.md",
  "database/function-security-rules.md",
  "README.md",
  "miniprogram/pages/shared-shelf/index.js",
  "miniprogram/pages/shared-shelf/index.json",
  "miniprogram/pages/shared-shelf/index.wxml",
  "miniprogram/pages/shared-shelf/index.wxss",
];

test("V1-Core scaffold contains every required route and cloud function", () => {
  const missing = requiredFiles.filter(
    (file) => !fs.existsSync(path.join(root, file)),
  );
  assert.deepEqual(missing, []);
});

test("shared shelf route and cloud function are scaffolded", () => {
  assert.equal(fs.existsSync(path.join(root, "cloudfunctions/shareService")), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "miniprogram/app.json"), "utf8")).pages.includes("pages/shared-shelf/index"), true);
});
