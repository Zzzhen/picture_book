const { services, createRequestId } = require("../../services/api");
const { normalizeIsbn, isValidIsbn } = require("../../utils/isbn");
const { track } = require("../../services/analytics");
const {
  SESSION_VERSION,
  createContinuousSession,
  mergeScanItem: mergePendingScanItem,
  removeScanItem: removePendingScanItem,
  sessionTotals,
  prepareCommitOperations,
  resetFailedCommitOperations,
  isAmbiguousCommitError
} = require("../../utils/continuous-scan");

const CONTINUOUS_SCAN_STORAGE_KEY = "v1_core_continuous_scan";
const CONTINUOUS_SCAN_TTL_MS = 24 * 60 * 60 * 1000;
const SUCCESS_FEEDBACK_MS = 800;
const sessionStorageKey = (sessionId) => `${CONTINUOUS_SCAN_STORAGE_KEY}:${sessionId}`;

async function processInChunks(items, handler) {
  for (let index = 0; index < items.length; index += 50) {
    await handler(items.slice(index, index + 50));
  }
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
    shelves: [],
    shelfPickerOpen: false,
    shelvesLoading: false,
    submissionStarted: false,
    submitting: false,
    submitError: "",
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
    if (this.data.mode === "continuous"
      && !this._autoScanning
      && !this.data.submitting
      && ["opening", "looking_up", "success"].includes(this.data.scanState)) {
      this.setData({ scanState: "ready" });
    }
  },

  onHide() {
    this._pageAlive = false;
    this._autoScanning = false;
    this._scanGeneration = (this._scanGeneration || 0) + 1;
    this.clearScanTimer();
    if (this.data.mode === "continuous") this.persistSession();
  },

  onUnload() {
    this._pageAlive = false;
    this._autoScanning = false;
    this._scanGeneration = (this._scanGeneration || 0) + 1;
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
    this._sessionCompleted = false;
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
      submitError: "",
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
      this._sessionCompleted = false;
      const totals = sessionTotals(scanItems);
      const hasIncompleteItems = Boolean(saved.submissionStarted)
        && scanItems.some((item) => item.committed_count !== item.scan_count);
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
        submitError: saved.submitError || (hasIncompleteItems
          ? "部分绘本尚未入馆，请检查后重试失败项。"
          : ""),
        ...totals
      });
      return true;
    } catch (_) {
      return false;
    }
  },

  persistSession() {
    if (!this.data.scanSessionId || this._sessionCompleted) return;
    try {
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
        submitError: this.data.submitError,
        expiresAt: Date.now() + CONTINUOUS_SCAN_TTL_MS
      });
      wx.setStorageSync(CONTINUOUS_SCAN_STORAGE_KEY, this.data.scanSessionId);
      return true;
    } catch (_) {
      return false;
    }
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
      coverUrl: edition.cover_url || ""
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
    const scanGeneration = this._scanGeneration || 0;
    let attemptCounted = false;
    this._scanOpening = true;
    this.setData({ scanState: "opening", scanError: "" });
    try {
      const result = await new Promise((resolve, reject) => {
        wx.scanCode({ scanType: ["barCode"], success: resolve, fail: reject });
      });
      if (sessionId !== this.data.scanSessionId || scanGeneration !== (this._scanGeneration || 0) || !this._pageAlive) return;
      const isbn = normalizeIsbn(result.result);
      const session = { ...this.data.session, total: this.data.session.total + 1 };
      attemptCounted = true;
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
      if (sessionId !== this.data.scanSessionId || scanGeneration !== (this._scanGeneration || 0) || !this._pageAlive) return;
      const edition = lookup.edition;
      const scanItems = mergePendingScanItem(this.data.scanItems, {
        edition_id: edition.edition_id,
        isbn13: edition.isbn13,
        title: edition.title,
        contributors_text: edition.contributors_text || "",
        publisher: edition.publisher || "",
        cover_url: edition.cover_url || "",
        cache_hit: Boolean(lookup.cache_hit),
        provider_called: Boolean(lookup.provider_called)
      });
      const nextSession = { ...this.data.session, successful: this.data.session.successful + 1 };
      this.setData({
        session: nextSession,
        scanItems,
        lastBook: { title: edition.title },
        scanState: this._autoScanning ? "success" : "ready",
        scanError: "",
        ...sessionTotals(scanItems)
      });
      this.persistSession();
      if (this._autoScanning) this.scheduleNextScan();
    } catch (error) {
      if (sessionId !== this.data.scanSessionId || scanGeneration !== (this._scanGeneration || 0) || !this._pageAlive) return;
      if (String(error.errMsg || "").includes("cancel")) {
        this.stopContinuousScan();
        return;
      }
      const shouldPause = this._autoScanning;
      if (!attemptCounted) {
        const session = { ...this.data.session, total: this.data.session.total + 1 };
        this.setData({ session });
      }
      this.markScanFailure(error.message || "相机未识别到条码。");
      if (!shouldPause) {
        this.setData({ scanState: "ready" });
        this.persistSession();
      }
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
    if (this.data.scanState !== "ready" || this.data.submissionStarted || this.data.submitting) return;
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

  async chooseShelf() {
    if (this.data.submitting || (!this.data.submissionStarted && this.data.scanState !== "ready")) return;
    this.setData({ shelvesLoading: true });
    try {
      const data = await services.bookshelf("listShelves", {});
      this.setData({ shelves: data.items || [], shelfPickerOpen: true });
    } catch (error) {
      wx.showToast({ title: error.message || "书架加载失败", icon: "none" });
    } finally {
      this.setData({ shelvesLoading: false });
    }
  },

  closeShelfPicker() {
    if (!this.data.shelvesLoading) this.setData({ shelfPickerOpen: false });
  },

  noop() {},

  selectShelf(event) {
    const shelfId = event.currentTarget.dataset.id || "";
    const shelf = this.data.shelves.find((item) => item.bookshelf_id === shelfId);
    const selectedShelf = shelf ? { bookshelf_id: shelf.bookshelf_id, name: shelf.name } : null;
    this.setData({ selectedShelf, shelfPickerOpen: false, submitError: "" });
    this.persistSession();
  },

  updateCommitItem(itemIndex, updater) {
    const scanItems = this.data.scanItems.map((item, index) => index === itemIndex ? updater(item) : item);
    this.setData({ scanItems, ...sessionTotals(scanItems) });
    this.persistSession();
    return scanItems[itemIndex];
  },

  async commitCopy(itemIndex, operationIndex) {
    let item = this.data.scanItems[itemIndex];
    let operation = item.commit_operations[operationIndex];
    this.updateCommitItem(itemIndex, (current) => ({
      ...current,
      status: "submitting",
      error_message: "",
      commit_operations: current.commit_operations.map((candidate, index) => index === operationIndex
        ? { ...candidate, status: "processing" }
        : candidate)
    }));
    let inProgressRetries = 0;
    try {
      let result;
      while (!result) {
        try {
          result = await services.library("addBook", {
            edition_id: item.edition_id,
            quantity_delta: 1,
            scan_session_id: this.data.scanSessionId
          }, operation.request_id);
        } catch (error) {
          if (error.code === "REQUEST_IN_PROGRESS" && inProgressRetries < 2) {
            inProgressRetries += 1;
            await wait(600);
            continue;
          }
          throw error;
        }
      }
      item = this.updateCommitItem(itemIndex, (current) => {
        const commitOperations = current.commit_operations.map((candidate, index) => index === operationIndex
          ? { ...candidate, status: "completed" }
          : candidate);
        const committedCount = commitOperations.filter((candidate) => candidate.status === "completed").length;
        return {
          ...current,
          commit_operations: commitOperations,
          committed_count: committedCount,
          user_book_id: result.user_book.user_book_id,
          status: committedCount === current.scan_count ? "added" : "submitting",
          error_message: ""
        };
      });
      track("continuous_scan_book_added", {
        scan_mode: "continuous",
        scan_session_id: this.data.scanSessionId,
        cache_hit: item.cache_hit,
        provider_called: item.provider_called,
        result_code: result.created ? "added" : "duplicate"
      });
      return true;
    } catch (error) {
      const ambiguous = isAmbiguousCommitError(error);
      this.updateCommitItem(itemIndex, (current) => ({
        ...current,
        status: "failed",
        error_message: ambiguous ? "请求结果仍在确认中，请稍后重试" : (error.message || "入馆失败，请重试"),
        commit_operations: current.commit_operations.map((candidate, index) => index === operationIndex
          ? { ...candidate, status: ambiguous ? "processing" : "failed" }
          : candidate)
      }));
      return false;
    }
  },

  async commitPendingItems() {
    for (let itemIndex = 0; itemIndex < this.data.scanItems.length; itemIndex += 1) {
      const operationCount = this.data.scanItems[itemIndex].commit_operations.length;
      for (let operationIndex = 0; operationIndex < operationCount; operationIndex += 1) {
        const operation = this.data.scanItems[itemIndex].commit_operations[operationIndex];
        if (operation.status === "completed") continue;
        const completed = await this.commitCopy(itemIndex, operationIndex);
        if (!completed) break;
      }
    }
    return this.data.scanItems.every((item) => item.committed_count === item.scan_count);
  },

  async addCommittedBooksToShelf() {
    if (!this.data.selectedShelf) return 0;
    const shelves = await services.bookshelf("listShelves", {});
    const shelf = (shelves.items || []).find((item) => item.bookshelf_id === this.data.selectedShelf.bookshelf_id);
    if (!shelf) {
      const error = new Error("选择的书架已不存在，请重新选择");
      error.code = "BOOKSHELF_NOT_FOUND";
      throw error;
    }
    const userBookIds = Array.from(new Set(this.data.scanItems.map((item) => item.user_book_id).filter(Boolean)));
    let addedCount = 0;
    await processInChunks(userBookIds, async (chunk) => {
      const result = await services.bookshelf("addBooks", {
        bookshelf_id: shelf.bookshelf_id,
        user_book_ids: chunk
      });
      addedCount += result.added_count || 0;
    });
    track("books_added_to_shelf", { source: "continuous_scan" });
    return addedCount;
  },

  completeContinuousSession(shelfAddedCount) {
    this._sessionCompleted = true;
    track("continuous_scan_finished", { scan_mode: "continuous", scan_session_id: this.data.scanSessionId });
    try {
      wx.removeStorageSync(sessionStorageKey(this.data.scanSessionId));
      wx.removeStorageSync(CONTINUOUS_SCAN_STORAGE_KEY);
    } catch (_) {}
    wx.showToast({ title: "入馆完成", icon: "success" });
    wx.reLaunch({ url: "/pages/library/index" });
  },

  async confirmBatch() {
    if (this.data.submitting || !this.data.scanItems.length) return;
    this._autoScanning = false;
    this.clearScanTimer();
    const isRetry = this.data.submissionStarted;
    let scanItems = this.data.scanItems.map((item) => isRetry
      ? resetFailedCommitOperations(item, createRequestId)
      : item);
    scanItems = scanItems.map((item) => prepareCommitOperations(item, createRequestId));
    this.setData({
      scanItems,
      submissionStarted: true,
      submitting: true,
      submitError: "",
      scanState: "ready",
      ...sessionTotals(scanItems)
    });
    if (this.persistSession() === false) {
      this.setData({
        submissionStarted: false,
        submitting: false,
        submitError: "保存本轮进度失败，请检查小程序存储空间后重试。"
      });
      return;
    }
    try {
      const allCommitted = await this.commitPendingItems();
      if (!allCommitted) {
        this.setData({ submitError: "部分绘本尚未入馆，请检查后重试失败项。" });
        return;
      }
      const shelfAddedCount = await this.addCommittedBooksToShelf();
      this.completeContinuousSession(shelfAddedCount);
    } catch (error) {
      this.setData({ submitError: error.message || "提交失败，请稍后重试" });
      this.persistSession();
    } finally {
      this.setData({ submitting: false });
    }
  },

  retryFailedItems() {
    this.confirmBatch();
  },

  backToLibrary() {
    wx.reLaunch({ url: "/pages/library/index" });
  },

  goManual() {
    if (this.data.mode === "continuous") this.stopContinuousScan();
    wx.navigateTo({ url: `/pages/manual-book-edit/index${this.data.isbn ? `?isbn=${this.data.isbn}` : ""}` });
  }
});
