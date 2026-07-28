Component({
  properties: {
    shelf: { type: Object, value: {} }
  },
  methods: {
    onTap() {
      this.triggerEvent("open", { shelf: this.data.shelf });
    }
  }
});
