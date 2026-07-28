const { getEnvironmentId } = require("./config/env");

App({
  globalData: {
    environmentId: "",
    user: null,
  },

  onLaunch() {
    const environmentId = getEnvironmentId();
    this.globalData.environmentId = environmentId;
    if (wx.cloud && environmentId) {
      wx.cloud.init({ env: environmentId, traceUser: true });
    }
  },
});
