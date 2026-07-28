const { services } = require("../../services/api");

Page({
  data: {
    state: "form",
    submitting: false,
    types: [
      { value: "bug", label: "使用问题" },
      { value: "book_data", label: "图书信息错误" },
      { value: "suggestion", label: "改进建议" },
      { value: "account", label: "账号与注销" },
      { value: "other", label: "其他" }
    ],
    form: { type: "bug", content: "", contact: "" },
    errors: {},
    errorMessage: ""
  },

  chooseType(event) {
    this.setData({ "form.type": event.currentTarget.dataset.value });
  },
  onContent(event) {
    this.setData({ "form.content": event.detail.value, "errors.content": "" });
  },
  onContact(event) {
    this.setData({ "form.contact": event.detail.value });
  },

  async submit() {
    if (!this.data.form.content.trim()) {
      this.setData({ "errors.content": "请填写详细说明" });
      return;
    }
    this.setData({ submitting: true, errorMessage: "" });
    try {
      await services.event("trackBatch", {
        events: [{
          event_name: "feedback_submitted",
          event_id: `feedback_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          occurred_at: new Date().toISOString(),
          properties: {
            type: this.data.form.type,
            content: this.data.form.content,
            contact: this.data.form.contact || undefined
          }
        }]
      });
      this.setData({ state: "success" });
    } catch (error) {
      this.setData({ errorMessage: error.message });
    } finally {
      this.setData({ submitting: false });
    }
  },

  backProfile() {
    wx.switchTab({ url: "/pages/profile/index" });
  }
});
