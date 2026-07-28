Component({
  properties: {
    value: { type: Number, value: 1 },
    min: { type: Number, value: 1 },
    max: { type: Number, value: 99 },
    disabled: { type: Boolean, value: false }
  },
  methods: {
    decrease() {
      this.commit(this.data.value - 1);
    },
    increase() {
      this.commit(this.data.value + 1);
    },
    commit(next) {
      if (this.data.disabled) return;
      const value = Math.min(this.data.max, Math.max(this.data.min, next));
      if (value !== this.data.value) this.triggerEvent("change", { value });
    }
  }
});
