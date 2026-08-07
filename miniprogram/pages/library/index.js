const { services } = require("../../services/api");
const { track } = require("../../services/analytics");

const LIBRARY_REFRESH_KEY = "v1_core_library_needs_refresh";
const LIBRARY_REFRESH_TTL_MS = 60 * 1000;

function mapBook(item) {
  const edition = item.edition || {};
  return {
    _id: item.user_book_id,
    userBookId: item.user_book_id,
    title: edition.title,
    author: edition.contributors_text,
    publisher: edition.publisher,
    coverUrl: edition.cover_url || "",
    reviewStatus: edition.audit_status,
    quantity: item.quantity,
    preference: item.preference,
    selected: false
  };
}

Page({
  data: {
    state: "loading",
    view: "grid",
    books: [],
    total: 0,
    copies: 0,
    keyword: "",
    sort: "newest",
    sortLabel: "最近加入",
    filterCount: 0,
    preference: "",
    cover: "",
    cursor: null,
    paginationState: "idle",
    manageMode: false,
    selectedCount: 0
  },

  onLoad() {
    this.loadBooks(true);
    this.loadIdentity();
  },

  onShow() {
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ selected: 0 });
    const marker = Number(wx.getStorageSync(LIBRARY_REFRESH_KEY));
    if (!Number.isFinite(marker) || marker <= 0) return;
    wx.removeStorageSync(LIBRARY_REFRESH_KEY);
    if (Date.now() - marker <= LIBRARY_REFRESH_TTL_MS) this.refreshAfterReturn();
  },

  refreshAfterReturn() {
    if (this.data.paginationState === "loading") {
      this._refreshAfterLoad = true;
      return;
    }
    this.loadBooks(true);
  },

  async loadIdentity() {
    try {
      const data = await services.user("getProfile", {});
      this.setData({
        libraryName: data.user.library_name,
        childNickname: data.child.nickname,
        view: data.user.preferred_library_view || this.data.view
      });
    } catch (_) {}
  },

  async loadBooks(reset = false) {
    if (this.data.paginationState === "loading") return;
    this.setData(reset
      ? { state: "loading", cursor: null, books: [], paginationState: "loading" }
      : { paginationState: "loading" });
    try {
      const page = await services.library("listBooks", {
        query: this.data.keyword || undefined,
        preference: this.data.preference || undefined,
        cover: this.data.cover || undefined,
        sort: this.data.sort,
        cursor: reset ? undefined : this.data.cursor,
        limit: 24
      });
      const incoming = await Promise.all(page.items.map(mapBook));
      const books = reset ? incoming : this.data.books.concat(incoming);
      const copies = books.reduce((sum, book) => sum + (book.quantity || 1), 0);
      this.setData({
        books,
        total: books.length,
        copies,
        cursor: page.next_cursor,
        state: books.length ? "content" : this.data.keyword ? "search-empty" : "empty",
        paginationState: page.has_more ? "idle" : "end"
      });
    } catch (error) {
      this.setData({ state: "error", errorMessage: error.message, paginationState: "idle" });
    } finally {
      wx.stopPullDownRefresh();
      if (this._refreshAfterLoad) {
        this._refreshAfterLoad = false;
        this.loadBooks(true);
      }
    }
  },

  onPullDownRefresh() {
    this.loadBooks(true);
  },

  onReachBottom() {
    if (this.data.cursor) this.loadBooks(false);
  },

  onSearchInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  onSearch() {
    this.loadBooks(true);
  },

  onSearchClear() {
    this.setData({ keyword: "" });
    this.loadBooks(true);
  },

  onViewChange(event) {
    const view = event.detail.value;
    this.setData({ view });
    services.user("updateProfile", { user: { preferred_library_view: view } }).catch(() => {});
  },

  toggleManage() {
    this.setData({ manageMode: !this.data.manageMode, selectedCount: 0, books: this.data.books.map((book) => ({ ...book, selected: false })) });
  },

  selectBook(event) {
    const id = event.detail.book.userBookId;
    const books = this.data.books.map((book) => book.userBookId === id ? { ...book, selected: !book.selected } : book);
    this.setData({ books, selectedCount: books.filter((book) => book.selected).length });
  },

  openBook(event) {
    wx.navigateTo({ url: `/pages/book-detail/index?id=${event.detail.book.userBookId}` });
  },

  goAddBook() {
    track("add_book_clicked", { source: "library" });
    wx.navigateTo({ url: "/pages/add-book/index" });
  },

  async addToShelf() {
    const ids = this.data.books.filter((book) => book.selected).map((book) => book.userBookId);
    if (!ids.length) return;
    try {
      const data = await services.bookshelf("listShelves", {});
      const labels = data.items.map((item) => item.name).concat("新建书架");
      wx.showActionSheet({
        itemList: labels,
        success: async ({ tapIndex }) => {
          if (tapIndex === data.items.length) {
            wx.navigateTo({ url: `/pages/bookshelf-edit/index?new=1&select=${ids.join(",")}` });
            return;
          }
          try {
            await services.bookshelf("addBooks", { bookshelf_id: data.items[tapIndex].bookshelf_id, user_book_ids: ids });
            wx.showToast({ title: "已加入书架", icon: "success" });
            this.toggleManage();
          } catch (error) {
            wx.showToast({ title: error.message, icon: "none" });
          }
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  openFilter() {
    wx.showActionSheet({
      itemList: ["全部绘本", "孩子很喜欢", "评价一般", "不太喜欢", "有封面", "无封面"],
      success: ({ tapIndex }) => {
        const filters = [
          { preference: "", cover: "" },
          { preference: "recommended", cover: "" },
          { preference: "neutral", cover: "" },
          { preference: "not_recommended", cover: "" },
          { preference: "", cover: "with" },
          { preference: "", cover: "without" }
        ];
        const selected = filters[tapIndex];
        this.setData({ ...selected, filterCount: selected.preference || selected.cover ? 1 : 0 });
        track("library_filter_used", { source: selected.preference || selected.cover || "all" });
        this.loadBooks(true);
      }
    });
  },

  openSort() {
    wx.showActionSheet({
      itemList: ["最近加入", "最早加入", "按书名"],
      success: ({ tapIndex }) => {
        const values = [["newest", "最近加入"], ["oldest", "最早加入"], ["title", "按书名"]];
        this.setData({ sort: values[tapIndex][0], sortLabel: values[tapIndex][1] });
        this.loadBooks(true);
      }
    });
  },

  reload() {
    this.loadBooks(true);
  }
});
