const { services } = require("../../services/api");
const { validateOnboarding } = require("../../utils/validation");
const { track } = require("../../services/analytics");

Page({
  data: {
    step: 1,
    restart: false,
    submitting: false,
    form: { nickname: "", birthMonth: "", gender: "", libraryName: "" },
    errors: {}
  },

  onLoad(query) {
    this.setData({ restart: query.restart === "1" });
  },

  onNickname(event) {
    this.setData({ "form.nickname": event.detail.value, "errors.nickname": "" });
  },

  onBirthMonth(event) {
    this.setData({ "form.birthMonth": event.detail.value, "errors.birthMonth": "" });
  },

  onGender(event) {
    this.setData({ "form.gender": event.currentTarget.dataset.gender, "errors.gender": "" });
  },

  onLibraryName(event) {
    this.setData({ "form.libraryName": event.detail.value, "errors.libraryName": "" });
  },

  async next() {
    const errors = validateOnboarding(this.data.form);
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    if (this.data.step === 1) {
      this.setData({
        step: 2,
        "form.libraryName": this.data.form.libraryName || `${this.data.form.nickname}的绘本馆`
      });
      return;
    }
    this.setData({ submitting: true });
    try {
      const action = this.data.restart ? "restartDeletedAccount" : "completeOnboarding";
      const payload = {
        library_name: this.data.form.libraryName,
        child: {
          nickname: this.data.form.nickname,
          birth_year_month: this.data.form.birthMonth,
          gender: this.data.form.gender
        }
      };
      if (this.data.restart) payload.confirm = true;
      await services.user(action, payload);
      await track("onboarding_completed", { source: this.data.restart ? "restart" : "first_launch" });
      wx.reLaunch({ url: "/pages/library/index" });
    } catch (error) {
      wx.showToast({ title: error.message || "建馆失败，请重试", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
