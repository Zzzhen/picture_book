const { services } = require("../../services/api");

async function loadAllShelfBooks(bookshelfId) {
  const items = [];
  let cursor;
  do {
    const page = await services.bookshelf("listShelfBooks", { bookshelf_id: bookshelfId, cursor, limit: 50 });
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor && items.length < 500);
  return items.slice(0, 500);
}

async function processInChunks(items, handler) {
  for (let index = 0; index < items.length; index += 50) {
    await handler(items.slice(index, index + 50));
  }
}

function mapBook(item, selected = false) {
  return {
    _id: item.user_book_id,
    userBookId: item.user_book_id,
    title: item.edition.title,
    author: item.edition.contributors_text,
    coverUrl: item.edition.cover_url || "",
    quantity: item.quantity,
    selected
  };
}

Page({
  data: {
    id: "",
    state: "loading",
    errorMessage: "",
    shelf: {},
    books: [],
    mode: "normal",
    selectedIds: [],
    selectedCount: 0,
    allSelected: false,
    operating: "",
    removeVisible: false
  },

  onLoad(query) {
    this.setData({ id: query.id || "" });
  },

  onShow() {
    if (this.data.id && !this.data.operating) this.loadShelf();
  },

  async loadShelf() {
    this.setData({ state: "loading", errorMessage: "" });
    try {
      const [shelves, items] = await Promise.all([
        services.bookshelf("listShelves", {}),
        loadAllShelfBooks(this.data.id)
      ]);
      const shelf = shelves.items.find((item) => item.bookshelf_id === this.data.id);
      if (!shelf) throw new Error("书架不存在或已被删除");
      const books = items.map((item) => mapBook(item));
      this.setData({
        shelf,
        books,
        state: books.length ? "content" : "empty",
        mode: "normal",
        selectedIds: [],
        selectedCount: 0,
        allSelected: false
      });
    } catch (error) {
      this.setData({ state: "error", errorMessage: error.message || "请稍后重新加载" });
    }
  },

  reload() { this.loadShelf(); },

  editShelf() {
    wx.navigateTo({ url: `/pages/bookshelf-edit/index?id=${this.data.id}` });
  },

  addBooks() {
    wx.navigateTo({ url: `/pages/bookshelf-book-picker/index?id=${this.data.id}` });
  },

  startSelecting() {
    if (!this.data.books.length || this.data.operating) return;
    this.setData({
      mode: "selecting",
      selectedIds: [],
      selectedCount: 0,
      allSelected: false,
      books: this.data.books.map((book) => ({ ...book, selected: false }))
    });
  },

  cancelSelecting() {
    this.setData({
      mode: "normal",
      selectedIds: [],
      selectedCount: 0,
      allSelected: false,
      removeVisible: false,
      books: this.data.books.map((book) => ({ ...book, selected: false }))
    });
  },

  applySelection(selectedIds) {
    const selected = new Set(selectedIds);
    this.setData({
      selectedIds: Array.from(selected),
      selectedCount: selected.size,
      allSelected: this.data.books.length > 0 && selected.size === this.data.books.length,
      books: this.data.books.map((book) => ({ ...book, selected: selected.has(book.userBookId) }))
    });
  },

  toggleBook(event) {
    if (this.data.mode !== "selecting" || this.data.operating) return;
    const id = event.detail.book.userBookId;
    const selected = new Set(this.data.selectedIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    this.applySelection(selected);
  },

  toggleAll() {
    if (this.data.operating) return;
    this.applySelection(this.data.allSelected ? [] : this.data.books.map((book) => book.userBookId));
  },

  openBook(event) {
    if (this.data.mode !== "normal") return;
    wx.navigateTo({ url: `/pages/book-detail/index?id=${event.detail.book.userBookId}` });
  },

  askRemove() {
    if (!this.data.selectedCount || this.data.operating) return;
    this.setData({ removeVisible: true });
  },

  closeRemove() {
    if (!this.data.operating) this.setData({ removeVisible: false });
  },

  async removeSelected() {
    if (!this.data.selectedCount || this.data.operating) return;
    const selectedIds = [...this.data.selectedIds];
    this.setData({ operating: "removing", removeVisible: false });
    try {
      await processInChunks(selectedIds, (chunk) => services.bookshelf("removeBooks", {
        bookshelf_id: this.data.id,
        user_book_ids: chunk
      }));
      wx.showToast({ title: `已移出 ${selectedIds.length} 本`, icon: "success" });
    } catch (error) {
      wx.showToast({ title: "部分操作可能未完成，请重试", icon: "none" });
    } finally {
      this.cancelSelecting();
      await this.loadShelf();
      this.setData({ operating: "" });
    }
  },

  async pinSelected() {
    if (!this.data.selectedCount || this.data.operating) return;
    const selectedIds = [...this.data.selectedIds];
    this.setData({ operating: "pinning" });
    try {
      await services.bookshelf("pinBooks", { bookshelf_id: this.data.id, user_book_ids: selectedIds });
      wx.showToast({ title: "已在此书架置顶", icon: "success" });
    } catch (error) {
      wx.showToast({ title: "置顶失败，请重试", icon: "none" });
    } finally {
      this.cancelSelecting();
      await this.loadShelf();
      this.setData({ operating: "" });
    }
  }
});
