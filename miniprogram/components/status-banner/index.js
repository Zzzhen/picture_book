Component({
  properties: {
    type: { type: String, value: "info" },
    title: { type: String, value: "" },
    message: { type: String, value: "" },
    actionText: { type: String, value: "" }
  },
  methods: {
    onAction() {
      this.triggerEvent("action");
    }
  }
});
