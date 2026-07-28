Component({
  properties: {
    src: { type: String, value: "" },
    title: { type: String, value: "未命名绘本" },
    size: { type: String, value: "medium" },
    status: { type: String, value: "" }
  },
  data: { imageFailed: false },
  methods: {
    onImageError() {
      this.setData({ imageFailed: true });
    }
  }
});
