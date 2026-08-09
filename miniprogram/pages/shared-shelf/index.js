const { services } = require("../../services/api");

function mapBook(item) {
  return {
    userBookId: item.user_book_id,
    title: item.edition.title,
    author: item.edition.contributors_text,
    coverUrl: item.edition.cover_url || "",
    quantity: item.quantity
  };
}

Page({
  data: {
    token: "",
    state: "loading",
    errorMessage: "",
    shelf: {},
    shareReason: "",
    books: []
  },

  onLoad(query) {
    const token = query.token || "";
    this.setData({ token });
    if (token) this.loadSharedShelf(token);
    else this.setData({ state: "error", errorMessage: "分享链接不完整" });
  },

  async loadSharedShelf(token = this.data.token) {
    this.setData({ state: "loading", errorMessage: "" });
    try {
      const data = await services.share("getSharedShelf", { token });
      const books = (data.books || []).map(mapBook);
      this.setData({ shelf: data.bookshelf || {}, shareReason: data.share && data.share.reason || "", books, state: "content" });
    } catch (error) {
      this.setData({ state: "error", errorMessage: error.message || "分享链接已失效" });
    }
  },

  reload() {
    if (this.data.token) this.loadSharedShelf();
  }
});
