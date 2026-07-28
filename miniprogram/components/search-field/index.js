Component({
  properties: {
    value: { type: String, value: "" },
    placeholder: { type: String, value: "搜索绘本" },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    onInput(event) {
      this.triggerEvent("input", { value: event.detail.value });
    },
    onConfirm(event) {
      this.triggerEvent("confirm", { value: event.detail.value });
    },
    onClear() {
      this.triggerEvent("input", { value: "" });
      this.triggerEvent("clear");
    },
  },
});
