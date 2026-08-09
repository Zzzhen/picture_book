const { services } = require("../../services/api");

Page({
  data: { state: "loading", shelves: [], errorMessage: "" },

  onLoad() {
    this.loadShelves();
  },

  onShow() {
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ selected: 1 });
    if (this.loadedOnce) this.loadShelves();
    this.loadedOnce = true;
  },

  async loadShelves() {
    this.setData({ state: "loading" });
    try {
      const data = await services.bookshelf("listShelves", {});
      const shelves = data.items.map((item) => ({
        _id: item.bookshelf_id,
        name: item.name,
        description: item.description,
        bookCount: item.book_count,
        coverSlots: Array.from({ length: 4 }, (_, index) => ({ id: index, url: (item.cover_urls || [])[index] || "" }))
      }));
      this.setData({ shelves, state: shelves.length ? "content" : "empty" });
    } catch (error) {
      this.setData({ state: "error", errorMessage: error.message });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onPullDownRefresh() {
    this.loadShelves();
  },

  createShelf() {
    wx.navigateTo({ url: "/pages/bookshelf-edit/index?new=1" });
  },

  openShelf(event) {
    wx.navigateTo({ url: `/pages/bookshelf-detail/index?id=${event.detail.shelf._id}` });
  },

  reload() {
    this.loadShelves();
  }
});
