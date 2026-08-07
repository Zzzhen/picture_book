Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: "请确认" },
    message: { type: String, value: "" },
    confirmText: { type: String, value: "确认" },
    cancelText: { type: String, value: "取消" },
    loading: { type: Boolean, value: false },
    danger: { type: Boolean, value: false }
  },
  methods: {
    onConfirm() {
      this.triggerEvent("confirm");
    },
    onCancel() {
      this.triggerEvent("cancel");
    },
    noop() {}
  }
});
