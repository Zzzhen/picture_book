Component({
  properties: {
    type: { type: String, value: "empty" },
    title: { type: String, value: "这里还是空的" },
    description: { type: String, value: "" },
    primaryText: { type: String, value: "" },
    secondaryText: { type: String, value: "" }
  },
  methods: {
    onPrimary() {
      this.triggerEvent("primary");
    },
    onSecondary() {
      this.triggerEvent("secondary");
    }
  }
});
