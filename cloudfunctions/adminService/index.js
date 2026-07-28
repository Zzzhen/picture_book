const { createMain, getById, queryAll, queryAllById, documentData } = require("../_shared/cloud");
const { AppError } = require("../_shared/errors");
const { text, enumValue, integer, rejectUnknownFields } = require("../_shared/schema");
const { editionSummary, manualSubmissionSummary, iso } = require("../_shared/serializers");
const { applyReviewDecision } = require("../_shared/review");
const { deterministicId, randomId } = require("../_shared/identity");
const { encodeCursor, decodeCursor, stableStringify } = require("../_shared/cursor");
const { normalizeSearchText, buildSearchFields } = require("../_shared/search");
const { transferCover } = require("../_shared/cover-transfer");
const { verifyUploadedImage } = require("../_shared/content-security");

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function dashboardRange(payload = {}) {
  const parse = (value, field) => {
    if (!value) return null;
    const clean = text(value, field, { min: 10, max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) throw new AppError("INVALID_ARGUMENT", `${field} 应为 YYYY-MM-DD`);
    const date = new Date(`${clean}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== clean) {
      throw new AppError("INVALID_ARGUMENT", `${field} 日期无效`);
    }
    return date;
  };
  const from = parse(payload.date_from, "date_from") || new Date(Date.now() - 7 * 86400000);
  const toDay = parse(payload.date_to, "date_to") || new Date();
  const toExclusive = payload.date_to ? new Date(toDay.getTime() + 86400000) : new Date(toDay.getTime() + 1);
  if (from >= toExclusive) throw new AppError("INVALID_ARGUMENT", "date_from 不能晚于 date_to");
  return { from, toExclusive };
}

async function dashboard(ctx, payload) {
  const range = dashboardRange(payload);
  const countEvent = async (name) => (await ctx.db.collection("events").where({ event_name: name }).count()).total;
  const countScanResult = async (resultCode) => (await ctx.db.collection("events").where({
    event_name: "continuous_scan_book_added",
    "properties.result_code": resultCode
  }).count()).total;
  const [users, books, shelves, pending, approved, rejected, conflicts, dailyQuota, monthlyQuota, cacheHits, providerCalls, isbnSuccess, isbnFailure, scanSessions, scanAdded, scanDuplicates, scanSkipped, scanFailures] = await Promise.all([
    queryAllById(ctx, "users", { deleted_at: null }, 10000),
    ctx.db.collection("user_books").where({ deleted_at: null }).count(),
    ctx.db.collection("bookshelves").where({ deleted_at: null }).count(),
    ctx.db.collection("manual_book_submissions").where({ status: "pending" }).count(),
    ctx.db.collection("manual_book_submissions").where({ status: "approved" }).count(),
    ctx.db.collection("manual_book_submissions").where({ status: "rejected" }).count(),
    ctx.db.collection("manual_book_submissions").where({ status: "pending", conflict_edition_id: ctx.command.neq("") }).count(),
    getById(ctx.db.collection("rate_limits"), deterministicId("rate_limit", ["global", "isbn_external", new Date().toISOString().slice(0, 10)])),
    getById(ctx.db.collection("rate_limits"), deterministicId("rate_limit", ["global", "isbn_external", new Date().toISOString().slice(0, 7)])),
    countEvent("isbn_cache_hit"),
    countEvent("isbn_provider_called"),
    countEvent("isbn_scan_succeeded"),
    countEvent("isbn_lookup_not_found"),
    countEvent("continuous_scan_started"),
    countScanResult("added"),
    countScanResult("duplicate"),
    countScanResult("skipped"),
    countScanResult("failure")
  ]);
  const onboarded = users.filter((item) => item.onboarding_completed).length;
  const [pendingRows, approvedRows, rejectedRows, mergedRows] = await Promise.all([
    queryAllById(ctx, "manual_book_submissions", { status: "pending" }, 10000),
    queryAllById(ctx, "manual_book_submissions", { status: "approved" }, 10000),
    queryAllById(ctx, "manual_book_submissions", { status: "rejected" }, 10000),
    queryAllById(ctx, "manual_book_submissions", { status: "merged" }, 10000)
  ]);
  const reviewedHours = [...approvedRows, ...rejectedRows, ...mergedRows]
    .map((item) => {
      const submitted = new Date(iso(item.submitted_at));
      const reviewed = new Date(iso(item.reviewed_at));
      return (reviewed - submitted) / 3600000;
    })
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  const medianReviewHours = reviewedHours.length
    ? reviewedHours.length % 2
      ? reviewedHours[(reviewedHours.length - 1) / 2]
      : (reviewedHours[reviewedHours.length / 2 - 1] + reviewedHours[reviewedHours.length / 2]) / 2
    : null;
  const userBookRows = await queryAllById(ctx, "user_books", { deleted_at: null }, 100000);
  const perUser = new Map();
  let preferenceUsers = new Set();
  for (const book of userBookRows) {
    perUser.set(book.owner_id, (perUser.get(book.owner_id) || 0) + 1);
    if (book.preference && book.preference !== "unmarked") preferenceUsers.add(book.owner_id);
  }
  const first = Array.from(perUser.values()).filter((value) => value >= 1).length;
  const five = Array.from(perUser.values()).filter((value) => value >= 5).length;
  const ten = Array.from(perUser.values()).filter((value) => value >= 10).length;
  const shelfOwners = new Set((await queryAllById(ctx, "bookshelves", { deleted_at: null }, 100000)).map((item) => item.owner_id));
  return {
    users: {
      total: users.length,
      new_count: users.filter((item) => {
        const created = new Date(iso(item.created_at));
        return created >= range.from && created < range.toExclusive;
      }).length,
      onboarding_completed_count: onboarded,
      first_book_user_count: first
    },
    activation: { book_1_ratio: ratio(first, onboarded), book_5_ratio: ratio(five, onboarded), book_10_ratio: ratio(ten, onboarded), shelf_creation_ratio: ratio(shelfOwners.size, onboarded), preference_ratio: ratio(preferenceUsers.size, onboarded) },
    library: { total_user_books: books.total, average_books_per_user: onboarded ? books.total / onboarded : null, total_shelves: shelves.total },
    isbn: { cache_hit_count: cacheHits, provider_call_count: providerCalls, success_count: isbnSuccess, failure_count: isbnFailure, quota_daily_used: dailyQuota && dailyQuota.count || 0, quota_monthly_used: monthlyQuota && monthlyQuota.count || 0 },
    manual_review: {
      pending_count: pending.total,
      overdue_3d_count: pendingRows.filter((item) => Date.now() - new Date(iso(item.submitted_at)).getTime() > 3 * 86400000).length,
      approved_count: approved.total,
      rejected_count: rejected.total,
      conflict_count: conflicts.total,
      median_review_hours: medianReviewHours
    },
    continuous_scan: {
      session_count: scanSessions,
      books_added_count: scanAdded + scanDuplicates,
      duplicate_count: scanDuplicates,
      skipped_count: scanSkipped,
      failure_count: scanFailures
    }
  };
}

async function listUsers(ctx, payload) {
  const limit = payload.limit === undefined ? 24 : integer(payload.limit, "limit", 1, 50);
  const status = payload.status ? enumValue(payload.status, "status", ["active", "disabled", "deleting", "deleted"]) : "";
  const queryText = payload.query ? normalizeSearchText(text(payload.query, "query", { max: 100 })) : "";
  const binding = { action: "listUsers", owner: ctx.userId, filter: stableStringify({ status, queryText }) };
  const position = payload.cursor ? decodeCursor(payload.cursor, binding) : null;
  const condition = {};
  if (status) condition.status = status;
  const whereCondition = position
    ? ctx.command.and([
      condition,
      ctx.command.or([
        { created_at: ctx.command.lt(new Date(position.value)) },
        { created_at: new Date(position.value), _id: ctx.command.lt(position.id) }
      ])
    ])
    : condition;
  let users = await queryAll(ctx.db.collection("users").where(whereCondition).orderBy("created_at", "desc").orderBy("_id", "desc"), Math.min(100, limit * 3 + 1));
  if (queryText) users = users.filter((item) => normalizeSearchText(`${item.library_name} ${item._id}`).includes(queryText));
  const page = users.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const items = page.slice(0, limit);
  const counts = await Promise.all(items.map((item) => ctx.db.collection("user_books").where({ owner_id: item._id, deleted_at: null }).count()));
  const last = items[items.length - 1];
  return {
    items: items.map((item, index) => ({ user_id: item._id, status: item.status, role: item.role, library_name: item.library_name, book_count: counts[index].total, created_at: iso(item.created_at) })),
    next_cursor: hasMore ? encodeCursor({ value: iso(last.created_at), id: last._id }, binding) : null,
    has_more: hasMore
  };
}

async function writeAudit(ctx, action, targetType, targetId, summary) {
  const id = randomId("audit");
  await ctx.db.collection("audit_logs").doc(id).set({
    data: { admin_id: ctx.userId, action, target_type: targetType, target_id: targetId, change_summary: summary, created_at: ctx.now() }
  });
}

async function setUserStatus(ctx, payload) {
  const userId = text(payload.user_id, "user_id", { min: 1, max: 100 });
  const status = enumValue(payload.status, "status", ["active", "disabled"]);
  const reason = text(payload.reason, "原因", { min: 1, max: 200 });
  if (userId === ctx.userId && status === "disabled") throw new AppError("INVALID_ARGUMENT", "不能停用自己的管理员账号");
  const user = await getById(ctx.db.collection("users"), userId);
  if (!user) throw new AppError("USER_NOT_FOUND", "用户不存在");
  if (!["active", "disabled"].includes(user.status)) throw new AppError("INVALID_STATE", "注销流程中的账号不能在此变更状态");
  await ctx.db.collection("users").doc(userId).update({ data: { status, status_reason: reason, updated_at: ctx.now() } });
  await writeAudit(ctx, "set_user_status", "user", userId, { from: user.status, to: status, reason });
  return { user_id: userId, status };
}

async function listPendingBooks(ctx, payload) {
  const limit = payload.limit === undefined ? 24 : integer(payload.limit, "limit", 1, 50);
  const status = payload.status ? enumValue(payload.status, "status", ["pending", "rejected"]) : "pending";
  const binding = { action: "listPendingBooks", owner: ctx.userId, filter: stableStringify({ status, conflict_only: payload.conflict_only === true }) };
  const position = payload.cursor ? decodeCursor(payload.cursor, binding) : null;
  const condition = { status };
  if (payload.conflict_only === true) condition.conflict_edition_id = ctx.command.neq("");
  const whereCondition = position
    ? ctx.command.and([
      condition,
      ctx.command.or([
        { submitted_at: ctx.command.gt(new Date(position.value)) },
        { submitted_at: new Date(position.value), _id: ctx.command.gt(position.id) }
      ])
    ])
    : condition;
  const rows = await queryAll(
    ctx.db.collection("manual_book_submissions").where(whereCondition).orderBy("submitted_at", "asc").orderBy("_id", "asc"),
    limit + 1
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = await Promise.all(page.map(async (submission) => ({
    submission: manualSubmissionSummary(submission),
    submitted_fields: submission.submitted_fields,
    existing_edition: submission.conflict_edition_id ? editionSummary(await getById(ctx.db.collection("book_editions"), submission.conflict_edition_id)) : undefined
  })));
  const last = page[page.length - 1];
  return {
    items,
    next_cursor: hasMore && last ? encodeCursor({ value: iso(last.submitted_at), id: last._id }, binding) : null,
    has_more: hasMore
  };
}

function approvedFields(value) {
  if (!value) return {};
  rejectUnknownFields(value, ["title", "contributors_text", "publisher", "publish_date_text", "binding_type", "cover_file_id"], "payload.approved_fields");
  const limits = { title: 200, contributors_text: 200, publisher: 100, publish_date_text: 50, binding_type: 50, cover_file_id: 500 };
  const result = {};
  for (const [key, max] of Object.entries(limits)) {
    if (value[key] !== undefined) result[key] = text(value[key], key, { min: key === "title" ? 1 : 0, max });
  }
  return result;
}

function withCoverStatus(fields) {
  return fields.cover_file_id === undefined
    ? fields
    : { ...fields, cover_status: fields.cover_file_id ? "ready" : "missing" };
}

function mergeUserBookRecords(target, source) {
  const targetNote = String(target.private_note || "").trim();
  const sourceNote = String(source.private_note || "").trim();
  const targetDate = target.created_at instanceof Date ? target.created_at : target.created_at && target.created_at.toDate ? target.created_at.toDate() : new Date(target.created_at);
  const sourceDate = source.created_at instanceof Date ? source.created_at : source.created_at && source.created_at.toDate ? source.created_at.toDate() : new Date(source.created_at);
  return {
    quantity: Math.min(99, (target.quantity || 1) + (source.quantity || 1)),
    preference: target.preference && target.preference !== "unmarked" ? target.preference : source.preference || "unmarked",
    private_note: targetNote && sourceNote
      ? `${targetNote}\n\n—— 来自手工录入 ——\n${sourceNote}`.slice(0, 500)
      : (targetNote || sourceNote).slice(0, 500),
    created_at: sourceDate < targetDate ? source.created_at : target.created_at
  };
}

async function migrateEditionRelations(ctx, fromEditionId, toEditionId) {
  if (fromEditionId === toEditionId) return 0;
  const userBooks = await queryAllById(ctx, "user_books", { edition_id: fromEditionId, deleted_at: null }, 100000);
  let migrated = 0;
  for (const oldBook of userBooks) {
    const newId = deterministicId("user_book", [oldBook.owner_id, toEditionId]);
    const relations = await queryAllById(ctx, "bookshelf_books", { owner_id: oldBook.owner_id, user_book_id: oldBook._id }, 10000);
    await ctx.db.runTransaction(async (transaction) => {
      let existing = null;
      try { existing = (await transaction.collection("user_books").doc(newId).get()).data; } catch (_) {}
      if (existing && !existing.deleted_at) {
        await transaction.collection("user_books").doc(newId).update({
          data: { ...mergeUserBookRecords(existing, oldBook), updated_at: ctx.now() }
        });
      } else {
        const copy = { ...oldBook, edition_id: toEditionId, deleted_at: null, updated_at: ctx.now() };
        delete copy._id;
        await transaction.collection("user_books").doc(newId).set({ data: copy });
      }
      for (const relation of relations) {
        const newRelationId = deterministicId("bookshelf_book", [relation.bookshelf_id, newId]);
        let existingRelation = null;
        try { existingRelation = (await transaction.collection("bookshelf_books").doc(newRelationId).get()).data; } catch (_) {}
        if (!existingRelation) {
          const relationCopy = { ...relation, user_book_id: newId };
          delete relationCopy._id;
          await transaction.collection("bookshelf_books").doc(newRelationId).set({ data: relationCopy });
        } else {
          let shelf = null;
          try { shelf = (await transaction.collection("bookshelves").doc(relation.bookshelf_id).get()).data; } catch (_) {}
          if (shelf && shelf.owner_id === oldBook.owner_id && !shelf.deleted_at) {
            await transaction.collection("bookshelves").doc(shelf._id).update({
              data: { book_count: Math.max(0, (shelf.book_count || 0) - 1), updated_at: ctx.now() }
            });
          }
        }
        await transaction.collection("bookshelf_books").doc(relation._id).remove();
      }
      await transaction.collection("user_books").doc(oldBook._id).update({ data: { deleted_at: ctx.now(), updated_at: ctx.now() } });
    });
    migrated += 1;
  }
  return migrated;
}

async function claimManualReview(ctx, submissionId) {
  const lockToken = randomId("review_lock");
  let claimed;
  await ctx.db.runTransaction(async (transaction) => {
    let submission = null;
    try { submission = (await transaction.collection("manual_book_submissions").doc(submissionId).get()).data; } catch (_) {}
    if (!submission) throw new AppError("SUBMISSION_NOT_FOUND", "审核记录不存在");
    if (submission.status !== "pending") throw new AppError("INVALID_STATE", "该记录已被处理");
    const lockExpires = submission.review_lock_expires_at && (
      submission.review_lock_expires_at.toDate
        ? submission.review_lock_expires_at.toDate()
        : new Date(submission.review_lock_expires_at)
    );
    if (submission.review_lock_token && lockExpires > new Date()) {
      throw new AppError("REQUEST_IN_PROGRESS", "该记录正在由另一位管理员处理");
    }
    await transaction.collection("manual_book_submissions").doc(submissionId).update({
      data: {
        review_lock_token: lockToken,
        review_lock_expires_at: new Date(Date.now() + 5 * 60_000),
        updated_at: ctx.now()
      }
    });
    claimed = { ...submission, review_lock_token: lockToken };
  });
  return claimed;
}

async function reviewManualBook(ctx, payload) {
  const submissionId = text(payload.submission_id, "submission_id", { min: 1, max: 100 });
  const submission = await claimManualReview(ctx, submissionId);
  const next = applyReviewDecision(submission, {
    decision: payload.decision,
    rejection_reason: payload.rejection_reason,
    approved_fields: payload.approved_fields
  }, ctx.userId);
  const draft = await getById(ctx.db.collection("book_editions"), submission.draft_edition_id);
  if (!draft) throw new AppError("BOOK_NOT_FOUND", "待审核版本不存在");
  const fields = withCoverStatus(approvedFields(payload.approved_fields));
  if (submission.isbn13 && payload.decision === "approve" && !submission.conflict_edition_id) {
    const runtimeCanonicalId = `isbn_${submission.isbn13}`;
    const runtimeCanonical = await getById(ctx.db.collection("book_editions"), runtimeCanonicalId);
    if (runtimeCanonical && runtimeCanonicalId !== draft._id && !runtimeCanonical.deleted_at) {
      await ctx.db.collection("manual_book_submissions").doc(submissionId).update({
        data: {
          conflict_edition_id: runtimeCanonicalId,
          review_lock_token: "",
          review_lock_expires_at: null,
          updated_at: ctx.now()
        }
      });
      throw new AppError("ISBN_CONFLICT", "审核期间出现了相同 ISBN，请比较两个版本后再决定");
    }
  }
  let canonicalId = draft._id;
  if (payload.decision === "keep_existing") {
    if (!submission.conflict_edition_id) throw new AppError("INVALID_STATE", "当前提交不存在 ISBN 冲突");
    canonicalId = submission.conflict_edition_id;
  } else if (submission.isbn13) {
    canonicalId = `isbn_${submission.isbn13}`;
  }
  let canonical = canonicalId === draft._id ? draft : await getById(ctx.db.collection("book_editions"), canonicalId);
  if (!canonical && payload.decision !== "reject") {
    const search = buildSearchFields([draft.title, draft.contributors_text, draft.publisher, submission.isbn13]);
    canonical = {
      ...draft,
      ...fields,
      ...search,
      _id: canonicalId,
      isbn13: submission.isbn13,
      source: "manual_reviewed",
      audit_status: "approved",
      created_by: submission.owner_id,
      updated_at: ctx.now(),
      deleted_at: null
    };
    await ctx.db.collection("book_editions").doc(canonicalId).set({ data: documentData(canonical) });
  } else if (payload.decision === "replace_allowed_fields") {
    await ctx.db.collection("book_editions").doc(canonicalId).update({ data: { ...fields, audit_status: "approved", updated_at: ctx.now() } });
  } else if (payload.decision === "approve" && canonicalId === draft._id) {
    await ctx.db.collection("book_editions").doc(draft._id).update({ data: { ...fields, audit_status: "approved", updated_at: ctx.now() } });
  }
  let migrated = 0;
  if (payload.decision !== "reject" && canonicalId !== draft._id) {
    migrated = await migrateEditionRelations(ctx, draft._id, canonicalId);
    await ctx.db.collection("book_editions").doc(draft._id).update({
      data: { audit_status: "merged", merged_into_edition_id: canonicalId, deleted_at: ctx.now(), updated_at: ctx.now() }
    });
  } else if (payload.decision === "reject") {
    await ctx.db.collection("book_editions").doc(draft._id).update({ data: { audit_status: "rejected", updated_at: ctx.now() } });
  }
  next.canonical_edition_id = payload.decision === "reject" ? "" : canonicalId;
  next.review_lock_token = "";
  next.review_lock_expires_at = null;
  await ctx.db.collection("manual_book_submissions").doc(submissionId).set({ data: documentData(next) });
  await writeAudit(ctx, "review_manual_book", "manual_book_submission", submissionId, { decision: payload.decision, canonical_edition_id: next.canonical_edition_id, migrated_user_book_count: migrated });
  return { submission: manualSubmissionSummary(next), canonical_edition_id: next.canonical_edition_id || undefined, migrated_user_book_count: migrated };
}

async function updateEdition(ctx, payload) {
  const id = text(payload.edition_id, "edition_id", { min: 1, max: 100 });
  const edition = await getById(ctx.db.collection("book_editions"), id);
  if (!edition || edition.deleted_at) throw new AppError("BOOK_NOT_FOUND", "绘本版本不存在");
  const patch = withCoverStatus(approvedFields(payload.patch));
  if (patch.cover_file_id) await verifyUploadedImage(ctx.cloud, patch.cover_file_id);
  const reason = text(payload.reason, "修改原因", { min: 1, max: 200 });
  const merged = { ...edition, ...patch };
  const search = buildSearchFields([merged.title, merged.contributors_text, merged.publisher, merged.isbn13]);
  await ctx.db.collection("book_editions").doc(id).update({
    data: { ...patch, ...search, title_normalized: normalizeSearchText(merged.title), contributors_normalized: normalizeSearchText(merged.contributors_text), publisher_normalized: normalizeSearchText(merged.publisher), updated_at: ctx.now() }
  });
  await writeAudit(ctx, "update_edition", "book_edition", id, { fields: Object.keys(patch), reason });
  return { edition: editionSummary({ ...merged, ...search }) };
}

async function retryCoverTransfer(ctx, payload) {
  const id = text(payload.edition_id, "edition_id", { min: 1, max: 100 });
  const edition = await getById(ctx.db.collection("book_editions"), id);
  if (!edition) throw new AppError("BOOK_NOT_FOUND", "绘本版本不存在");
  if (edition.cover_file_id) return { edition_id: id, cover_status: "ready", cover_file_id: edition.cover_file_id };
  if (!edition.cover_origin_url) throw new AppError("COVER_SOURCE_EXPIRED", "没有可重试的原始封面地址");
  await ctx.db.collection("book_editions").doc(id).update({ data: { cover_status: "pending", updated_at: ctx.now() } });
  const cover = await transferCover(ctx.cloud, id, edition.cover_origin_url);
  await ctx.db.collection("book_editions").doc(id).update({ data: { ...cover, updated_at: ctx.now() } });
  await writeAudit(ctx, "retry_cover_transfer", "book_edition", id, { from: edition.cover_status, to: cover.cover_status });
  return { edition_id: id, cover_status: cover.cover_status, cover_file_id: cover.cover_file_id || undefined };
}

exports.main = createMain("adminService", {
  dashboard,
  listUsers,
  setUserStatus,
  listPendingBooks,
  reviewManualBook,
  updateEdition,
  retryCoverTransfer
}, { admin: true });
exports.mergeUserBookRecords = mergeUserBookRecords;
