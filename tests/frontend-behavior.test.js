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

test("continuous scan has a 100-scan cap, 24-hour versioned recovery and delayed writes", () => {
  const source = fs.readFileSync(path.join(root, "miniprogram/pages/add-book/index.js"), "utf8");
  assert.match(source, />= 100/);
  assert.match(source, /24 \* 60 \* 60/);
  assert.match(source, /SESSION_VERSION/);
  assert.match(source, /setStorageSync/);
  assert.match(source, /startContinuousScan/);
  assert.match(source, /stopContinuousScan/);
  assert.match(source, /scheduleNextScan/);
  assert.match(source, /SUCCESS_FEEDBACK_MS\s*=\s*800/);
  assert.match(source, /scanItems/);
  assert.match(source, /failures/);
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

test("book confirmation hides the cache-hit informational banner", () => {
  const template = fs.readFileSync(path.join(root, "miniprogram/pages/book-confirm/index.wxml"), "utf8");
  assert.doesNotMatch(template, /已从书库找到/);
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

test("library page uses the persisted Qiniu cover URL without per-book temp URL calls", () => {
  const script = fs.readFileSync(path.join(root, "miniprogram/pages/library/index.js"), "utf8");
  assert.match(script, /cover_url/);
  assert.doesNotMatch(script, /getTempFileUrl/);
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

test("book detail deletion is single-flight and returns to the previous page", async () => {
  let definition;
  let deleteCalls = 0;
  let resolveDelete;
  let backCalls = 0;
  let relaunchCalls = 0;
  let refreshMarker;
  global.Page = (value) => { definition = value; };
  global.wx = {
    setStorageSync(key, value) { if (key === "v1_core_library_needs_refresh") refreshMarker = value; },
    navigateBack() { backCalls += 1; },
    reLaunch() { relaunchCalls += 1; },
    showToast() {}
  };
  const apiPath = path.join(root, "miniprogram/services/api");
  const pagePath = path.join(root, "miniprogram/pages/book-detail/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const { services } = require(apiPath);
  const originalLibrary = services.library;
  services.library = async () => {
    deleteCalls += 1;
    await new Promise((resolve) => { resolveDelete = resolve; });
    return {};
  };
  const page = {
    ...definition,
    data: { ...JSON.parse(JSON.stringify(definition.data)), id: "book_1" },
    setData(next) { this.data = { ...this.data, ...next }; }
  };
  try {
    const first = page.deleteBook();
    const second = page.deleteBook();
    await Promise.resolve();
    assert.equal(deleteCalls, 1);
    resolveDelete();
    await Promise.all([first, second]);
    assert.equal(backCalls, 1);
    assert.equal(relaunchCalls, 0);
    assert.ok(refreshMarker);
  } finally {
    services.library = originalLibrary;
  }
});

test("library refreshes once when returning from a completed deletion", () => {
  let definition;
  let removed = 0;
  let refreshCalls = 0;
  let marker = Date.now();
  global.Page = (value) => { definition = value; };
  global.wx = {
    getStorageSync(key) { return key === "v1_core_library_needs_refresh" ? marker : null; },
    removeStorageSync(key) { if (key === "v1_core_library_needs_refresh") { removed += 1; marker = null; } },
    stopPullDownRefresh() {},
    getTabBar() { return null; }
  };
  const pagePath = path.join(root, "miniprogram/pages/library/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    loadBooks(reset) { if (reset) refreshCalls += 1; },
    setData(next) { this.data = { ...this.data, ...next }; }
  };
  page.onShow();
  page.onShow();
  assert.equal(removed, 1);
  assert.equal(refreshCalls, 1);
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

test("bookshelf editor changes metadata only and never edits book relations", () => {
  const script = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-edit/index.js"), "utf8");
  const template = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-edit/index.wxml"), "utf8");
  assert.doesNotMatch(script, /listBooks|listShelfBooks|addBooks|removeBooks|toggleBook|toggleAll/);
  assert.doesNotMatch(template, /search-field|book-list-item|选择绘本|全选/);
  assert.match(template, /书架名称/);
  assert.match(template, /说明（可选）/);
  assert.match(template, /bind:tap="save"/);
  assert.match(template, /bind:tap="askDelete"/);
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

test("daily book picker is frontend-only, remembers today and cleans up motion sensors", () => {
  const script = fs.readFileSync(path.join(root, "miniprogram/components/daily-book-picker/index.js"), "utf8");
  const template = fs.readFileSync(path.join(root, "miniprogram/pages/library/index.wxml"), "utf8");
  const styles = fs.readFileSync(path.join(root, "miniprogram/components/daily-book-picker/index.wxss"), "utf8");
  assert.match(template, /<daily-book-picker/);
  assert.match(script, /DAILY_PICK_PREFIX/);
  assert.match(script, /setStorageSync/);
  assert.match(script, /startAccelerometer/);
  assert.match(script, /offAccelerometerChange/);
  assert.match(script, /stopAccelerometer/);
  assert.match(script, /preference !== "not_recommended"/);
  assert.match(script, /reviewStatus !== "pending"/);
  assert.match(script, /reviewStatus !== "rejected"/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("bookshelf and profile tabs use task-focused layouts", () => {
  const shelves = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelves/index.wxml"), "utf8");
  const shelfCard = fs.readFileSync(path.join(root, "miniprogram/components/bookshelf-card/index.wxml"), "utf8");
  const profile = fs.readFileSync(path.join(root, "miniprogram/pages/profile/index.wxml"), "utf8");
  assert.match(shelves, /新建书架/);
  assert.doesNotMatch(shelves, /class="shelves__add"/);
  assert.match(shelfCard, /shelf\.coverSlots/);
  assert.match(profile, /class="profile__summary"/);
  assert.match(profile, /家庭资料/);
  assert.match(profile, /账号与隐私/);
  assert.doesNotMatch(profile, /<metric-card/);
});

test("bookshelf detail constrains its book grid and card hosts", () => {
  const styles = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-detail/index.wxss"), "utf8");
  assert.match(styles, /\.shelf-detail__grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(styles, /\.shelf-detail__grid\s+book-card\s*\{[\s\S]*?display:\s*block;[\s\S]*?min-width:\s*0;/);
});

test("bookshelf detail supports full-shelf selection, removal and shelf-only pinning", () => {
  const script = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-detail/index.js"), "utf8");
  const template = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-detail/index.wxml"), "utf8");
  const cardStyles = fs.readFileSync(path.join(root, "miniprogram/components/book-card/index.wxss"), "utf8");
  assert.match(script, /loadAllShelfBooks/);
  assert.match(script, /items\.length < 500/);
  assert.match(script, /processInChunks/);
  assert.match(script, /"removeBooks"/);
  assert.match(script, /"pinBooks"/);
  assert.match(template, /选择书籍/);
  assert.match(template, /已选择.*本书籍/);
  assert.match(template, /全选/);
  assert.match(template, /取消/);
  assert.match(template, /移出书架/);
  assert.match(template, /置顶/);
  assert.match(cardStyles, /\.book-card--selected[\s\S]*?box-shadow/);
});

test("bookshelf book picker filters existing relations and adds selections in chunks", () => {
  const detailScript = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-detail/index.js"), "utf8");
  const script = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-book-picker/index.js"), "utf8");
  const template = fs.readFileSync(path.join(root, "miniprogram/pages/bookshelf-book-picker/index.wxml"), "utf8");
  assert.match(detailScript, /pages\/bookshelf-book-picker\/index\?id=/);
  assert.match(script, /listBooks/);
  assert.match(script, /listShelfBooks/);
  assert.match(script, /processInChunks/);
  assert.match(script, /"addBooks"/);
  assert.match(script, /toggleAll/);
  assert.match(script, /if \(!shelf\) throw new Error/);
  assert.match(script, /this\.setData\(\{ presetIds: selectedIds \}\);[\s\S]*await this\.loadPicker\(\)/);
  assert.match(template, /添加绘本/);
  assert.match(template, /search-field/);
  assert.match(template, /全选/);
  assert.match(template, /加入书架/);
  assert.match(template, /都已加入这个书架/);
});

test("continuous scanning cannot overlap and canceling the camera stops on the same page", () => {
  const source = fs.readFileSync(path.join(root, "miniprogram/pages/add-book/index.js"), "utf8");
  assert.match(source, /if \(this\._scanOpening\) return;/);
  assert.match(source, /includes\("cancel"\)[\s\S]*?stopContinuousScan/);
  assert.doesNotMatch(source, /mode:\s*"summary"/);
  assert.match(source, /scanState:\s*"ready"/);
});

test("successful continuous scan queues a book and schedules the next scan without writing the library", async () => {
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = {
    scanCode({ success }) { success({ result: "9787020024759" }); },
    setStorageSync() {},
    getStorageSync() { return null; },
    removeStorageSync() {}
  };
  const apiPath = path.join(root, "miniprogram/services/api");
  const pagePath = path.join(root, "miniprogram/pages/add-book/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const { services } = require(apiPath);
  const originalBook = services.book;
  const originalLibrary = services.library;
  const originalEvent = services.event;
  let libraryCalls = 0;
  services.book = async () => ({
    edition: {
      edition_id: "isbn_9787020024759",
      isbn13: "9787020024759",
      title: "围城",
      contributors_text: "钱锺书",
      publisher: "人民文学出版社",
      cover_file_id: ""
    },
    cache_hit: true,
    provider_called: false
  });
  services.library = async () => { libraryCalls += 1; return {}; };
  services.event = async () => ({ accepted_count: 1 });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    _autoScanning: true,
    _pageAlive: true,
    setData(next) { this.data = { ...this.data, ...next }; },
    persistSession() {},
    scheduleNextScan() { this.scheduled = (this.scheduled || 0) + 1; }
  };
  page.data.scanSessionId = "scan_test";
  try {
    await page.scanContinuous();
    assert.equal(page.data.scanItems.length, 1);
    assert.equal(page.data.scanItems[0].scan_count, 1);
    assert.equal(libraryCalls, 0);
    assert.equal(page.scheduled, 1);
  } finally {
    services.book = originalBook;
    services.library = originalLibrary;
    services.event = originalEvent;
  }
});

test("a successful camera scan with a failed ISBN lookup counts as one attempt", async () => {
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = {
    scanCode({ success }) { success({ result: "9787020024759" }); },
    setStorageSync() {}
  };
  const apiPath = path.join(root, "miniprogram/services/api");
  const pagePath = path.join(root, "miniprogram/pages/add-book/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const { services } = require(apiPath);
  const originals = { book: services.book, event: services.event };
  services.book = async () => { throw new Error("图书信息服务暂时不可用"); };
  services.event = async () => ({ accepted_count: 1 });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    _autoScanning: true,
    _pageAlive: true,
    setData(next) { this.data = { ...this.data, ...next }; },
    persistSession() {},
    clearScanTimer() {}
  };
  page.data.scanSessionId = "scan_failure";
  try {
    await page.scanContinuous();
    assert.equal(page.data.session.total, 1);
    assert.equal(page.data.session.failures, 1);
    assert.equal(page.data.scanState, "paused");
  } finally {
    services.book = originals.book;
    services.event = originals.event;
  }
});

test("a lookup result arriving after page hide cannot mutate or restart the scan page", async () => {
  let definition;
  let resolveLookup;
  global.Page = (value) => { definition = value; };
  global.wx = {
    scanCode({ success }) { success({ result: "9787020024759" }); },
    setStorageSync() {}
  };
  const apiPath = path.join(root, "miniprogram/services/api");
  const pagePath = path.join(root, "miniprogram/pages/add-book/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const { services } = require(apiPath);
  const originals = { book: services.book, event: services.event };
  services.book = () => new Promise((resolve) => { resolveLookup = resolve; });
  services.event = async () => ({ accepted_count: 1 });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    _autoScanning: true,
    _pageAlive: true,
    setData(next) { this.data = { ...this.data, ...next }; },
    persistSession() { return true; },
    clearScanTimer() {},
    scheduleNextScan() { this.scheduled = true; }
  };
  page.data.scanSessionId = "scan_hidden";
  try {
    const scanning = page.scanContinuous();
    await new Promise((resolve) => setImmediate(resolve));
    page.onHide();
    resolveLookup({
      edition: { edition_id: "isbn_9787020024759", isbn13: "9787020024759", title: "围城" },
      cache_hit: true,
      provider_called: false
    });
    await scanning;
    assert.equal(page.data.scanItems.length, 0);
    assert.equal(page.scheduled, undefined);
  } finally {
    services.book = originals.book;
    services.event = originals.event;
  }
});

test("ending during ISBN lookup still queues the result but remains in review mode", async () => {
  let definition;
  let resolveLookup;
  global.Page = (value) => { definition = value; };
  global.wx = {
    scanCode({ success }) { success({ result: "9787020024759" }); },
    setStorageSync() {}
  };
  const apiPath = path.join(root, "miniprogram/services/api");
  const pagePath = path.join(root, "miniprogram/pages/add-book/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const { services } = require(apiPath);
  const originals = { book: services.book, event: services.event };
  services.book = () => new Promise((resolve) => { resolveLookup = resolve; });
  services.event = async () => ({ accepted_count: 1 });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    _autoScanning: true,
    _pageAlive: true,
    setData(next) { this.data = { ...this.data, ...next }; },
    persistSession() { return true; },
    clearScanTimer() {},
    scheduleNextScan() { this.scheduled = true; }
  };
  page.data.scanSessionId = "scan_stopped_lookup";
  try {
    const scanning = page.scanContinuous();
    await new Promise((resolve) => setImmediate(resolve));
    page.stopContinuousScan();
    resolveLookup({
      edition: { edition_id: "isbn_9787020024759", isbn13: "9787020024759", title: "围城" },
      cache_hit: true,
      provider_called: false
    });
    await scanning;
    assert.equal(page.data.scanItems.length, 1);
    assert.equal(page.data.scanState, "ready");
    assert.equal(page.scheduled, undefined);
  } finally {
    services.book = originals.book;
    services.event = originals.event;
  }
});

test("ending during ISBN lookup remains in review mode when the lookup later fails", async () => {
  let definition;
  let rejectLookup;
  global.Page = (value) => { definition = value; };
  global.wx = {
    scanCode({ success }) { success({ result: "9787020024759" }); },
    setStorageSync() {}
  };
  const apiPath = path.join(root, "miniprogram/services/api");
  const pagePath = path.join(root, "miniprogram/pages/add-book/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const { services } = require(apiPath);
  const originals = { book: services.book, event: services.event };
  services.book = () => new Promise((resolve, reject) => { rejectLookup = reject; });
  services.event = async () => ({ accepted_count: 1 });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    _autoScanning: true,
    _pageAlive: true,
    setData(next) { this.data = { ...this.data, ...next }; },
    persistSession() { return true; },
    clearScanTimer() {}
  };
  page.data.scanSessionId = "scan_stopped_failure";
  try {
    const scanning = page.scanContinuous();
    await new Promise((resolve) => setImmediate(resolve));
    page.stopContinuousScan();
    rejectLookup(new Error("查询失败"));
    await scanning;
    assert.equal(page.data.scanState, "ready");
    assert.equal(page.data.session.failures, 1);
  } finally {
    services.book = originals.book;
    services.event = originals.event;
  }
});

test("continuous scan batch commit uses stable request IDs and makes shelf assignment optional", () => {
  const source = fs.readFileSync(path.join(root, "miniprogram/pages/add-book/index.js"), "utf8");
  assert.match(source, /createRequestId/);
  assert.match(source, /async confirmBatch\(\)/);
  assert.match(source, /async commitCopy\(/);
  assert.match(source, /chooseShelf\(\)/);
  assert.match(source, /processInChunks/);
  assert.match(source, /services\.library\("addBook",\s*\{[\s\S]*?operation\.request_id\)/);
  assert.match(source, /if \(!this\.data\.selectedShelf\) return/);
  assert.match(source, /services\.bookshelf\("addBooks"/);
});

test("continuous scan uses a scrollable in-page shelf picker instead of the limited native action sheet", async () => {
  let definition;
  let actionSheetCalls = 0;
  global.Page = (value) => { definition = value; };
  global.wx = {
    showActionSheet() { actionSheetCalls += 1; },
    showToast() {}
  };
  const apiPath = path.join(root, "miniprogram/services/api");
  const pagePath = path.join(root, "miniprogram/pages/add-book/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const { services } = require(apiPath);
  const originalBookshelf = services.bookshelf;
  services.bookshelf = async () => ({
    items: Array.from({ length: 7 }, (_, index) => ({ bookshelf_id: `shelf_${index}`, name: `书架 ${index}` }))
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(next) { this.data = { ...this.data, ...next }; }
  };
  try {
    await page.chooseShelf();
    assert.equal(actionSheetCalls, 0);
    assert.equal(page.data.shelfPickerOpen, true);
    assert.equal(page.data.shelves.length, 7);
  } finally {
    services.bookshelf = originalBookshelf;
  }
  const template = fs.readFileSync(path.join(root, "miniprogram/pages/add-book/index.wxml"), "utf8");
  assert.match(template, /scroll-view/);
  assert.match(template, /bindtap="selectShelf"/);
});

test("ambiguous batch retry reuses the same per-copy request ID and does not touch shelves", async () => {
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = {
    setStorageSync() {},
    removeStorageSync() {},
    showToast() {},
    reLaunch() {}
  };
  const apiPath = path.join(root, "miniprogram/services/api");
  const pagePath = path.join(root, "miniprogram/pages/add-book/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const { services } = require(apiPath);
  const originals = { library: services.library, bookshelf: services.bookshelf, event: services.event };
  const requestIds = [];
  let attempt = 0;
  let bookshelfCalls = 0;
  services.library = async (action, payload, requestId) => {
    requestIds.push(requestId);
    attempt += 1;
    if (attempt === 1) {
      const error = new Error("网络中断");
      error.code = "NETWORK_ERROR";
      throw error;
    }
    return { created: true, user_book: { user_book_id: "user_book_1" } };
  };
  services.bookshelf = async () => { bookshelfCalls += 1; return { items: [] }; };
  services.event = async () => ({ accepted_count: 1 });
  const page = {
    ...definition,
    data: {
      ...JSON.parse(JSON.stringify(definition.data)),
      scanSessionId: "scan_commit",
      scanItems: [{
        edition_id: "isbn_9787020024759",
        isbn13: "9787020024759",
        title: "围城",
        scan_count: 1,
        committed_count: 0,
        commit_operations: [],
        status: "pending"
      }],
      copyCount: 1
    },
    setData(next) { this.data = { ...this.data, ...next }; },
    persistSession() {},
    clearScanTimer() {}
  };
  try {
    await page.confirmBatch();
    const stableId = page.data.scanItems[0].commit_operations[0].request_id;
    assert.equal(page.data.scanItems[0].commit_operations[0].status, "processing");
    await page.confirmBatch();
    assert.deepEqual(requestIds, [stableId, stableId]);
    assert.equal(bookshelfCalls, 0);
  } finally {
    services.library = originals.library;
    services.bookshelf = originals.bookshelf;
    services.event = originals.event;
  }
});

test("batch submission aborts before cloud writes when stable request IDs cannot be stored", async () => {
  let definition;
  let libraryCalls = 0;
  global.Page = (value) => { definition = value; };
  global.wx = {
    setStorageSync() { throw new Error("storage full"); },
    showToast() {}
  };
  const apiPath = path.join(root, "miniprogram/services/api");
  const pagePath = path.join(root, "miniprogram/pages/add-book/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const { services } = require(apiPath);
  const originalLibrary = services.library;
  services.library = async () => { libraryCalls += 1; return {}; };
  const page = {
    ...definition,
    data: {
      ...JSON.parse(JSON.stringify(definition.data)),
      scanSessionId: "scan_storage_failure",
      scanItems: [{
        edition_id: "isbn_9787020024759",
        isbn13: "9787020024759",
        title: "围城",
        scan_count: 1,
        committed_count: 0,
        commit_operations: [],
        status: "pending"
      }],
      copyCount: 1
    },
    setData(next) { this.data = { ...this.data, ...next }; },
    clearScanTimer() {}
  };
  try {
    await page.confirmBatch();
    assert.equal(libraryCalls, 0);
    assert.equal(page.data.submissionStarted, false);
    assert.match(page.data.submitError, /保存本轮进度失败/);
  } finally {
    services.library = originalLibrary;
  }
});

test("completed continuous sessions are not recreated by the unload lifecycle", () => {
  let definition;
  let storageWrites = 0;
  global.Page = (value) => { definition = value; };
  global.wx = {
    setStorageSync() { storageWrites += 1; },
    removeStorageSync() {},
    showToast() {},
    reLaunch() {}
  };
  const pagePath = path.join(root, "miniprogram/pages/add-book/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const page = {
    ...definition,
    data: {
      ...JSON.parse(JSON.stringify(definition.data)),
      mode: "continuous",
      scanSessionId: "scan_complete",
      copyCount: 1,
      scanItems: [{ edition_id: "isbn_1", scan_count: 1, committed_count: 1 }]
    },
    setData(next) { this.data = { ...this.data, ...next }; },
    clearScanTimer() {}
  };
  page.completeContinuousSession(0);
  page.onUnload();
  assert.equal(storageWrites, 0);
});

test("restored partial submissions keep their retry message", () => {
  let definition;
  const saved = {
    version: 2,
    scanSessionId: "scan_partial",
    session: { total: 1, successful: 1, skipped: 0, failures: 0 },
    scanState: "ready",
    scanItems: [{
      edition_id: "isbn_1",
      scan_count: 1,
      committed_count: 0,
      commit_operations: [{ request_id: "stable-id", status: "processing" }],
      status: "failed"
    }],
    submissionStarted: true,
    submitError: "部分绘本尚未入馆，请检查后重试失败项。",
    expiresAt: Date.now() + 60_000
  };
  global.Page = (value) => { definition = value; };
  global.wx = {
    getStorageSync(key) { return key === "v1_core_continuous_scan" ? "scan_partial" : saved; },
    removeStorageSync() {}
  };
  const pagePath = path.join(root, "miniprogram/pages/add-book/index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(next) { this.data = { ...this.data, ...next }; }
  };
  assert.equal(page.restoreSession(), true);
  assert.equal(page.data.submitError, saved.submitError);
});

test("continuous scan review stays on one page with a safe-area confirmation bar", () => {
  const template = fs.readFileSync(path.join(root, "miniprogram/pages/add-book/index.wxml"), "utf8");
  const styles = fs.readFileSync(path.join(root, "miniprogram/pages/add-book/index.wxss"), "utf8");
  assert.match(template, /开始扫码/);
  assert.match(template, /选择书架（可选）/);
  assert.match(template, /确认入馆/);
  assert.match(template, /bindtap="removeScanItem"/);
  assert.match(template, /wx:if="\{\{scanState === 'ready' && !submissionStarted && !submitting\}\}"[^>]*bindtap="removeScanItem"/);
  assert.match(template, /重试扫码/);
  assert.match(template, /跳过并继续/);
  assert.match(template, /结束扫码/);
  assert.doesNotMatch(template, /mode === 'summary'/);
  assert.doesNotMatch(template, /text="继续扫描"/);
  assert.doesNotMatch(template, /继续扫码/);
  assert.doesNotMatch(template, /结束并查看汇总/);
  assert.doesNotMatch(template, /再扫一轮/);
  assert.match(template, /wx:if="\{\{scanItems\.length && \(scanState === 'ready' \|\| submissionStarted\)\}\}"[^>]*class="add-book__shelf-choice"/);
  assert.match(styles, /\.add-book__commit-bar\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*0;[\s\S]*?env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.add-book__scan-cover\s*\{[\s\S]*?width:\s*96rpx;[\s\S]*?height:\s*128rpx;/);
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
    "bookshelf-detail": ["loadShelf", "editShelf", "startSelecting", "toggleAll", "removeSelected", "pinSelected", "prepareShare", "onShareAppMessage"],
    "shared-shelf": ["loadSharedShelf", "reload"],
    "bookshelf-edit": ["loadEditor", "save"],
    "bookshelf-book-picker": ["loadPicker", "onSearch", "toggleBook", "toggleAll", "save"],
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
