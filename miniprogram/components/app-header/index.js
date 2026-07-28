Component({
  properties: {
    title: { type: String, value: "" },
    back: { type: Boolean, value: false },
    transparent: { type: Boolean, value: false },
  },

  data: {
    statusHeight: 20,
    navigationHeight: 44,
    rightInset: 88,
  },

  lifetimes: {
    attached() {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : {};
      const menu = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;
      const statusHeight = windowInfo.statusBarHeight || 20;
      const navigationHeight = menu
        ? (menu.top - statusHeight) * 2 + menu.height
        : 44;
      const screenWidth = windowInfo.screenWidth || 375;
      const rightInset = menu ? screenWidth - menu.left + 8 : 88;
      this.setData({ statusHeight, navigationHeight, rightInset });
    },
  },

  methods: {
    onBack() {
      this.triggerEvent("back");
      if (getCurrentPages().length > 1) wx.navigateBack();
    },
  },
});
