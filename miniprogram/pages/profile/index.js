const { services } = require("../../services/api");

Page({
  data: {
    child: {},
    metrics: {},
    accountStatus: "active",
    createdDays: 0,
    deleteVisible: false,
    adminPresses: 0
  },

  onLoad() {
    this.loadProfile();
  },

  onShow() {
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ selected: 2 });
    if (this.loadedOnce) this.loadProfile();
    this.loadedOnce = true;
  },

  async loadProfile() {
    try {
      const data = await services.user("getProfile", {});
      this.setData({
        child: {
          nickname: data.child.nickname,
          ageText: this.ageText(data.child.birth_year_month)
        },
        childInitial: Array.from(data.child.nickname || "家")[0],
        metrics: {
          uniqueBooks: String(data.stats.book_count || 0),
          copies: String(data.stats.copy_count || data.stats.book_count || 0),
          shelves: String(data.stats.shelf_count || 0),
          favorites: String(data.stats.favorite_count || 0)
        },
        accountStatus: data.user.status || "active",
        createdDays: data.user.created_days || 0,
        role: data.user.role || "user"
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  ageText(month) {
    if (!month) return "年龄段待完善";
    const [year, value] = month.split("-").map(Number);
    const now = new Date();
    const months = now.getFullYear() * 12 + now.getMonth() - (year * 12 + value - 1);
    if (months < 36) return `${Math.max(0, Math.floor(months / 12))} 岁 ${Math.max(0, months % 12)} 个月`;
    return `${Math.floor(months / 12)} 岁`;
  },

  editProfile() { wx.navigateTo({ url: "/pages/profile-edit/index" }); },
  goFeedback() { wx.navigateTo({ url: "/pages/feedback/index" }); },
  showAbout() { wx.showModal({ title: "书芽芽", content: "书芽芽｜家庭数字绘本馆\nV1-Core 核心建馆版：为家庭记录、整理和检索实体绘本。", showCancel: false }); },

  openAdmin() {
    const presses = this.data.adminPresses + 1;
    this.setData({ adminPresses: presses });
    if (presses >= 3) {
      this.setData({ adminPresses: 0 });
      wx.navigateTo({ url: "/pages/admin/index" });
    }
  },

  askDeleteAccount() { this.setData({ deleteVisible: true }); },
  closeDelete() { this.setData({ deleteVisible: false }); },

  async requestDeletion() {
    try {
      await services.user("cancelAccount", { confirm_text: "注销账号" });
      this.setData({ deleteVisible: false, accountStatus: "deleting" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  cancelDeletion() {
    wx.showModal({ title: "注销处理中", content: "当前接口契约不提供客户端撤销。若为误操作，请立即通过意见反馈联系管理员。", showCancel: false });
  }
});
