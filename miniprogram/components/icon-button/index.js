Component({
  properties: {
    icon: { type: String, value: "+" },
    label: { type: String, value: "" },
    styleType: { type: String, value: "plain" },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    onTap() {
      if (!this.data.disabled) this.triggerEvent("tap");
    },
  },
});
