const { services } = require("../../services/api");

const DAILY_PICK_PREFIX = "v1_core_daily_pick_";

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

Component({
  data: {
    state: "idle",
    book: null
  },

  lifetimes: {
    attached() {
      this._pageVisible = true;
      this._handleAccelerometer = this.handleAccelerometer.bind(this);
      this.restoreDailyPick();
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
      this._candidates = null;
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
      if (cached && cached.userBookId) this.setData({ state: "result", book: cached });
    },

    eligibleBooks(books) {
      return (books || []).filter((book) => book
        && book.userBookId
        && book.preference !== "not_recommended"
        && book.reviewStatus !== "pending"
        && book.reviewStatus !== "rejected");
    },

    async fetchCandidates() {
      if (this._candidates) return this._candidates;
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
    },

    async startDraw() {
      if (this.data.state === "rolling") return;
      this.setData({ state: "rolling" });
      let candidates;
      try {
        candidates = await this.fetchCandidates();
      } catch (_) {
        if (!this._pageVisible) return;
        const cached = wx.getStorageSync(this.dailyPickKey());
        this.setData(cached && cached.userBookId
          ? { state: "result", book: cached }
          : { state: "idle", book: null });
        wx.showToast({ title: "暂时没选出来，请稍后重试", icon: "none" });
        return;
      }
      if (!this._pageVisible) return;
      if (!candidates.length) {
        this.setData({ state: "idle", book: null });
        wx.showToast({ title: "先录入绘本，再来选一本吧", icon: "none" });
        return;
      }

      const previousId = this.data.book && this.data.book.userBookId;
      const pool = candidates.length > 1 ? candidates.filter((book) => book.userBookId !== previousId) : candidates;
      const finalBook = pool[Math.floor(Math.random() * pool.length)];
      const frames = [80, 100, 120, 150, 190, 240];
      this.clearTimers();
      frames.reduce((elapsed, delay, index) => {
        const nextElapsed = elapsed + delay;
        this._timers.push(setTimeout(() => {
          const preview = candidates[(Math.floor(Math.random() * candidates.length) + index) % candidates.length];
          this.setData({ book: preview });
        }, nextElapsed));
        return nextElapsed;
      }, 0);
      const settleAfter = frames.reduce((sum, value) => sum + value, 0) + 160;
      this._timers.push(setTimeout(() => {
        this.setData({ state: "result", book: finalBook });
        wx.setStorageSync(this.dailyPickKey(), finalBook);
        if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
      }, settleAfter));
    },

    openBook() {
      const book = this.data.book;
      if (book && book.userBookId) wx.navigateTo({ url: `/pages/book-detail/index?id=${book.userBookId}` });
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
      if (!previous || this.data.state === "rolling") return;
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
    },

    cancelDraw() {
      this.clearTimers();
      if (this.data.state !== "rolling") return;
      const cached = wx.getStorageSync(this.dailyPickKey());
      this.setData(cached && cached.userBookId
        ? { state: "result", book: cached }
        : { state: "idle", book: null });
    }
  }
});
