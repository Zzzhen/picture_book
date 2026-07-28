Component({
  properties: {
    book: { type: Object, value: {} },
    manage: { type: Boolean, value: false },
    selected: { type: Boolean, value: false }
  },
  methods: {
    onTap() {
      this.triggerEvent(this.data.manage ? "select" : "open", { book: this.data.book });
    }
  }
});
