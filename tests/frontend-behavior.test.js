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

test("API client consumes the WeChat getRandomValues result instead of replaying an all-zero requestId", () => {
  global.wx = {
    getRandomValues({ length }) {
      return { randomValues: Uint8Array.from({ length }, (_, index) => index + 1) };
    }
  };
  delete require.cache[require.resolve(path.join(root, "miniprogram/services/api"))];
  const { createRequestId } = require(path.join(root, "miniprogram/services/api"));
  const requestId = createRequestId();
  assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(requestId, "00000000-0000-4000-8000-000000000000");
});

test("add-book opens only one confirmation page for the same completed lookup", () => {
  let definition;
  let navigationCount = 0;
  global.Page = (value) => { definition = value; };
  global.wx = { navigateTo() { navigationCount += 1; } };
  delete require.cache[require.resolve(path.join(root, "miniprogram/pages/add-book/index.js"))];
  require(path.join(root, "miniprogram/pages/add-book/index.js"));
  const page = { _confirmationOpening: false };
  const result = { edition: { edition_id: "isbn_1", isbn13: "9787551171489" }, cache_hit: false };
  definition.navigateToConfirmation.call(page, result);
  definition.navigateToConfirmation.call(page, result);
  assert.equal(navigationCount, 1);
});

test("confirmation and detail pages map normalized price and page count", () => {
  const confirmation = fs.readFileSync(path.join(root, "miniprogram/pages/book-confirm/index.js"), "utf8");
  const detail = fs.readFileSync(path.join(root, "miniprogram/pages/book-detail/index.js"), "utf8");
  assert.match(confirmation, /priceText:\s*edition\.price_text/);
  assert.match(confirmation, /pageCount:\s*edition\.page_count_text/);
  assert.match(detail, /priceText:\s*edition\.price_text/);
  assert.match(detail, /pageCount:\s*edition\.page_count_text/);
});

test("library cover mapping resolves cloud file IDs into temporary image URLs", async () => {
  global.wx = {
    cloud: {
      getTempFileURL({ fileList, success }) {
        success({ fileList: [{ fileID: fileList[0], tempFileURL: "https://tmp.example/cover.jpg" }] });
      }
    }
  };
  delete require.cache[require.resolve(path.join(root, "miniprogram/utils/cloud-file"))];
  const { getTempFileUrl } = require(path.join(root, "miniprogram/utils/cloud-file"));
  assert.equal(await getTempFileUrl("cloud://library/edition-cover.jpg"), "https://tmp.example/cover.jpg");
  assert.equal(await getTempFileUrl("https://cdn.example/cover.jpg"), "https://cdn.example/cover.jpg");
});

test("book detail stays editable and saves without a header edit mode", () => {
  const source = fs.readFileSync(path.join(root, "miniprogram/pages/book-detail/index.wxml"), "utf8");
  assert.doesNotMatch(source, /slot="action"/);
  assert.doesNotMatch(source, /disabled="\{\{!editing\}\}"/);
  assert.match(source, /bind:tap="saveBook"/);
  const controller = fs.readFileSync(path.join(root, "miniprogram/pages/book-detail/index.js"), "utf8");
  assert.match(controller, /saveBook\s*\(/);
  assert.doesNotMatch(controller, /toggleEdit\s*\(/);
});

test("library book cards constrain every cover to the same grid ratio", () => {
  const cardStyles = fs.readFileSync(path.join(root, "miniprogram/components/book-card/index.wxss"), "utf8");
  assert.match(cardStyles, /\.book-card__cover\s*\{[\s\S]*?width:\s*100%;[\s\S]*?aspect-ratio:\s*3\s*\/\s*4;/);
  assert.match(cardStyles, /\.book-card__cover\s+book-cover\s*\{[\s\S]*?display:\s*block;[\s\S]*?width:\s*100%;/);
});

test("book confirmation guards against duplicate add submissions", () => {
  const source = fs.readFileSync(path.join(root, "miniprogram/pages/book-confirm/index.js"), "utf8");
  assert.match(source, /async confirmAdd\(\)\s*\{\s*if \(this\.data\.submitting\) return;/);
});

test("bookshelf editor keeps save action below the form instead of in the header", () => {
  const source = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-edit/index.wxml"), "utf8");
  assert.doesNotMatch(source, /slot="action"/);
  assert.match(source, /class="shelf-edit__actions"[\s\S]*bind:tap="save"/);
});

test("bookshelf editor actions stay visible as a floating bottom bar", () => {
  const styles = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-edit/index.wxss"), "utf8");
  assert.match(styles, /\.shelf-edit__actions\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*0;[\s\S]*?z-index:/);
  assert.match(styles, /\.shelf-edit\s*\{[\s\S]*?padding-bottom:\s*calc\(\d+rpx\s*\+\s*env\(safe-area-inset-bottom\)\)/);
});

test("bookshelf detail keeps edit action below the header", () => {
  const source = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-detail/index.wxml"), "utf8");
  assert.doesNotMatch(source, /slot="action"/);
  assert.match(source, /class="shelf-detail__toolbar"[\s\S]*bindtap="editShelf"/);
});

test("library uses a three-column book grid at normal phone widths", () => {
  const styles = fs.readFileSync(path.join(root, "miniprogram/pages/library/index.wxss"), "utf8");
  assert.match(styles, /\.library__grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
});

test("bookshelf detail constrains its book grid and card hosts", () => {
  const styles = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-detail/index.wxss"), "utf8");
  assert.match(styles, /\.shelf-detail__grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(styles, /\.shelf-detail__grid\s+book-card\s*\{[\s\S]*?display:\s*block;[\s\S]*?min-width:\s*0;/);
});

test("continuous scanning cannot overlap and canceling the camera keeps the session open", () => {
  const source = fs.readFileSync(path.join(root, "miniprogram/pages/add-book/index.js"), "utf8");
  assert.match(source, /async scanContinuous\(\)\s*\{\s*if \(this\.data\.scanState === "scanning"\) return;/);
  assert.match(source, /if \(String\(error\.errMsg \|\| ""\)\.includes\("cancel"\)\) \{\s*this\.setData\(\{ scanState: "idle", scanError: "" \}\);/);
  assert.doesNotMatch(source, /includes\("cancel"\)\) \{\s*this\.finishContinuous\(\);/);
  assert.match(source, /scanState: saved\.scanState === "scanning" \? "idle" : saved\.scanState \|\| "idle"/);
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
