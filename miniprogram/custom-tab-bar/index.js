Component({
  data: {
    selected: 0,
    tabs: [
      { pagePath: "/pages/library/index", label: "绘本馆", icon: "library" },
      { pagePath: "/pages/bookshelves/index", label: "书架", icon: "shelf" },
      { pagePath: "/pages/profile/index", label: "我的", icon: "profile" }
    ]
  },
  lifetimes: {
    attached() {
      this.syncSelected();
    }
  },
  pageLifetimes: {
    show() {
      this.syncSelected();
    }
  },
  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (!current) return;
      const index = this.data.tabs.findIndex((tab) => tab.pagePath === `/${current.route}`);
      if (index >= 0) this.setData({ selected: index });
    },
    switchTab(event) {
      const { index, path } = event.currentTarget.dataset;
      if (index === this.data.selected) return;
      wx.switchTab({ url: path });
    }
  }
});
