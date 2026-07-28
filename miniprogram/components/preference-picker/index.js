Component({
  properties: {
    value: { type: String, value: "" },
    disabled: { type: Boolean, value: false }
  },
  data: {
    options: [
      { value: "recommended", label: "很喜欢", symbol: "♥" },
      { value: "neutral", label: "一般", symbol: "○" },
      { value: "not_recommended", label: "不喜欢", symbol: "—" },
      { value: "unmarked", label: "未标记", symbol: "·" }
    ]
  },
  methods: {
    onSelect(event) {
      if (this.data.disabled) return;
      const { value } = event.currentTarget.dataset;
      this.triggerEvent("change", { value });
    }
  }
});
