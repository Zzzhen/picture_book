Component({
  properties: {
    text: { type: String, value: "" },
    type: { type: String, value: "primary" },
    size: { type: String, value: "large" },
    loading: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    block: { type: Boolean, value: true },
  },
  methods: {
    onTap() {
      if (!this.data.disabled && !this.data.loading) this.triggerEvent("tap");
    },
  },
});
