const { services } = require("../../services/api");

Page({
  data: {
    book: {},
    isbn: "",
    editionId: "",
    source: "provider",
    sourceLabel: "ISBN 图书信息服务",
    duplicate: false,
    continuous: false,
    quantity: 1,
    submitting: false
  },

  onLoad(query) {
    this.setData({
      editionId: query.editionId || "",
      isbn: query.isbn || "",
      source: query.source || "provider",
      sourceLabel: query.source === "cache" ? "已查询书库" : "ISBN 图书信息服务",
      continuous: query.continuous === "1",
      scanSessionId: query.sessionId || ""
    });
    this.loadEdition();
  },

  async loadEdition() {
    try {
      const [data, owned] = await Promise.all([
        services.book("getEditionDetail", { edition_id: this.data.editionId }),
        services.library("listBooks", { query: this.data.isbn, limit: 1 })
      ]);
      const edition = data.edition;
      this.setData({
        duplicate: owned.items.some((item) => item.edition.edition_id === this.data.editionId),
        book: {
          title: edition.title,
          author: edition.contributors_text,
          publisher: edition.publisher,
          coverUrl: edition.cover_file_id || "",
          isbn13: edition.isbn13,
          binding: edition.binding_type,
          publishDate: edition.publish_date_text,
          priceText: edition.price_text,
          pageCount: edition.page_count_text
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  onQuantity(event) {
    this.setData({ quantity: event.detail.value });
  },

  async confirmAdd() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      let data;
      for (let index = 0; index < this.data.quantity; index += 1) {
        data = await services.library("addBook", {
          edition_id: this.data.editionId,
          quantity_delta: 1,
          scan_session_id: this.data.scanSessionId || undefined
        });
      }
      if (this.data.continuous) {
        wx.navigateBack();
      } else {
        wx.redirectTo({ url: `/pages/book-detail/index?id=${data.user_book.user_book_id}` });
      }
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  editManually() {
    wx.navigateTo({ url: `/pages/manual-book-edit/index?isbn=${this.data.isbn}&editionId=${this.data.editionId}` });
  }
});
