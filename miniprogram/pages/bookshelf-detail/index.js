const { services } = require("../../services/api");

Page({
  data: { id: "", state: "loading", shelf: {}, books: [] },

  onLoad(query) {
    this.setData({ id: query.id || "" });
  },

  onShow() {
    if (this.data.id) this.loadShelf();
  },

  async loadShelf() {
    try {
      const [shelves, page] = await Promise.all([
        services.bookshelf("listShelves", {}),
        services.bookshelf("listShelfBooks", { bookshelf_id: this.data.id, limit: 50 })
      ]);
      const shelf = shelves.items.find((item) => item.bookshelf_id === this.data.id) || {};
      const books = page.items.map((item) => ({
        _id: item.user_book_id,
        userBookId: item.user_book_id,
        title: item.edition.title,
        author: item.edition.contributors_text,
        coverUrl: item.edition.cover_file_id || "",
        quantity: item.quantity
      }));
      this.setData({ shelf, books, state: books.length ? "content" : "empty" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  editShelf() {
    wx.navigateTo({ url: `/pages/bookshelf-edit/index?id=${this.data.id}` });
  },

  openBook(event) {
    wx.navigateTo({ url: `/pages/book-detail/index?id=${event.detail.book.userBookId}` });
  }
});
