Component({
  properties: {
    label: { type: String, value: "" },
    value: { type: String, value: "" },
    placeholder: { type: String, value: "" },
    type: { type: String, value: "text" },
    error: { type: String, value: "" },
    required: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    maxlength: { type: Number, value: 100 },
  },
  methods: {
    onInput(event) {
      this.triggerEvent("input", { value: event.detail.value });
    },
    onChange(event) {
      this.triggerEvent("change", { value: event.detail.value });
    },
  },
});
