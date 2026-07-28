const { AppError } = require("./errors");
const { text, rejectUnknownFields } = require("./schema");

function applyReviewDecision(submission, input, adminId, now = new Date().toISOString()) {
  if (submission.status !== "pending") throw new AppError("INVALID_STATE", "只有待审核提交可以处理");
  rejectUnknownFields(input, ["decision", "rejection_reason", "approved_fields"], "payload");
  const allowed = ["approve", "reject", "keep_existing", "replace_allowed_fields"];
  if (!allowed.includes(input.decision)) throw new AppError("INVALID_ARGUMENT", "审核决定不正确");
  const next = { ...submission, reviewed_by: adminId, reviewed_at: now, updated_at: now };
  if (input.decision === "reject") {
    next.status = "rejected";
    next.rejection_reason = text(input.rejection_reason, "驳回原因", { min: 1, max: 200 });
    next.resolution = "reject_new";
  } else if (input.decision === "keep_existing") {
    next.status = "merged";
    next.resolution = "keep_existing";
  } else {
    next.status = "approved";
    next.resolution = input.decision === "replace_allowed_fields" ? "replace_allowed_fields" : "";
    next.rejection_reason = "";
  }
  return next;
}

module.exports = { applyReviewDecision };
