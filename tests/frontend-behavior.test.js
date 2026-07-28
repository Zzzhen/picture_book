const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");

test("ISBN normalization accepts valid ISBN-10/13 and rejects bad check digits", () => {
  const { normalizeIsbn, isValidIsbn } = require(path.join(root, "miniprogram/utils/isbn"));
  assert.equal(normalizeIsbn("978-7-5442-9092-0"), "9787544290920");
  assert.equal(isValidIsbn("9787544290920"), true);
  assert.equal(isValidIsbn("9787544290921"), false);
  assert.equal(isValidIsbn("7-5442-9092-1"), true);
});

test("manual entry requires only a title and keeps pending submissions editable", () => {
  const { validateManualBook } = require(path.join(root, "miniprogram/utils/validation"));
  assert.deepEqual(validateManualBook({ title: "无字书", author: "", isbn: "" }), {});
  const source = fs.readFileSync(path.join(root, "miniprogram/pages/manual-book-edit/index.js"), "utf8");
  assert.match(source, /reviewStatus === "rejected"/);
  assert.doesNotMatch(source, /disabled:\s*this\.data\.reviewStatus === "pending"/);
});

test("continuous scan has a 100-scan cap, 24-hour recovery, duplicate choice and failure metrics", () => {
  const source = fs.readFileSync(path.join(root, "miniprogram/pages/add-book/index.js"), "utf8");
  const template = fs.readFileSync(path.join(root, "miniprogram/pages/add-book/index.wxml"), "utf8");
  assert.match(source, />= 100/);
  assert.match(source, /24 \* 60 \* 60/);
  assert.match(source, /setStorageSync/);
  assert.match(source, /confirmDuplicate/);
  assert.match(source, /failures/);
  assert.match(template, /duplicate-choice/);
  assert.match(template, /失败/);
});

test("onboarding validation enforces all required child fields", () => {
  const { validateOnboarding } = require(path.join(root, "miniprogram/utils/validation"));
  assert.deepEqual(Object.keys(validateOnboarding({})).sort(), [
    "birthMonth",
    "gender",
    "nickname"
  ]);
  assert.deepEqual(
    validateOnboarding({
      nickname: "依依",
      birthMonth: "2022-06",
      gender: "female",
      libraryName: "依依的绘本馆"
    }),
    {}
  );
});

test("API client always sends a UUID requestId and unwraps successful data", async () => {
  let input;
  global.wx = {
    cloud: {
      callFunction(options) {
        input = options;
        return Promise.resolve({
          result: { ok: true, code: "OK", data: { ready: true }, requestId: options.data.requestId }
        });
      }
    }
  };
  delete require.cache[require.resolve(path.join(root, "miniprogram/services/api"))];
  const { callService } = require(path.join(root, "miniprogram/services/api"));
  const data = await callService("userService", "bootstrap", {});
  assert.deepEqual(data, { ready: true });
  assert.match(input.data.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("all route scripts register substantive page controllers", () => {
  const routes = {
    bootstrap: ["bootstrap", "retry"],
    onboarding: ["next", "onNickname"],
    library: ["loadBooks", "goAddBook", "onViewChange"],
    "add-book": ["scan", "lookup", "scanContinuous"],
    "book-confirm": ["confirmAdd", "onQuantity"],
    "book-detail": ["loadBook", "onPreference", "deleteBook"],
    bookshelves: ["loadShelves", "createShelf"],
    "bookshelf-detail": ["loadShelf", "editShelf"],
    "bookshelf-edit": ["loadEditor", "save", "toggleBook"],
    "manual-book-edit": ["loadSubmission", "submit", "chooseCover"],
    profile: ["loadProfile", "editProfile", "requestDeletion"],
    "profile-edit": ["loadProfile", "save", "onGender"],
    feedback: ["submit", "chooseType"],
    admin: ["loadQueue", "approve", "resolveConflict"]
  };

  for (const [route, methods] of Object.entries(routes)) {
    let definition;
    global.Page = (value) => { definition = value; };
    delete require.cache[require.resolve(path.join(root, `miniprogram/pages/${route}/index.js`))];
    require(path.join(root, `miniprogram/pages/${route}/index.js`));
    assert.ok(definition, `${route} did not register Page`);
    for (const method of methods) {
      assert.equal(typeof definition[method], "function", `${route}.${method} is missing`);
    }
  }
});
