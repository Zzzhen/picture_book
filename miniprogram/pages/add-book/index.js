const { services } = require("../../services/api");
const { normalizeIsbn, isValidIsbn } = require("../../utils/isbn");
const { track } = require("../../services/analytics");
const {
  SESSION_VERSION,
  createContinuousSession,
  mergeScanItem: mergePendingScanItem,
  removeScanItem: removePendingScanItem,
  sessionTotals
} = require("../../utils/continuous-scan");

const CONTINUOUS_SCAN_STORAGE_KEY = "v1_core_continuous_scan";
const CONTINUOUS_SCAN_TTL_MS = 24 * 60 * 60 * 1000;
const SUCCESS_FEEDBACK_MS = 800;
const sessionStorageKey = (sessionId) => `${CONTINUOUS_SCAN_STORAGE_KEY}:${sessionId}`;

Page({
  data: {
    mode: "choose",
    state: "idle",
    scanState: "ready",
    isbn: "",
    isbnError: "",
    querying: false,
    cacheKeyword: "",
    cacheResult: null,
    session: { total: 0, successful: 0, skipped: 0, failures: 0 },
    scanItems: [],
    uniqueCount: 0,
    copyCount: 0,
    committedCount: 0,
    selectedShelf: null,
    submissionStarted: false,
    submitting: false,
    lastBook: {},
    failedItems: []
  },

  onLoad(query) {
    if (query.mode) this.setData({ mode: query.mode });
    if (query.mode === "continuous" && !this.restoreSession()) this.createTrackedSession();
  },

  onShow() {
    this._pageAlive = true;
    this._confirmationOpening = false;
  },

  onHide() {
    this._pageAlive = false;
    this.clearScanTimer();
    if (this.data.mode === "continuous") this.persistSession();
  },

  onUnload() {
    this._pageAlive = false;
    this._autoScanning = false;
    this.clearScanTimer();
    if (this.data.mode === "continuous") this.persistSession();
  },

  chooseMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode });
    if (event.currentTarget.dataset.mode === "continuous") {
      if (!this.restoreSession()) this.createTrackedSession();
    }
  },

  createTrackedSession() {
    const sessionId = this.startSession();
    track("continuous_scan_started", { scan_mode: "continuous", scan_session_id: sessionId });
    return sessionId;
  },

  startSession() {
    const sessionId = `scan_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const draft = createContinuousSession(sessionId);
    this.setData({
      scanSessionId: sessionId,
      scanState: "ready",
      scanError: "",
      failedItems: [],
      session: draft.session,
      scanItems: draft.scanItems,
      selectedShelf: draft.selectedShelf,
      submissionStarted: draft.submissionStarted,
      submitting: false,
      uniqueCount: 0,
      copyCount: 0,
      committedCount: 0
    });
    this.persistSession();
    return sessionId;
  },

  restoreSession() {
    try {
      const activeSessionId = wx.getStorageSync(CONTINUOUS_SCAN_STORAGE_KEY);
      const saved = activeSessionId ? wx.getStorageSync(sessionStorageKey(activeSessionId)) : null;
      if (!saved || saved.version !== SESSION_VERSION || saved.expiresAt <= Date.now() || !saved.scanSessionId) {
        if (activeSessionId) wx.removeStorageSync(sessionStorageKey(activeSessionId));
        wx.removeStorageSync(CONTINUOUS_SCAN_STORAGE_KEY);
        return false;
      }
      const scanItems = Array.isArray(saved.scanItems) ? saved.scanItems : [];
      const totals = sessionTotals(scanItems);
      this.setData({
        scanSessionId: saved.scanSessionId,
        session: saved.session || { total: 0, successful: 0, skipped: 0, failures: 0 },
        scanState: saved.scanState === "paused" ? "paused" : "ready",
        lastBook: saved.lastBook || {},
        scanItems,
        failedItems: saved.failedItems || [],
        selectedShelf: saved.selectedShelf || null,
        submissionStarted: Boolean(saved.submissionStarted),
        submitting: false,
        ...totals
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
        version: SESSION_VERSION,
        scanSessionId: this.data.scanSessionId,
        session: this.data.session,
        scanState: this.data.scanState,
        lastBook: this.data.lastBook,
        scanItems: this.data.scanItems,
        failedItems: this.data.failedItems,
        selectedShelf: this.data.selectedShelf,
        submissionStarted: this.data.submissionStarted,
        expiresAt: Date.now() + CONTINUOUS_SCAN_TTL_MS
      });
    } catch (_) {}
  },

  markScanFailure(message) {
    this._autoScanning = false;
    this.clearScanTimer();
    const session = { ...this.data.session, failures: this.data.session.failures + 1 };
    const failedItems = [...this.data.failedItems, { isbn: this.data.currentScanIsbn || "未识别条码", message }].slice(-20);
    this.setData({ session, failedItems, scanState: "paused", scanError: message });
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
    if (this._confirmationOpening) return;
    this._confirmationOpening = true;
    wx.navigateTo({
      url: `/pages/book-confirm/index?editionId=${data.edition.edition_id}&isbn=${data.edition.isbn13}&source=${data.cache_hit ? "cache" : "provider"}`,
      fail: () => { this._confirmationOpening = false; }
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
    if (this.data.querying || this._confirmationOpening) return;
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

  clearScanTimer() {
    if (this._scanTimer) clearTimeout(this._scanTimer);
    this._scanTimer = null;
  },

  scheduleNextScan() {
    this.clearScanTimer();
    this._scanTimer = setTimeout(() => {
      if (this._autoScanning && this._pageAlive && !this.data.submitting) this.scanContinuous();
    }, SUCCESS_FEEDBACK_MS);
  },

  startContinuousScan() {
    if (this.data.submissionStarted || this.data.submitting) return;
    if (!this.data.scanSessionId) this.createTrackedSession();
    if (this.data.session.total >= 100) {
      this.stopContinuousScan("本轮已达到 100 次上限");
      return;
    }
    this._autoScanning = true;
    this.setData({ scanState: "ready", scanError: "" });
    this.scanContinuous();
  },

  stopContinuousScan(message = "") {
    this._autoScanning = false;
    this.clearScanTimer();
    if (!this.data.submitting) this.setData({ scanState: "ready", scanError: "" });
    this.persistSession();
    if (message) wx.showToast({ title: message, icon: "none" });
  },

  async scanContinuous() {
    if (this._scanOpening) return;
    if (!this._autoScanning) return;
    if (this.data.session.total >= 100) {
      this.stopContinuousScan("本轮已达到 100 次上限");
      return;
    }
    const sessionId = this.data.scanSessionId;
    this._scanOpening = true;
    this.setData({ scanState: "opening", scanError: "" });
    try {
      const result = await new Promise((resolve, reject) => {
        wx.scanCode({ scanType: ["barCode"], success: resolve, fail: reject });
      });
      if (sessionId !== this.data.scanSessionId) return;
      const isbn = normalizeIsbn(result.result);
      const session = { ...this.data.session, total: this.data.session.total + 1 };
      this.setData({ session, currentScanIsbn: isbn, isbn, scanState: "looking_up" });
      this.persistSession();
      if (!isValidIsbn(isbn)) {
        this.markScanFailure("这不是有效的 ISBN 条码。");
        return;
      }
      let lookup;
      try {
        lookup = await services.book("lookupByIsbn", { isbn, scan_session_id: sessionId });
      } catch (lookupError) {
        if (lookupError.code !== "BOOK_LOOKUP_IN_PROGRESS") throw lookupError;
        lookup = await this.waitForLookup(isbn);
      }
      if (sessionId !== this.data.scanSessionId) return;
      const edition = lookup.edition;
      const scanItems = mergePendingScanItem(this.data.scanItems, {
        edition_id: edition.edition_id,
        isbn13: edition.isbn13,
        title: edition.title,
        contributors_text: edition.contributors_text || "",
        publisher: edition.publisher || "",
        cover_file_id: edition.cover_file_id || "",
        cache_hit: Boolean(lookup.cache_hit),
        provider_called: Boolean(lookup.provider_called)
      });
      const nextSession = { ...this.data.session, successful: this.data.session.successful + 1 };
      this.setData({
        session: nextSession,
        scanItems,
        lastBook: { title: edition.title },
        scanState: "success",
        scanError: "",
        ...sessionTotals(scanItems)
      });
      this.persistSession();
      this.scheduleNextScan();
    } catch (error) {
      if (String(error.errMsg || "").includes("cancel")) {
        this.stopContinuousScan();
        return;
      }
      const session = { ...this.data.session, total: this.data.session.total + 1 };
      this.setData({ session });
      this.markScanFailure(error.message || "相机未识别到条码。");
    } finally {
      this._scanOpening = false;
    }
  },

  retryScan() {
    this.startContinuousScan();
  },

  skip() {
    const session = { ...this.data.session, skipped: this.data.session.skipped + 1 };
    this.setData({ session, scanState: "ready", scanError: "" });
    track("continuous_scan_book_added", {
      scan_mode: "continuous",
      scan_session_id: this.data.scanSessionId,
      result_code: "skipped"
    });
    this.persistSession();
    this.startContinuousScan();
  },

  finishContinuous() {
    this.stopContinuousScan();
  },

  removeScanItem(event) {
    if (this.data.submissionStarted || this.data.submitting) return;
    const editionId = event.currentTarget.dataset.id;
    wx.showModal({
      title: "从本轮列表移除？",
      content: "这本书尚未加入绘本馆。",
      confirmText: "移除",
      confirmColor: "#B5543A",
      success: ({ confirm }) => {
        if (!confirm) return;
        const scanItems = removePendingScanItem(this.data.scanItems, editionId);
        this.setData({ scanItems, ...sessionTotals(scanItems) });
        this.persistSession();
      }
    });
  },

  backToLibrary() {
    wx.reLaunch({ url: "/pages/library/index" });
  },

  goManual() {
    if (this.data.mode === "continuous") this.stopContinuousScan();
    wx.navigateTo({ url: `/pages/manual-book-edit/index${this.data.isbn ? `?isbn=${this.data.isbn}` : ""}` });
  }
});
