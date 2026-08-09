const { services } = require("../../services/api");

const DAILY_PICK_PREFIX = "v1_core_daily_pick_";
const MAX_DISPLAY_BOOKS = 10;

function mapBook(item) {
  const edition = item.edition || {};
  return {
    userBookId: item.user_book_id,
    title: edition.title,
    author: edition.contributors_text,
    coverUrl: edition.cover_url || "",
    reviewStatus: edition.audit_status,
    preference: item.preference
  };
}

function shuffled(items) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

Component({
  data: {
    state: "loading",
    book: null,
    displayBooks: [],
    swiperCurrent: 0,
    swiperDuration: 260,
    errorMessage: ""
  },

  lifetimes: {
    attached() {
      this._pageVisible = true;
      this._handleAccelerometer = this.handleAccelerometer.bind(this);
      this.restoreDailyPick();
      this.prepareCandidates();
      this.startShakeListener();
    },

    detached() {
      this._pageVisible = false;
      this.stopShakeListener();
      this.clearTimers();
    }
  },

  pageLifetimes: {
    show() {
      this._pageVisible = true;
      this.prepareCandidates(true);
      this.startShakeListener();
    },

    hide() {
      this._pageVisible = false;
      this.stopShakeListener();
      this.cancelDraw();
    }
  },

  methods: {
    dailyPickKey() {
      const now = new Date();
      const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
      return `${DAILY_PICK_PREFIX}${day}`;
    },

    restoreDailyPick() {
      const cached = wx.getStorageSync(this.dailyPickKey());
      if (!cached || !cached.userBookId) return;
      this.setData({ state: "result", book: cached, displayBooks: [cached], swiperCurrent: 0 });
    },

    eligibleBooks(books) {
      return (books || []).filter((book) => book
        && book.userBookId
        && book.preference !== "not_recommended"
        && book.reviewStatus !== "pending"
        && book.reviewStatus !== "rejected");
    },

    makeDisplayBooks(candidates, preferred) {
      const preferredBook = preferred && candidates.find((item) => item.userBookId === preferred.userBookId);
      const remaining = preferredBook
        ? candidates.filter((item) => item.userBookId !== preferredBook.userBookId)
        : candidates;
      const picked = shuffled(remaining).slice(0, preferredBook ? MAX_DISPLAY_BOOKS - 1 : MAX_DISPLAY_BOOKS);
      return preferredBook ? [preferredBook].concat(picked) : picked;
    },

    async fetchCandidates(force = false) {
      if (force && !this._candidatePromise) this._candidates = null;
      if (this._candidates) return this._candidates;
      if (this._candidatePromise) return this._candidatePromise;
      this._candidatePromise = (async () => {
        const collected = [];
        const seen = new Set();
        let cursor;
        let pages = 0;
        do {
          const page = await services.library("listBooks", { sort: "newest", cursor, limit: 24 });
          (page.items || []).map(mapBook).forEach((book) => {
            if (!seen.has(book.userBookId)) {
              seen.add(book.userBookId);
              collected.push(book);
            }
          });
          cursor = page.next_cursor;
          pages += 1;
        } while (cursor && pages < 24);
        this._candidates = this.eligibleBooks(collected);
        return this._candidates;
      })();
      try {
        return await this._candidatePromise;
      } finally {
        this._candidatePromise = null;
      }
    },

    async prepareCandidates(force = false) {
      try {
        const candidates = await this.fetchCandidates(force);
        if (!this._pageVisible) return;
        if (!candidates.length) {
          this.setData({ state: "empty", book: null, displayBooks: [], errorMessage: "" });
          return;
        }
        const preferred = this.data.book && candidates.find((item) => item.userBookId === this.data.book.userBookId);
        const displayBooks = this.makeDisplayBooks(candidates, preferred);
        const currentIndex = preferred ? displayBooks.findIndex((item) => item.userBookId === preferred.userBookId) : 0;
        const currentBook = displayBooks[Math.max(0, currentIndex)];
        this.setData({
          state: this.data.state === "result" && preferred ? "result" : "ready",
          book: currentBook,
          displayBooks,
          swiperCurrent: Math.max(0, currentIndex),
          swiperDuration: 260,
          errorMessage: ""
        });
      } catch (_) {
        if (!this._pageVisible || this.data.state === "result") return;
        this.setData({ state: "error", errorMessage: "暂时无法读取馆藏，请稍后重试" });
      }
    },

    onSwiperChange(event) {
      const current = Number(event.detail.current) || 0;
      const book = this.data.displayBooks[current];
      if (!book) return;
      this.setData({ swiperCurrent: current, book });
      if (this._autoSelecting || event.detail.source !== "touch") return;
      if (this.data.state === "result") this.setData({ state: "ready" });
    },

    async startDraw() {
      if (this.data.state === "rolling" || this.data.state === "loading") return;
      let books = this.data.displayBooks;
      if (!books.length) {
        try {
          const candidates = await this.fetchCandidates();
          books = this.makeDisplayBooks(candidates, this.data.book);
          this.setData({ displayBooks: books, swiperCurrent: 0, book: books[0] || null });
        } catch (_) {
          if (this._pageVisible) wx.showToast({ title: "暂时没选出来，请稍后重试", icon: "none" });
          return;
        }
      }
      if (!this._pageVisible || !books.length) return;
      if (books.length === 1) {
        this.settleOnBook(0);
        return;
      }

      const startIndex = this.data.swiperCurrent;
      const choices = books.map((_, index) => index).filter((index) => index !== startIndex);
      const finalIndex = choices[Math.floor(Math.random() * choices.length)];
      const offset = (finalIndex - startIndex + books.length) % books.length;
      const totalSteps = books.length + offset;
      this._autoSelecting = true;
      this._autoTotalSteps = totalSteps;
      this.setData({ state: "rolling" });
      this.advanceAutoSlide(totalSteps, finalIndex);
    },

    advanceAutoSlide(remaining, finalIndex) {
      if (!this._pageVisible) return;
      if (remaining <= 0) {
        this._autoSelecting = false;
        this.settleOnBook(finalIndex);
        return;
      }
      const books = this.data.displayBooks;
      const completed = this._autoTotalSteps - remaining;
      const progress = completed / Math.max(1, this._autoTotalSteps - 1);
      const duration = Math.round(90 + 260 * progress * progress);
      const nextIndex = (this.data.swiperCurrent + 1) % books.length;
      this.setData({
        swiperCurrent: nextIndex,
        swiperDuration: duration,
        book: books[nextIndex]
      });
      this._timers = [setTimeout(() => this.advanceAutoSlide(remaining - 1, finalIndex), duration + 34)];
    },

    settleOnBook(index) {
      const book = this.data.displayBooks[index];
      if (!book) return;
      this.setData({ state: "result", book, swiperCurrent: index, swiperDuration: 320 });
      wx.setStorageSync(this.dailyPickKey(), book);
      if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
    },

    openBook() {
      const book = this.data.book;
      if (book && book.userBookId) wx.navigateTo({ url: `/pages/book-detail/index?id=${book.userBookId}` });
    },

    goAddBook() {
      wx.navigateTo({ url: "/pages/add-book/index" });
    },

    retry() {
      this.setData({ state: "loading", errorMessage: "" });
      this.prepareCandidates(true);
    },

    startShakeListener() {
      if (this._accelerometerListening || this._accelerometerStarting || !this._handleAccelerometer) return;
      this._accelerometerStarting = true;
      wx.startAccelerometer({
        interval: "ui",
        success: () => {
          this._accelerometerStarting = false;
          this._accelerometerListening = true;
          this._lastAcceleration = null;
          wx.onAccelerometerChange(this._handleAccelerometer);
          if (!this._pageVisible) this.stopShakeListener();
        },
        fail: () => { this._accelerometerStarting = false; }
      });
    },

    stopShakeListener() {
      if (!this._accelerometerListening) return;
      if (wx.offAccelerometerChange) wx.offAccelerometerChange(this._handleAccelerometer);
      wx.stopAccelerometer({});
      this._accelerometerListening = false;
      this._lastAcceleration = null;
    },

    handleAccelerometer(current) {
      const previous = this._lastAcceleration;
      this._lastAcceleration = current;
      if (!previous || !["ready", "result"].includes(this.data.state)) return;
      const movement = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y) + Math.abs(current.z - previous.z);
      const now = Date.now();
      if (movement > 2.6 && now - (this._lastShakeAt || 0) > 1800) {
        this._lastShakeAt = now;
        this.startDraw();
      }
    },

    clearTimers() {
      (this._timers || []).forEach(clearTimeout);
      this._timers = [];
      this._autoSelecting = false;
    },

    cancelDraw() {
      if (this.data.state !== "rolling") {
        this.clearTimers();
        return;
      }
      this.clearTimers();
      const cached = wx.getStorageSync(this.dailyPickKey());
      const cachedIndex = cached && cached.userBookId
        ? this.data.displayBooks.findIndex((item) => item.userBookId === cached.userBookId)
        : -1;
      const index = cachedIndex >= 0 ? cachedIndex : this.data.swiperCurrent;
      const book = this.data.displayBooks[index];
      this.setData(book
        ? { state: cachedIndex >= 0 ? "result" : "ready", book, swiperCurrent: index }
        : { state: "loading", book: null, displayBooks: [] });
    }
  }
});
