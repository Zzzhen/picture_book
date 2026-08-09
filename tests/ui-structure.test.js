const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pages = [
  "bootstrap",
  "onboarding",
  "library",
  "add-book",
  "book-confirm",
  "book-detail",
  "bookshelves",
  "bookshelf-detail",
  "shared-shelf",
  "bookshelf-edit",
  "manual-book-edit",
  "profile",
  "profile-edit",
  "feedback",
  "admin",
];
const components = [
  "app-header",
  "ui-button",
  "icon-button",
  "bookplate-mark",
  "search-field",
  "text-field",
  "book-cover",
  "book-card",
  "book-list-item",
  "bookshelf-card",
  "empty-state",
  "skeleton",
  "status-banner",
  "toast",
  "bottom-sheet",
  "confirm-dialog",
  "segmented-control",
  "preference-picker",
  "quantity-stepper",
  "metric-card",
];

test("design system files and all page templates exist", () => {
  const expected = [
    "miniprogram/styles/tokens.wxss",
    "miniprogram/styles/typography.wxss",
    "miniprogram/styles/animations.wxss",
    "miniprogram/custom-tab-bar/index.js",
    "miniprogram/custom-tab-bar/index.json",
    "miniprogram/custom-tab-bar/index.wxml",
    "miniprogram/custom-tab-bar/index.wxss",
  ];
  for (const component of components) {
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      expected.push(`miniprogram/components/${component}/index.${extension}`);
    }
  }
  for (const page of pages) {
    for (const extension of ["json", "wxml", "wxss"]) {
      expected.push(`miniprogram/pages/${page}/index.${extension}`);
    }
  }
  const missing = expected.filter(
    (file) => !fs.existsSync(path.join(root, file)),
  );
  assert.deepEqual(missing, []);
});

test("all miniprogram JSON files parse", () => {
  const files = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      if (entry.isFile() && entry.name.endsWith(".json")) files.push(fullPath);
    }
  };
  walk(path.join(root, "miniprogram"));
  for (const file of files) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")), file);
  }
});

test("brand tokens and responsive book grid are declared", () => {
  const tokensPath = path.join(root, "miniprogram/styles/tokens.wxss");
  const libraryPath = path.join(root, "miniprogram/pages/library/index.wxss");
  assert.equal(fs.existsSync(tokensPath), true);
  assert.equal(fs.existsSync(libraryPath), true);
  const tokens = fs.readFileSync(tokensPath, "utf8");
  const library = fs.readFileSync(libraryPath, "utf8");
  assert.match(tokens, /--color-brand-forest:\s*#315a45/i);
  assert.match(tokens, /--color-accent-terracotta:\s*#c96e50/i);
  assert.match(library, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(library, /@media\s*\(max-width:\s*327px\)/);
});

test("component styles avoid unsupported attribute selectors", () => {
  for (const component of components) {
    const stylesheet = fs.readFileSync(
      path.join(root, `miniprogram/components/${component}/index.wxss`),
      "utf8"
    );
    assert.doesNotMatch(stylesheet, /\[[^\]]+\]/, component);
  }
});
