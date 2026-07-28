const { services } = require("../../services/api");
const { normalizeIsbn, isValidIsbn } = require("../../utils/isbn");
const { track } = require("../../services/analytics");

const CONTINUOUS_SCAN_STORAGE_KEY = "v1_core_continuous_scan";
const CONTINUOUS_SCAN_TTL_MS = 24 * 60 * 60 * 1000;
const sessionStorageKey = (sessionId) => `${CONTINUOUS_SCAN_STORAGE_KEY}:${sessionId}`;

Page({
  data: {
    mode: "choose",
    state: "idle",
    scanState: "idle",
    isbn: "",
    isbnError: "",
    querying: false,
    cacheKeyword: "",
    cacheResult: null,
    session: { total: 0, added: 0, duplicates: 0, skipped: 0, failures: 0 },
    lastBook: {},
    pendingLookup: null,
    failedItems: []
  },

  onLoad(query) {
    if (query.mode) this.setData({ mode: query.mode });
    if (query.mode === "continuous") this.restoreSession();
  },

  onUnload() {
    if (this.data.mode === "continuous") this.persistSession();
  },

  chooseMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode });
    if (event.currentTarget.dataset.mode === "continuous") {
      if (!this.restoreSession()) {
        const sessionId = this.startSession();
        track("continuous_scan_started", { scan_mode: "continuous", scan_session_id: sessionId });
      }
    }
  },

  startSession() {
    const sessionId = `scan_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    this.setData({
      scanSessionId: sessionId,
      scanState: "idle",
      pendingLookup: null,
      failedItems: [],
      session: { total: 0, added: 0, duplicates: 0, skipped: 0, failures: 0 }
    });
    this.persistSession();
    return sessionId;
  },

  restoreSession() {
    try {
      const activeSessionId = wx.getStorageSync(CONTINUOUS_SCAN_STORAGE_KEY);
      const saved = activeSessionId ? wx.getStorageSync(sessionStorageKey(activeSessionId)) : null;
      if (!saved || saved.expiresAt <= Date.now() || !saved.scanSessionId) {
        if (activeSessionId) wx.removeStorageSync(sessionStorageKey(activeSessionId));
        wx.removeStorageSync(CONTINUOUS_SCAN_STORAGE_KEY);
        return false;
      }
      this.setData({
        scanSessionId: saved.scanSessionId,
        session: saved.session,
        scanState: saved.scanState || "idle",
        lastBook: saved.lastBook || {},
        pendingLookup: saved.pendingLookup || null,
        failedItems: saved.failedItems || []
      });
      return true;
    } catch (_) {
      return false;
    }
  },

  persistSession() {
    if (!this.data.scanSessionId) return;
    try {
      wx.setStorageSync(CONTINUOUS_SCAN_STORAGE_KEY, this.data.scanSessionId);
      wx.setStorageSync(sessionStorageKey(this.data.scanSessionId), {
        scanSessionId: this.data.scanSessionId,
        session: this.data.session,
        scanState: this.data.scanState,
        lastBook: this.data.lastBook,
        pendingLookup: this.data.pendingLookup,
        failedItems: this.data.failedItems,
        expiresAt: Date.now() + CONTINUOUS_SCAN_TTL_MS
      });
    } catch (_) {}
  },

  markScanFailure(message) {
    const session = { ...this.data.session, failures: this.data.session.failures + 1 };
    const failedItems = [...this.data.failedItems, { isbn: this.data.currentScanIsbn || "未识别条码", message }].slice(-20);
    this.setData({ session, failedItems, scanState: "failed", scanError: message });
    track("continuous_scan_book_added", {
      scan_mode: "continuous",
      scan_session_id: this.data.scanSessionId,
      result_code: "failure"
    });
    this.persistSession();
  },

  scan() {
    wx.scanCode({
      scanType: ["barCode"],
      success: ({ result }) => {
        this.setData({ isbn: normalizeIsbn(result) });
        this.lookup();
      },
      fail: (error) => {
        if (!String(error.errMsg || "").includes("cancel")) wx.showToast({ title: "没有识别到 ISBN", icon: "none" });
      }
    });
  },

  onIsbnInput(event) {
    this.setData({ isbn: normalizeIsbn(event.detail.value), isbnError: "" });
  },

  navigateToConfirmation(data) {
    wx.navigateTo({
      url: `/pages/book-confirm/index?editionId=${data.edition.edition_id}&isbn=${data.edition.isbn13}&source=${data.cache_hit ? "cache" : "provider"}`
    });
  },

  async waitForLookup(isbn) {
    const delays = [800, 1600, 2400];
    for (const delay of delays) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const status = await services.book("getLookupStatus", { isbn });
      if (status.lookup_status === "found") {
        return { edition: status.edition, cache_hit: true, provider_called: false };
      }
      if (status.lookup_status === "not_found") {
        const error = new Error("没有查询到这本绘本");
        error.code = "BOOK_NOT_FOUND";
        throw error;
      }
      if (status.lookup_status === "provider_error") {
        const error = new Error("图书信息服务暂时不可用");
        error.code = "ISBN_PROVIDER_UNAVAILABLE";
        throw error;
      }
    }
    const error = new Error("查询时间较长，请稍后再试");
    error.code = "LOOKUP_TIMEOUT";
    throw error;
  },

  async lookup() {
    if (!isValidIsbn(this.data.isbn)) {
      this.setData({ isbnError: "请输入正确的 10 或 13 位 ISBN" });
      return;
    }
    this.setData({ querying: true, state: "idle" });
    try {
      const data = await services.book("lookupByIsbn", { isbn: this.data.isbn });
      track("isbn_scan_succeeded", { scan_mode: "single", provider_called: data.provider_called, cache_hit: data.cache_hit });
      this.navigateToConfirmation(data);
    } catch (error) {
      if (error.code === "BOOK_LOOKUP_IN_PROGRESS") {
        try {
          this.navigateToConfirmation(await this.waitForLookup(this.data.isbn));
          return;
        } catch (waitError) {
          error = waitError;
        }
      }
      const providerUnavailable = ["ISBN_PROVIDER_UNAVAILABLE", "ISBN_PROVIDER_AUTH_ERROR", "ISBN_PROVIDER_BAD_REQUEST", "PROVIDER_UNAVAILABLE"].includes(error.code);
      this.setData({ state: providerUnavailable ? "provider-unavailable" : "error" });
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ querying: false });
    }
  },

  showIsbn() {
    this.setData({ mode: "isbn" });
  },

  onCacheKeyword(event) {
    this.setData({ cacheKeyword: event.detail.value });
  },

  async searchCache() {
    const page = await services.book("searchCachedBooks", { query: this.data.cacheKeyword, limit: 1 });
    const edition = page.items[0];
    const cacheResult = edition ? {
      ...edition,
      author: edition.contributors_text,
      coverUrl: edition.cover_file_id || ""
    } : null;
    this.setData({ cacheResult, state: cacheResult ? "content" : "search-empty" });
  },

  selectCacheResult() {
    const book = this.data.cacheResult;
    if (book) wx.navigateTo({ url: `/pages/book-confirm/index?editionId=${book.edition_id}&isbn=${book.isbn13}&source=cache` });
  },

  async scanContinuous() {
    if (this.data.session.total >= 100) {
      wx.showToast({ title: "本轮已达到 100 次上限", icon: "none" });
      this.finishContinuous();
      return;
    }
    this.setData({ scanState: "scanning" });
    wx.scanCode({
      scanType: ["barCode"],
      success: async ({ result }) => {
        const isbn = normalizeIsbn(result);
        const session = { ...this.data.session, total: this.data.session.total + 1 };
        this.setData({ session, currentScanIsbn: isbn, isbn });
        this.persistSession();
        if (!isValidIsbn(isbn)) {
          this.markScanFailure("这不是有效的 ISBN 条码。");
          return;
        }
        try {
          let lookup;
          try {
            lookup = await services.book("lookupByIsbn", { isbn, scan_session_id: this.data.scanSessionId });
          } catch (lookupError) {
            if (lookupError.code !== "BOOK_LOOKUP_IN_PROGRESS") throw lookupError;
            lookup = await this.waitForLookup(isbn);
          }
          const existingPage = await services.library("listBooks", { query: isbn, limit: 3 });
          const existing = existingPage.items.find((item) => item.edition && item.edition.edition_id === lookup.edition.edition_id);
          if (existing) {
            this.setData({
              pendingLookup: lookup,
              lastBook: { title: lookup.edition.title, quantity: existing.quantity || 1 },
              scanState: "duplicate-choice"
            });
            this.persistSession();
            return;
          }
          const added = await services.library("addBook", { edition_id: lookup.edition.edition_id, quantity_delta: 1, scan_session_id: this.data.scanSessionId });
          track("continuous_scan_book_added", {
            scan_mode: "continuous",
            scan_session_id: this.data.scanSessionId,
            cache_hit: lookup.cache_hit,
            provider_called: lookup.provider_called,
            result_code: added.created ? "added" : "duplicate"
          });
          const nextSession = { ...this.data.session };
          if (added.created) nextSession.added += 1;
          else nextSession.duplicates += 1;
          this.setData({ session: nextSession, lastBook: { title: lookup.edition.title }, scanState: added.created ? "success" : "duplicate" });
          this.persistSession();
        } catch (error) {
          this.markScanFailure(error.message);
        }
      },
      fail: (error) => {
        if (String(error.errMsg || "").includes("cancel")) {
          this.finishContinuous();
          return;
        }
        const session = { ...this.data.session, total: this.data.session.total + 1 };
        this.setData({ session });
        this.markScanFailure("相机未识别到条码。");
      }
    });
  },

  skip() {
    const session = { ...this.data.session, skipped: this.data.session.skipped + 1 };
    this.setData({ session, scanState: "idle", scanError: "", pendingLookup: null });
    track("continuous_scan_book_added", {
      scan_mode: "continuous",
      scan_session_id: this.data.scanSessionId,
      result_code: "skipped"
    });
    this.persistSession();
  },

  async confirmDuplicate() {
    const lookup = this.data.pendingLookup;
    if (!lookup) return;
    this.setData({ scanState: "scanning" });
    try {
      await services.library("addBook", {
        edition_id: lookup.edition.edition_id,
        quantity_delta: 1,
        scan_session_id: this.data.scanSessionId
      });
      const session = { ...this.data.session, duplicates: this.data.session.duplicates + 1 };
      track("continuous_scan_book_added", {
        scan_mode: "continuous",
        scan_session_id: this.data.scanSessionId,
        result_code: "duplicate",
        cache_hit: lookup.cache_hit,
        provider_called: lookup.provider_called
      });
      this.setData({ session, pendingLookup: null, scanState: "duplicate" });
      this.persistSession();
    } catch (error) {
      this.markScanFailure(error.message);
    }
  },

  finishContinuous() {
    track("continuous_scan_finished", { scan_mode: "continuous", scan_session_id: this.data.scanSessionId });
    this.setData({ mode: "summary" });
    try {
      wx.removeStorageSync(sessionStorageKey(this.data.scanSessionId));
      wx.removeStorageSync(CONTINUOUS_SCAN_STORAGE_KEY);
    } catch (_) {}
  },

  restartContinuous() {
    this.startSession();
    this.setData({ mode: "continuous" });
  },

  backToLibrary() {
    wx.reLaunch({ url: "/pages/library/index" });
  },

  goManual() {
    wx.navigateTo({ url: `/pages/manual-book-edit/index${this.data.isbn ? `?isbn=${this.data.isbn}` : ""}` });
  }
});
