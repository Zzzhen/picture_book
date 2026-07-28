Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: "" },
    closeable: { type: Boolean, value: true }
  },
  methods: {
    onMask() {
      if (this.data.closeable) this.triggerEvent("close");
    },
    onClose() {
      this.triggerEvent("close");
    },
    noop() {}
  }
});
