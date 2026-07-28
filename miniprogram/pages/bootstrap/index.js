const { services } = require("../../services/api");

Page({
  data: { state: "loading", message: "" },

  onLoad() {
    this.bootstrap();
  },

  async bootstrap() {
    this.setData({ state: "loading", message: "" });
    try {
      const data = await services.user("bootstrap", {});
      const app = getApp();
      app.globalData.user = data;
      if (data.status === "disabled") {
        this.setData({ state: "disabled", message: "账号已被管理员停用，如有疑问请提交反馈。" });
        return;
      }
      if (data.status === "deleting") {
        this.setData({ state: "deleting", message: "注销申请已生效，个人数据将在 24 小时内清理。" });
        return;
      }
      if (data.status === "deleted") {
        wx.redirectTo({ url: "/pages/onboarding/index?restart=1" });
        return;
      }
      wx.reLaunch({ url: data.onboarding_completed ? "/pages/library/index" : "/pages/onboarding/index" });
    } catch (error) {
      const offline = error.code === "NETWORK_ERROR" || error.errMsg && error.errMsg.includes("network");
      this.setData({ state: offline ? "offline" : "error", message: error.message });
    }
  },

  retry() {
    this.bootstrap();
  },

  goFeedback() {
    wx.navigateTo({ url: "/pages/feedback/index" });
  }
});
