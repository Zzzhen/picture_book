const { services } = require("../../services/api");

async function loadAllPages(loader, payload, maxItems = 500) {
  const items = [];
  let cursor;
  do {
    const page = await loader({ ...payload, cursor, limit: 50 });
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor && items.length < maxItems);
  return items.slice(0, maxItems);
}

async function processInChunks(items, handler) {
  for (let index = 0; index < items.length; index += 50) {
    await handler(items.slice(index, index + 50));
  }
}

function mapBook(item, selectedIds) {
  const edition = item.edition || {};
  return {
    _id: item.user_book_id,
    userBookId: item.user_book_id,
    title: edition.title || "未命名绘本",
    author: edition.contributors_text || "作者待补充",
    coverUrl: edition.cover_file_id || "",
    quantity: item.quantity,
    selected: selectedIds.has(item.user_book_id),
    searchText: [edition.title, edition.contributors_text, edition.publisher, edition.isbn13]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  };
}

Page({
  data: {
    id: "",
    created: false,
    shelf: {},
    state: "loading",
    errorMessage: "",
    books: [],
    displayBooks: [],
    keyword: "",
    selectedIds: [],
    selectedCount: 0,
    allSelected: false,
    saving: false,
    presetIds: []
  },

  onLoad(query) {
    this.setData({
      id: query.id || "",
      created: query.created === "1",
      presetIds: decodeURIComponent(query.select || "").split(",").filter(Boolean)
    });
    this.loadPicker();
  },

  async loadPicker() {
    this.setData({ state: "loading", errorMessage: "" });
    try {
      const [library, shelfBooks, shelves] = await Promise.all([
        loadAllPages((payload) => services.library("listBooks", payload), { sort: "newest" }),
        loadAllPages((payload) => services.bookshelf("listShelfBooks", payload), { bookshelf_id: this.data.id }),
        services.bookshelf("listShelves", {})
      ]);
      const existingIds = new Set(shelfBooks.map((item) => item.user_book_id));
      const available = library.filter((item) => !existingIds.has(item.user_book_id));
      const availableIds = new Set(available.map((item) => item.user_book_id));
      const selectedIds = new Set(this.data.presetIds.filter((id) => availableIds.has(id)));
      const books = available.map((item) => mapBook(item, selectedIds));
      const shelf = shelves.items.find((item) => item.bookshelf_id === this.data.id);
      if (!shelf) throw new Error("书架不存在或已被删除");
      this.setData({ shelf, books, displayBooks: books, state: books.length ? "content" : "empty" });
      this.applySelection(selectedIds);
    } catch (error) {
      this.setData({ state: "error", errorMessage: error.message || "请稍后重新加载" });
    }
  },

  reload() { this.loadPicker(); },

  onSearch(event) {
    const keyword = (event.detail.value || "").trim().toLowerCase();
    const displayBooks = keyword
      ? this.data.books.filter((book) => book.searchText.includes(keyword))
      : this.data.books;
    this.setData({
      keyword,
      displayBooks,
      state: displayBooks.length ? "content" : keyword ? "search-empty" : this.data.books.length ? "content" : "empty"
    });
    this.syncAllSelected(displayBooks, new Set(this.data.selectedIds));
  },

  clearSearch() {
    this.onSearch({ detail: { value: "" } });
  },

  applySelection(selectedIds) {
    const selected = new Set(selectedIds);
    const books = this.data.books.map((book) => ({ ...book, selected: selected.has(book.userBookId) }));
    const displayBooks = this.data.displayBooks.map((book) => ({ ...book, selected: selected.has(book.userBookId) }));
    this.setData({ books, displayBooks, selectedIds: Array.from(selected), selectedCount: selected.size });
    this.syncAllSelected(displayBooks, selected);
  },

  syncAllSelected(displayBooks, selectedIds) {
    this.setData({
      allSelected: displayBooks.length > 0 && displayBooks.every((book) => selectedIds.has(book.userBookId))
    });
  },

  toggleBook(event) {
    if (this.data.saving) return;
    const id = event.detail.book.userBookId;
    const selected = new Set(this.data.selectedIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    this.applySelection(selected);
  },

  toggleAll() {
    if (this.data.saving || !this.data.displayBooks.length) return;
    const selected = new Set(this.data.selectedIds);
    this.data.displayBooks.forEach((book) => {
      if (this.data.allSelected) selected.delete(book.userBookId);
      else selected.add(book.userBookId);
    });
    this.applySelection(selected);
  },

  async save() {
    if (this.data.saving || !this.data.selectedCount) return;
    const selectedIds = [...this.data.selectedIds];
    this.setData({ saving: true });
    try {
      await processInChunks(selectedIds, (chunk) => services.bookshelf("addBooks", {
        bookshelf_id: this.data.id,
        user_book_ids: chunk
      }));
      wx.showToast({ title: `已加入 ${selectedIds.length} 本`, icon: "success" });
      if (this.data.created) {
        wx.redirectTo({ url: `/pages/bookshelf-detail/index?id=${this.data.id}` });
      } else {
        wx.navigateBack();
      }
    } catch (error) {
      wx.showToast({ title: error.message || "加入失败，请重试", icon: "none" });
      this.setData({ presetIds: selectedIds });
      await this.loadPicker();
    } finally {
      this.setData({ saving: false });
    }
  }
});
