const { services } = require("../../services/api");
const { validateShelf } = require("../../utils/validation");
const { track } = require("../../services/analytics");

async function loadAllPages(loader, payload, maxItems = 500) {
  const items = [];
  let cursor;
  do {
    const page = await loader({ ...payload, cursor, limit: 50 });
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor && items.length < maxItems);
  return { items: items.slice(0, maxItems) };
}

async function processInChunks(items, handler) {
  for (let index = 0; index < items.length; index += 50) {
    await handler(items.slice(index, index + 50));
  }
}

Page({
  data: {
    id: "",
    isNew: false,
    saving: false,
    form: { name: "", description: "" },
    errors: {},
    books: [],
    displayBooks: [],
    initialSelectedIds: [],
    selectedIds: [],
    selectedCount: 0,
    allSelected: false,
    keyword: "",
    state: "loading",
    deleteVisible: false
  },

  onLoad(query) {
    this.setData({ id: query.id || "", isNew: query.new === "1", presetIds: (query.select || "").split(",").filter(Boolean), focusBookId: query.bookId || "" });
    this.loadEditor();
  },

  async loadEditor() {
    try {
      const requests = [loadAllPages((payload) => services.library("listBooks", payload), { sort: "newest" })];
      if (!this.data.isNew && this.data.id) {
        requests.push(services.bookshelf("listShelves", {}));
        requests.push(loadAllPages(
          (payload) => services.bookshelf("listShelfBooks", payload),
          { bookshelf_id: this.data.id }
        ));
      }
      const [library, shelves, shelfBooks] = await Promise.all(requests);
      const selectedIds = new Set(this.data.presetIds || []);
      if (this.data.focusBookId) selectedIds.add(this.data.focusBookId);
      if (shelfBooks) shelfBooks.items.forEach((item) => selectedIds.add(item.user_book_id));
      const books = library.items.map((item) => ({
        _id: item.user_book_id,
        userBookId: item.user_book_id,
        title: item.edition.title,
        author: item.edition.contributors_text,
        coverUrl: item.edition.cover_file_id || "",
        quantity: item.quantity,
        selected: selectedIds.has(item.user_book_id)
      }));
      const shelf = shelves && shelves.items.find((item) => item.bookshelf_id === this.data.id);
      this.setData({
        form: shelf ? { name: shelf.name, description: shelf.description || "" } : this.data.form,
        books,
        displayBooks: books,
        initialSelectedIds: Array.from(selectedIds),
        selectedIds: Array.from(selectedIds),
        selectedCount: selectedIds.size,
        allSelected: books.length > 0 && selectedIds.size === books.length,
        state: books.length ? "content" : "empty"
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  onName(event) {
    this.setData({ "form.name": event.detail.value, "errors.name": "" });
  },

  onDescription(event) {
    this.setData({ "form.description": event.detail.value });
  },

  async onSearch(event) {
    const keyword = event.detail.value.trim().toLowerCase();
    this.setData({ keyword });
    if (!keyword) {
      this.setData({ displayBooks: this.data.books, state: this.data.books.length ? "content" : "empty" });
      return;
    }
    try {
      const page = await loadAllPages(
        (payload) => services.library("listBooks", payload),
        { query: keyword, sort: "newest" }
      );
      if (keyword !== this.data.keyword) return;
      const selected = new Set(this.data.selectedIds);
      const displayBooks = page.items.map((item) => ({
        _id: item.user_book_id,
        userBookId: item.user_book_id,
        title: item.edition.title,
        author: item.edition.contributors_text,
        coverUrl: item.edition.cover_file_id || "",
        quantity: item.quantity,
        selected: selected.has(item.user_book_id)
      }));
      this.setData({ displayBooks, state: displayBooks.length ? "content" : "search-empty" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  toggleBook(event) {
    const id = event.detail.book.userBookId;
    const selected = new Set(this.data.selectedIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    const books = this.data.books.map((book) => ({ ...book, selected: selected.has(book.userBookId) }));
    const displayBooks = this.data.displayBooks.map((book) => ({ ...book, selected: selected.has(book.userBookId) }));
    this.setData({ books, displayBooks, selectedIds: Array.from(selected), selectedCount: selected.size, allSelected: displayBooks.length > 0 && displayBooks.every((book) => selected.has(book.userBookId)) });
  },

  toggleAll() {
    const selected = !this.data.allSelected;
    const selectedIds = new Set(this.data.selectedIds);
    this.data.displayBooks.forEach((book) => selected ? selectedIds.add(book.userBookId) : selectedIds.delete(book.userBookId));
    const books = this.data.books.map((book) => ({ ...book, selected: selectedIds.has(book.userBookId) }));
    const displayBooks = this.data.displayBooks.map((book) => ({ ...book, selected }));
    this.setData({ books, displayBooks, selectedIds: Array.from(selectedIds), allSelected: selected, selectedCount: selectedIds.size });
  },

  async save() {
    if (this.data.saving) return;
    const errors = validateShelf(this.data.form);
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    this.setData({ saving: true });
    try {
      let id = this.data.id;
      if (this.data.isNew) {
        const result = await services.bookshelf("createShelf", { name: this.data.form.name, description: this.data.form.description || undefined });
        id = result.bookshelf.bookshelf_id;
        track("bookshelf_created", { source: "bookshelf_editor" });
      } else {
        await services.bookshelf("updateShelf", { bookshelf_id: id, patch: { name: this.data.form.name, description: this.data.form.description } });
      }
      const selected = this.data.selectedIds;
      const initial = new Set(this.data.initialSelectedIds);
      const current = new Set(selected);
      const add = selected.filter((bookId) => !initial.has(bookId));
      const remove = Array.from(initial).filter((bookId) => !current.has(bookId));
      if (add.length) await processInChunks(add, (chunk) =>
        services.bookshelf("addBooks", { bookshelf_id: id, user_book_ids: chunk })
      );
      if (add.length) track("books_added_to_shelf", { source: "bookshelf_editor" });
      if (remove.length) await processInChunks(remove, (chunk) =>
        services.bookshelf("removeBooks", { bookshelf_id: id, user_book_ids: chunk })
      );
      wx.redirectTo({ url: `/pages/bookshelf-detail/index?id=${id}` });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  askDelete() { this.setData({ deleteVisible: true }); },
  closeDelete() { this.setData({ deleteVisible: false }); },

  async deleteShelf() {
    try {
      await services.bookshelf("deleteShelf", { bookshelf_id: this.data.id, confirm: true });
      wx.switchTab({ url: "/pages/bookshelves/index" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  }
});
