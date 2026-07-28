Component({
  properties: {
    type: { type: String, value: "card" },
    count: { type: Number, value: 6 }
  },
  data: { items: [] },
  observers: {
    count(value) {
      this.setData({ items: Array.from({ length: Math.max(1, value) }) });
    }
  },
  lifetimes: {
    attached() {
      this.setData({ items: Array.from({ length: Math.max(1, this.data.count) }) });
    }
  }
});
