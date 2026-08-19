const { services } = require("../../services/api");

const PAGE_SIZE = 6;
const MAX_BOOKS = 500;
const ICON_ROOT = "/assets/shelf-icons/";
const ICON_RULES = [
  ["睡前", "sleep-before-bedtime"],
  ["自然", "nature-exploration"],
  ["情绪", "emotional-growth"],
  ["艺术", "art-enlightenment"],
  ["亲子", "parent-child-time"],
  ["科学", "science-discovery"],
  ["语言", "language-expression"],
  ["动物", "animal-world"],
  ["节日", "festival-stories"],
  ["传统", "traditional-culture"]
];
const TONE_RULES = [
  ["睡前", "amber"],
  ["自然", "sage"],
  ["情绪", "amber"],
  ["艺术", "blue"]
];

function resolveShelfIcon(name = "") {
  const rule = ICON_RULES.find(([keyword]) => name.includes(keyword));
  return `${ICON_ROOT}${rule ? rule[1] : "nature-exploration"}.png`;
}

function resolveShelfTone(name = "") {
  const rule = TONE_RULES.find(([keyword]) => name.includes(keyword));
  return rule ? rule[1] : "sage";
}

function mapShelf(item) {
  const name = item.name || "未命名书架";
  const bookCount = Number(item.book_count) || 0;
  return {
    _id: item.bookshelf_id,
    name,
    description: item.description || "",
    bookCount,
    icon: resolveShelfIcon(name),
    tone: resolveShelfTone(name),
    expanded: false,
    books: [],
    pageBooks: [],
    currentPage: 0,
    totalPages: Math.max(1, Math.ceil(bookCount / PAGE_SIZE)),
    booksLoaded: false,
    booksLoading: false,
    booksError: ""
  };
}

function mapBook(item) {
  const edition = item.edition || {};
  return {
    _id: item.user_book_id,
    title: edition.title || "未命名绘本",
    author: edition.contributors_text || "",
    coverUrl: edition.cover_url || item.cover_url || "",
    quantity: item.quantity || 1
  };
}

Page({
  data: {
    state: "loading",
    shelves: [],
    errorMessage: "",
    statusHeight: 20,
    navigationHeight: 44,
    headerHeight: 64
  },

  onLoad() {
    this.loadHeaderMetrics();
    this.loadShelves();
  },

  loadHeaderMetrics() {
    if (typeof wx.getWindowInfo !== "function") return;
    const windowInfo = wx.getWindowInfo();
    const statusHeight = Number(windowInfo.statusBarHeight) || 20;
    const menu = typeof wx.getMenuButtonBoundingClientRect === "function"
      ? wx.getMenuButtonBoundingClientRect()
      : null;
    const navigationHeight = menu
      ? Math.max(44, Math.round(menu.height + (menu.top - statusHeight) * 2))
      : 44;
    this.setData({ statusHeight, navigationHeight, headerHeight: statusHeight + navigationHeight });
  },

  onShow() {
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ selected: 1 });
    if (this.loadedOnce) this.loadShelves();
    this.loadedOnce = true;
  },

  async loadShelves() {
    this.setData({ state: "loading", errorMessage: "" });
    try {
      const data = await services.bookshelf("listShelves", {});
      const shelves = (data.items || []).map(mapShelf);
      const state = shelves.length ? "content" : "empty";
      if (!shelves.length) {
        this.setData({ shelves, state });
        return;
      }

      const expandedIndex = shelves.length > 1 ? 1 : 0;
      shelves[expandedIndex].expanded = true;
      this.setData({ shelves, state: "content" }, () => this.loadShelfBooks(expandedIndex));
    } catch (error) {
      this.setData({ state: "error", errorMessage: error.message || "请稍后重试" });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadShelfBooks(index) {
    const shelf = this.data.shelves[index];
    if (!shelf || shelf.booksLoaded || shelf.booksLoading) return;
    this.setData({
      [`shelves[${index}].booksLoading`]: true,
      [`shelves[${index}].booksError`]: ""
    });

    try {
      const items = [];
      let cursor;
      do {
        const page = await services.bookshelf("listShelfBooks", {
          bookshelf_id: shelf._id,
          cursor,
          limit: 50
        });
        Array.prototype.push.apply(items, page.items || []);
        cursor = page.next_cursor;
      } while (cursor && items.length < MAX_BOOKS);

      const books = items.slice(0, MAX_BOOKS).map(mapBook);
      const totalPages = Math.max(1, Math.ceil(books.length / PAGE_SIZE));
      this.setData({
        [`shelves[${index}].books`]: books,
        [`shelves[${index}].pageBooks`]: books.slice(0, PAGE_SIZE),
        [`shelves[${index}].bookCount`]: books.length || shelf.bookCount,
        [`shelves[${index}].totalPages`]: totalPages,
        [`shelves[${index}].currentPage`]: 0,
        [`shelves[${index}].booksLoaded`]: true,
        [`shelves[${index}].booksLoading`]: false
      });
    } catch (error) {
      this.setData({
        [`shelves[${index}].booksLoading`]: false,
        [`shelves[${index}].booksError`]: error.message || "书籍加载失败"
      });
    }
  },

  toggleShelf(event) {
    const index = Number(event.currentTarget.dataset.index);
    const shelf = this.data.shelves[index];
    if (!shelf) return;
    const shelves = this.data.shelves.map((item, itemIndex) => ({
      ...item,
      expanded: itemIndex === index ? !item.expanded : false
    }));
    this.setData({ shelves });
    if (!shelf.expanded) this.loadShelfBooks(index);
  },

  goShelfPage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const direction = Number(event.currentTarget.dataset.direction);
    this.changeShelfPage(index, direction);
  },

  changeShelfPage(index, direction) {
    const shelf = this.data.shelves[index];
    if (!shelf || !shelf.expanded || !shelf.booksLoaded) return;
    const page = Math.max(0, Math.min(shelf.totalPages - 1, shelf.currentPage + direction));
    if (page === shelf.currentPage) return;
    this.setData({
      [`shelves[${index}].currentPage`]: page,
      [`shelves[${index}].pageBooks`]: shelf.books.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    });
  },

  onShelfTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    this._shelfTouch = {
      index: Number(event.currentTarget.dataset.index),
      x: touch.clientX,
      y: touch.clientY
    };
  },

  onShelfTouchEnd(event) {
    const start = this._shelfTouch;
    const touch = event.changedTouches && event.changedTouches[0];
    this._shelfTouch = null;
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    this.changeShelfPage(start.index, deltaX < 0 ? 1 : -1);
  },

  onPullDownRefresh() {
    this.loadShelves();
  },

  createShelf() {
    wx.navigateTo({ url: "/pages/bookshelf-edit/index?new=1" });
  },

  openShelf(event) {
    const id = event && event.detail && event.detail.shelf && event.detail.shelf._id;
    if (id) wx.navigateTo({ url: `/pages/bookshelf-detail/index?id=${id}` });
  },

  reload() {
    this.loadShelves();
  }
});
