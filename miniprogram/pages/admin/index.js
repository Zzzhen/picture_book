const { services } = require("../../services/api");

Page({
  data: {
    isAdmin: false,
    tab: "dashboard",
    state: "loading",
    items: [],
    users: [],
    dashboard: {},
    paginationState: "idle",
    userCursor: null,
    queueCursor: null,
    counts: {},
    detailVisible: false,
    current: {},
    selectedVersion: "",
    rejectReason: "",
    processing: false,
    confirmVisible: false,
    pendingDecision: ""
  },

  onLoad() {
    this.checkAccess();
  },

  async checkAccess() {
    try {
      const data = await services.user("bootstrap", {});
      const isAdmin = data.role === "admin" && data.status === "active";
      this.setData({ isAdmin });
      if (isAdmin) {
        await this.loadCounts();
        await this.loadDashboard();
      }
    } catch (_) {
      this.setData({ isAdmin: false });
    }
  },

  async loadDashboard() {
    this.setData({ state: "loading" });
    try {
      const dashboard = await services.admin("dashboard", {});
      const asPercent = (value) => value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
      this.setData({
        dashboard,
        dashboardView: {
          book1: asPercent(dashboard.activation.book_1_ratio),
          book5: asPercent(dashboard.activation.book_5_ratio),
          book10: asPercent(dashboard.activation.book_10_ratio),
          shelf: asPercent(dashboard.activation.shelf_creation_ratio)
        },
        state: "content"
      });
    } catch (error) {
      this.setData({ state: "error" });
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  async loadUsers(reset = true) {
    if (this.data.paginationState === "loading") return;
    this.setData(reset ? { state: "loading", paginationState: "loading", userCursor: null } : { paginationState: "loading" });
    try {
      const page = await services.admin("listUsers", { cursor: reset ? undefined : this.data.userCursor, limit: 50 });
      const users = reset ? page.items : this.data.users.concat(page.items);
      this.setData({
        users,
        userCursor: page.next_cursor,
        state: users.length ? "content" : "empty",
        paginationState: page.has_more ? "idle" : "end"
      });
    } catch (error) {
      this.setData({ state: "error", paginationState: "idle" });
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  async loadCounts() {
    try {
      const data = await services.admin("dashboard", {});
      this.setData({
        counts: {
          pending: data.manual_review.pending_count,
          conflict: data.manual_review.conflict_count
        }
      });
    } catch (_) {}
  },

  async loadQueue(reset = true) {
    if (this.data.paginationState === "loading") return;
    this.setData(reset ? { state: "loading", paginationState: "loading", queueCursor: null } : { paginationState: "loading" });
    try {
      const payload = {
        status: this.data.tab === "history" ? "rejected" : "pending",
        conflict_only: this.data.tab === "conflict",
        cursor: reset ? undefined : this.data.queueCursor,
        limit: 50
      };
      const page = await services.admin("listPendingBooks", payload);
      const incoming = page.items.map((item) => {
        const fields = item.submitted_fields || {};
        return {
          _id: item.submission.submission_id,
          submission: item.submission,
          title: fields.title,
          author: fields.contributors_text,
          publisher: fields.publisher,
          coverUrl: fields.cover_file_id || "",
          isbn13: fields.isbn13 || fields.isbn || "",
          submittedAtText: item.submission.submitted_at ? item.submission.submitted_at.slice(0, 10) : "",
          existing: item.existing_edition ? {
            title: item.existing_edition.title,
            author: item.existing_edition.contributors_text,
            publisher: item.existing_edition.publisher,
            coverUrl: item.existing_edition.cover_file_id || ""
          } : {}
        };
      });
      const items = reset ? incoming : this.data.items.concat(incoming);
      this.setData({
        items,
        queueCursor: page.next_cursor,
        state: items.length ? "content" : "empty",
        paginationState: page.has_more ? "idle" : "end"
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
      this.setData({ state: "empty", paginationState: "idle" });
    }
  },

  changeTab(event) {
    const tab = event.currentTarget.dataset.tab;
    this.setData({ tab });
    if (tab === "dashboard") this.loadDashboard();
    else if (tab === "users") this.loadUsers();
    else this.loadQueue();
  },

  onReachBottom() {
    if (this.data.tab === "users" && this.data.userCursor) this.loadUsers(false);
    else if (!["dashboard", "users"].includes(this.data.tab) && this.data.queueCursor) this.loadQueue(false);
  },

  changeUserStatus(event) {
    const user = this.data.users.find((item) => item.user_id === event.currentTarget.dataset.id);
    if (!user) return;
    const nextStatus = user.status === "disabled" ? "active" : "disabled";
    wx.showModal({
      title: nextStatus === "disabled" ? "停用这个账号？" : "恢复这个账号？",
      content: nextStatus === "disabled" ? "停用后用户只能看到停用说明页。" : "恢复后用户可继续使用绘本馆。",
      editable: true,
      placeholderText: "填写操作原因（必填）",
      confirmText: nextStatus === "disabled" ? "确认停用" : "确认恢复",
      success: async (result) => {
        if (!result.confirm) return;
        const reason = String(result.content || "").trim();
        if (!reason) {
          wx.showToast({ title: "请填写操作原因", icon: "none" });
          return;
        }
        try {
          await services.admin("setUserStatus", { user_id: user.user_id, status: nextStatus, reason });
          await this.loadUsers();
          wx.showToast({ title: "账号状态已更新", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  openItem(event) {
    const current = this.data.items.find((item) => item._id === event.currentTarget.dataset.id) || {};
    this.setData({ current, detailVisible: true, selectedVersion: "", rejectReason: "" });
  },
  closeItem() { this.setData({ detailVisible: false }); },
  selectVersion(event) { this.setData({ selectedVersion: event.currentTarget.dataset.version }); },
  onRejectReason(event) { this.setData({ rejectReason: event.detail.value }); },

  approve() {
    this.setData({ pendingDecision: "approve", confirmVisible: true });
  },
  reject() {
    this.setData({ pendingDecision: "reject", confirmVisible: true });
  },
  resolveConflict() {
    this.setData({ pendingDecision: this.data.selectedVersion === "existing" ? "keep_existing" : "replace_allowed_fields", confirmVisible: true });
  },
  cancelDecision() { this.setData({ confirmVisible: false }); },

  async commitDecision() {
    this.setData({ processing: true, confirmVisible: false });
    const decision = this.data.pendingDecision;
    const payload = {
      submission_id: this.data.current._id,
      decision
    };
    if (decision === "reject") payload.rejection_reason = this.data.rejectReason;
    if (decision === "replace_allowed_fields") {
      payload.approved_fields = {
        title: this.data.current.title,
        contributors_text: this.data.current.author,
        publisher: this.data.current.publisher,
        cover_file_id: this.data.current.coverUrl || undefined
      };
    }
    try {
      await services.admin("reviewManualBook", payload);
      this.setData({ detailVisible: false });
      await Promise.all([this.loadCounts(), this.loadQueue()]);
      wx.showToast({ title: "审核结果已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ processing: false });
    }
  }
});
