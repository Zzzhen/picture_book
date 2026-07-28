Component({
  properties: {
    value: { type: String, value: "grid" },
    options: {
      type: Array,
      value: [
        { value: "grid", label: "封面" },
        { value: "list", label: "列表" }
      ]
    }
  },
  methods: {
    onSelect(event) {
      const { value } = event.currentTarget.dataset;
      this.triggerEvent("change", { value });
    }
  }
});
