const { services } = require("../../services/api");
const { validateShelf } = require("../../utils/validation");
const { track } = require("../../services/analytics");

Page({
  data: {
    id: "",
    isNew: false,
    saving: false,
    deleting: false,
    presetIds: [],
    form: { name: "", description: "" },
    errors: {},
    deleteVisible: false
  },

  onLoad(query) {
    this.setData({
      id: query.id || "",
      isNew: query.new === "1",
      presetIds: (query.select || "").split(",").filter(Boolean)
    });
    this.loadEditor();
  },

  async loadEditor() {
    if (this.data.isNew) return;
    try {
      const result = await services.bookshelf("listShelves", {});
      const shelf = result.items.find((item) => item.bookshelf_id === this.data.id);
      if (!shelf) throw new Error("书架不存在或已被删除");
      this.setData({ form: { name: shelf.name, description: shelf.description || "" } });
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
        const result = await services.bookshelf("createShelf", {
          name: this.data.form.name,
          description: this.data.form.description || undefined
        });
        id = result.bookshelf.bookshelf_id;
        track("bookshelf_created", { source: "bookshelf_editor" });
      } else {
        await services.bookshelf("updateShelf", {
          bookshelf_id: id,
          patch: { name: this.data.form.name, description: this.data.form.description }
        });
      }

      const preset = this.data.presetIds.length ? `&select=${encodeURIComponent(this.data.presetIds.join(","))}` : "";
      const target = this.data.isNew && preset
        ? `/pages/bookshelf-book-picker/index?id=${id}&created=1${preset}`
        : `/pages/bookshelf-detail/index?id=${id}`;
      wx.redirectTo({ url: target });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  askDelete() { this.setData({ deleteVisible: true }); },
  closeDelete() { this.setData({ deleteVisible: false }); },

  async deleteShelf() {
    if (this.data.deleting) return;
    this.setData({ deleting: true });
    try {
      await services.bookshelf("deleteShelf", { bookshelf_id: this.data.id, confirm: true });
      wx.switchTab({ url: "/pages/bookshelves/index" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ deleting: false, deleteVisible: false });
    }
  }
});
