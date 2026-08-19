const { services } = require("../../services/api");
const { validateOnboarding } = require("../../utils/validation");

Page({
  data: {
    saving: false,
    form: { nickname: "", birthMonth: "", gender: "", libraryName: "" },
    errors: {},
    statusHeight: 20,
    navigationHeight: 44,
    headerHeight: 64,
    genderOptions: [
      { value: "female", label: "女孩" },
      { value: "male", label: "男孩" },
      { value: "unspecified", label: "暂不定义" }
    ]
  },

  onLoad() {
    this.loadHeaderMetrics();
    this.loadProfile();
  },

  loadHeaderMetrics() {
    if (typeof wx.getWindowInfo !== "function") return;
    const windowInfo = wx.getWindowInfo();
    const statusHeight = Number(windowInfo.statusBarHeight) || 20;
    const menu = typeof wx.getMenuButtonBoundingClientRect === "function"
      ? wx.getMenuButtonBoundingClientRect()
      : null;
    const navigationHeight = menu
      ? Math.max(44, (menu.bottom - statusHeight) + (menu.top - statusHeight))
      : 44;
    this.setData({
      statusHeight,
      navigationHeight,
      headerHeight: statusHeight + navigationHeight
    });
  },

  goBack() {
    wx.navigateBack();
  },

  async loadProfile() {
    try {
      const data = await services.user("getProfile", {});
      this.setData({
        form: {
          nickname: data.child.nickname || "",
          birthMonth: data.child.birth_year_month || "",
          gender: data.child.gender || "",
          libraryName: data.user.library_name || ""
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  setField(field, value) {
    this.setData({ [`form.${field}`]: value, [`errors.${field}`]: "" });
  },
  onNickname(event) { this.setField("nickname", event.detail.value); },
  onBirthMonth(event) { this.setField("birthMonth", event.detail.value); },
  onLibraryName(event) { this.setField("libraryName", event.detail.value); },
  onGender(event) { this.setField("gender", event.currentTarget.dataset.value); },

  async save() {
    const errors = validateOnboarding(this.data.form);
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    this.setData({ saving: true });
    try {
      await services.user("updateProfile", {
        user: { library_name: this.data.form.libraryName },
        child: {
          nickname: this.data.form.nickname,
          birth_year_month: this.data.form.birthMonth,
          gender: this.data.form.gender
        }
      });
      wx.navigateBack();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  }
});
