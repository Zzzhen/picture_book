const { services } = require("../../services/api");
const { validateManualBook } = require("../../utils/validation");

Page({
  data: {
    submissionId: "",
    isResubmit: false,
    reviewStatus: "",
    rejectReason: "",
    submitting: false,
    form: { title: "", author: "", isbn: "", publisher: "", coverFileId: "", coverUrl: "" },
    errors: {}
  },

  onLoad(query) {
    this.setData({
      submissionId: query.submissionId || "",
      editionId: query.editionId || "",
      isResubmit: Boolean(query.submissionId),
      "form.isbn": query.isbn || ""
    });
    if (query.submissionId) this.loadSubmission();
  },

  async loadSubmission() {
    try {
      const data = await services.book("getEditionDetail", { edition_id: this.data.editionId });
      const edition = data.edition;
      const submission = data.manual_submission || {};
      this.setData({
        reviewStatus: submission.status || "",
        rejectReason: submission.rejection_reason || "",
        form: {
          title: edition.title || "",
          author: edition.contributors_text || "",
          isbn: edition.isbn13 || "",
          publisher: edition.publisher || "",
          coverFileId: edition.cover_file_id || "",
          coverUrl: edition.cover_file_id || ""
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  setField(field, value) {
    this.setData({ [`form.${field}`]: value, [`errors.${field}`]: "" });
  },
  onTitle(event) { this.setField("title", event.detail.value); },
  onAuthor(event) { this.setField("author", event.detail.value); },
  onIsbn(event) { this.setField("isbn", event.detail.value); },
  onPublisher(event) { this.setField("publisher", event.detail.value); },

  chooseCover() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sizeType: ["compressed"],
      success: async ({ tempFiles }) => {
        const tempFilePath = tempFiles[0].tempFilePath;
        wx.showLoading({ title: "安全检测中" });
        try {
          const cloudPath = `manual-covers/${Date.now()}_${Math.random().toString(16).slice(2)}.jpg`;
          const upload = await wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath });
          this.setData({ "form.coverFileId": upload.fileID, "form.coverUrl": tempFilePath });
        } catch (_) {
          wx.showToast({ title: "封面上传失败，请重试", icon: "none" });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  async submit() {
    const errors = validateManualBook(this.data.form);
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    const fields = {
      title: this.data.form.title,
      contributors_text: this.data.form.author || undefined,
      publisher: this.data.form.publisher || undefined,
      isbn: this.data.form.isbn || undefined,
      cover_file_id: this.data.form.coverFileId || undefined
    };
    this.setData({ submitting: true });
    try {
      const wasPendingEdit = Boolean(this.data.submissionId && this.data.reviewStatus === "pending");
      if (this.data.submissionId) {
        await services.book("updateManualSubmission", { submission_id: this.data.submissionId, patch: fields });
        if (this.data.reviewStatus === "rejected") {
          await services.book("resubmitManualBook", { submission_id: this.data.submissionId });
        }
      } else {
        await services.book("createManualBook", fields);
      }
      this.setData({ reviewStatus: "pending", isResubmit: true });
      wx.showToast({
        title: wasPendingEdit ? "修改已保存" : "已提交审核",
        icon: "success"
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
