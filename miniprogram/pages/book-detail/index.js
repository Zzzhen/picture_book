const { services } = require("../../services/api");
const { track } = require("../../services/analytics");

function mapDetail(data) {
  const item = data.user_book;
  const edition = item.edition || {};
  return {
    userBookId: item.user_book_id,
    editionId: edition.edition_id || "",
    title: edition.title || "",
    author: edition.contributors_text || "",
    publisher: edition.publisher || "",
    coverUrl: edition.cover_file_id || "",
    isbn13: edition.isbn13 || "",
    binding: edition.binding_type || "",
    publishDate: edition.publish_date_text || "",
    priceText: edition.price_text || "",
    pageCount: edition.page_count_text || "",
    reviewStatus: edition.audit_status || "",
    rejectReason: data.manual_submission && data.manual_submission.rejection_reason || "",
    submissionId: data.manual_submission && data.manual_submission.submission_id || "",
    preference: item.preference || "unmarked",
    quantity: item.quantity,
    note: data.private_note || "",
    shelves: data.bookshelves || [],
    createdAtText: item.created_at ? item.created_at.slice(0, 10) : ""
  };
}

Page({
  data: {
    id: "",
    book: {
      title: "",
      coverUrl: "",
      reviewStatus: "",
      preference: "unmarked",
      note: ""
    },
    deleteVisible: false,
    saving: false
  },

  onLoad(query) {
    this.setData({ id: query.id || "" });
    this.loadBook();
  },

  async loadBook() {
    try {
      const data = await services.library("getUserBook", { user_book_id: this.data.id });
      this.setData({ book: mapDetail(data) });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  async saveBook() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await services.library("updateBook", {
        user_book_id: this.data.id,
        patch: {
          quantity: this.data.book.quantity,
          preference: this.data.book.preference || "unmarked",
          private_note: this.data.book.note || ""
        }
      });
      if (this.data.book.preference && this.data.book.preference !== "unmarked") track("preference_updated", { source: "book_detail" });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  onPreference(event) {
    this.setData({ "book.preference": event.detail.value });
  },

  onQuantity(event) {
    this.setData({ "book.quantity": event.detail.value });
  },

  onNote(event) {
    this.setData({ "book.note": event.detail.value });
  },

  async chooseShelves() {
    try {
      const data = await services.bookshelf("listShelves", {});
      const labels = data.items.map((item) => {
        const selected = this.data.book.shelves.some((shelf) => shelf.bookshelf_id === item.bookshelf_id);
        return `${selected ? "✓ " : ""}${item.name}`;
      }).concat("新建书架");
      wx.showActionSheet({
        itemList: labels,
        success: async ({ tapIndex }) => {
          if (tapIndex === data.items.length) {
            wx.navigateTo({ url: `/pages/bookshelf-edit/index?new=1&select=${this.data.id}` });
            return;
          }
          const shelf = data.items[tapIndex];
          const selected = this.data.book.shelves.some((item) => item.bookshelf_id === shelf.bookshelf_id);
          const action = selected ? "removeBooks" : "addBooks";
          await services.bookshelf(action, { bookshelf_id: shelf.bookshelf_id, user_book_ids: [this.data.id] });
          await this.loadBook();
          wx.showToast({ title: selected ? "已移出书架" : "已加入书架", icon: "success" });
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  editManual() {
    wx.navigateTo({ url: `/pages/manual-book-edit/index?submissionId=${this.data.book.submissionId}&editionId=${this.data.book.editionId}` });
  },

  askDelete() {
    this.setData({ deleteVisible: true });
  },

  closeDelete() {
    this.setData({ deleteVisible: false });
  },

  async deleteBook() {
    try {
      await services.library("removeBook", { user_book_id: this.data.id, confirm: true });
      wx.reLaunch({ url: "/pages/library/index" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  }
});
