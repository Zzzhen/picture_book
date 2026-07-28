const { createMain, getById, queryAll, documentData } = require("../_shared/cloud");
const { AppError } = require("../_shared/errors");
const { text, integer, rejectUnknownFields } = require("../_shared/schema");
const { editionSummary, manualSubmissionSummary } = require("../_shared/serializers");
const { normalizeSearchText, buildSearchFields } = require("../_shared/search");
const { normalizeIsbn, toIsbn13 } = require("../_shared/isbn");
const { deterministicId, randomId } = require("../_shared/identity");
const { encodeCursor, decodeCursor, stableStringify } = require("../_shared/cursor");
const { queryAliyunIsbn } = require("../_shared/provider");
const { transferCover } = require("../_shared/cover-transfer");
const { verifyUploadedImage } = require("../_shared/content-security");
const { recordSystemEvent } = require("../_shared/events");

function asDate(value) {
  if (!value) return null;
  return value instanceof Date ? value : value.toDate ? value.toDate() : new Date(value);
}

function ownsLookupLock(cached, lockToken) {
  return Boolean(cached && cached.status === "querying" && cached.lock_token === lockToken);
}

function positiveLimit(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function claimQuota(ctx) {
  const config = await getById(ctx.db.collection("system_config"), "isbn_provider") || {};
  if (config.circuit_open_until && asDate(config.circuit_open_until) > new Date()) {
    throw new AppError("PROVIDER_CIRCUIT_OPEN", "图书信息服务正在恢复中，请稍后重试", null, true);
  }
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const limits = [
    { scope: ctx.userId, period: day, limit: positiveLimit(config.user_daily_limit || process.env.ISBN_USER_DAILY_LIMIT, 100), enforceInterval: true, code: "ISBN_QUOTA_EXCEEDED" },
    { scope: "global", period: day, limit: positiveLimit(config.global_daily_limit || process.env.ISBN_GLOBAL_DAILY_LIMIT, 3000), code: "ISBN_GLOBAL_QUOTA_EXCEEDED" },
    { scope: "global", period: month, limit: positiveLimit(config.global_monthly_limit || process.env.ISBN_GLOBAL_MONTHLY_LIMIT, 50000), code: "ISBN_GLOBAL_QUOTA_EXCEEDED" }
  ];
  try {
    await ctx.db.runTransaction(async (transaction) => {
      for (const item of limits) {
        const id = deterministicId("rate_limit", [item.scope, "isbn_external", item.period]);
        const collection = transaction.collection("rate_limits");
        let record = null;
        try { record = (await collection.doc(id).get()).data; } catch (_) {}
        if (record && record.count >= item.limit) throw new AppError(item.code, "本期 ISBN 查询额度已用完");
        if (item.enforceInterval && record && record.last_called_at && now - asDate(record.last_called_at) < 800) {
          throw new AppError("RATE_LIMITED", "ISBN 查询过于频繁，请稍后再试", { retry_after_ms: 800 }, true);
        }
        await collection.doc(id).set({
          data: {
            scope_id: item.scope,
            limit_type: "isbn_external",
            period_key: item.period,
            count: (record && record.count || 0) + 1,
            last_called_at: item.enforceInterval ? now : record && record.last_called_at || null,
            updated_at: ctx.now(),
            created_at: record && record.created_at || ctx.now()
          }
        });
      }
    });
  } catch (error) {
    if (error.code === "ISBN_GLOBAL_QUOTA_EXCEEDED") {
      await ctx.db.collection("system_config").doc("isbn_provider").update({
        data: { quota_exceeded: true, circuit_open_until: new Date("2099-12-31T23:59:59.000Z"), updated_at: ctx.now() }
      }).catch(() => {});
    }
    throw error;
  }
}

async function acquireLookup(ctx, isbn13) {
  const id = `isbn_${isbn13}`;
  let result = { status: "claimed" };
  await ctx.db.runTransaction(async (transaction) => {
    const collection = transaction.collection("isbn_lookup_cache");
    let cached = null;
    try { cached = (await collection.doc(id).get()).data; } catch (_) {}
    const now = new Date();
    const expires = cached && asDate(cached.expire_at);
    const lockExpires = cached && asDate(cached.lock_expires_at);
    if (cached && cached.status === "found" && cached.edition_id) {
      let edition = null;
      try { edition = (await transaction.collection("book_editions").doc(cached.edition_id).get()).data; } catch (_) {}
      if (edition && !edition.deleted_at && edition.audit_status === "approved") {
        result = { status: "found", editionId: cached.edition_id };
        return;
      }
    }
    if (cached && cached.status === "not_found" && expires && expires > now) {
      throw new AppError("BOOK_NOT_FOUND", "没有查询到这本绘本");
    }
    if (cached && cached.status === "provider_error" && expires && expires > now) {
      throw new AppError("PROVIDER_UNAVAILABLE", "图书信息服务暂时不可用", null, true);
    }
    if (cached && cached.status === "querying" && lockExpires && lockExpires > now) {
      throw new AppError("BOOK_LOOKUP_IN_PROGRESS", "相同 ISBN 正在查询", { retry_after_ms: 800 }, true);
    }
    const lockToken = randomId("lock");
    await collection.doc(id).set({
      data: {
        isbn13,
        status: "querying",
        edition_id: "",
        lock_token: lockToken,
        lock_expires_at: new Date(Date.now() + 60_000),
        provider_code: 0,
        expire_at: null,
        created_at: cached && cached.created_at || ctx.now(),
        updated_at: ctx.now()
      }
    });
    result = { status: "claimed", lockToken };
  });
  return result;
}

async function commitLookupState(ctx, isbn13, lockToken, cachePatch, edition) {
  const cacheId = `isbn_${isbn13}`;
  await ctx.db.runTransaction(async (transaction) => {
    let cached = null;
    try { cached = (await transaction.collection("isbn_lookup_cache").doc(cacheId).get()).data; } catch (_) {}
    if (!ownsLookupLock(cached, lockToken)) {
      throw new AppError("LOOKUP_LOCK_LOST", "查询锁已失效，请重新查询", null, true);
    }
    if (edition) {
      await transaction.collection("book_editions").doc(edition._id).set({ data: documentData(edition) });
    }
    await transaction.collection("isbn_lookup_cache").doc(cacheId).update({
      data: {
        ...cachePatch,
        lock_token: "",
        lock_expires_at: null,
        updated_at: ctx.now()
      }
    });
  });
}

async function lookupByIsbn(ctx, payload) {
  const isbn13 = toIsbn13(payload.isbn);
  if (!isbn13) throw new AppError("INVALID_ISBN", "请输入正确的 ISBN");
  const canonicalId = `isbn_${isbn13}`;
  const canonical = await getById(ctx.db.collection("book_editions"), canonicalId);
  if (canonical && canonical.audit_status === "approved" && !canonical.deleted_at) {
    await ctx.db.collection("isbn_lookup_cache").doc(canonicalId).set({
      data: {
        isbn13,
        status: "found",
        edition_id: canonicalId,
        lock_token: "",
        lock_expires_at: null,
        provider_code: canonical.provider_code || 0,
        expire_at: null,
        created_at: canonical.created_at || ctx.now(),
        updated_at: ctx.now()
      }
    });
    await recordSystemEvent(ctx, "isbn_cache_hit", { cache_hit: true, provider_called: false });
    return { lookup_status: "found", edition: editionSummary(canonical), provider_called: false, cache_hit: true };
  }
  const acquired = await acquireLookup(ctx, isbn13);
  if (acquired.status === "found") {
    const edition = await getById(ctx.db.collection("book_editions"), acquired.editionId);
    if (edition && !edition.deleted_at) {
      await recordSystemEvent(ctx, "isbn_cache_hit", { cache_hit: true, provider_called: false });
      return { lookup_status: "found", edition: editionSummary(edition), provider_called: false, cache_hit: true };
    }
  }
  try {
    await claimQuota(ctx);
  } catch (error) {
    const retryAfter = error.code === "RATE_LIMITED" ? Number(error.data && error.data.retry_after_ms || 800) : 60_000;
    await commitLookupState(ctx, isbn13, acquired.lockToken, {
      status: "provider_error",
      provider_code: 0,
      expire_at: new Date(Date.now() + retryAfter)
    });
    throw error;
  }
  let providerEdition;
  try {
    providerEdition = await queryAliyunIsbn(isbn13);
  } catch (error) {
    await commitLookupState(ctx, isbn13, acquired.lockToken, {
      status: "provider_error",
      provider_code: Number(error.data && error.data.provider_code || 0),
      expire_at: new Date(Date.now() + 5 * 60_000)
    });
    throw error;
  }
  if (!providerEdition) {
    await commitLookupState(ctx, isbn13, acquired.lockToken, {
      status: "not_found",
      edition_id: "",
      provider_code: 200,
      expire_at: new Date(Date.now() + 24 * 60 * 60_000)
    });
    await recordSystemEvent(ctx, "isbn_lookup_not_found", { cache_hit: false, provider_called: true, result_code: "BOOK_NOT_FOUND" });
    throw new AppError("BOOK_NOT_FOUND", "没有查询到这本绘本");
  }
  const editionId = canonicalId;
  const search = buildSearchFields([providerEdition.title, providerEdition.contributors_text, providerEdition.publisher, isbn13]);
  const edition = {
    ...providerEdition,
    ...search,
    cover_file_id: "",
    cover_status: providerEdition.cover_source_url ? "pending" : "missing",
    cover_origin_url: providerEdition.cover_source_url || "",
    title_normalized: normalizeSearchText(providerEdition.title),
    contributors_normalized: normalizeSearchText(providerEdition.contributors_text),
    publisher_normalized: normalizeSearchText(providerEdition.publisher),
    source: "aliyun_isbn",
    audit_status: "approved",
    created_by: "",
    merged_into_edition_id: "",
    provider_queried_at: ctx.now(),
    created_at: ctx.now(),
    updated_at: ctx.now(),
    deleted_at: null
  };
  delete edition.cover_source_url;
  await commitLookupState(ctx, isbn13, acquired.lockToken, {
    status: "found",
    edition_id: editionId,
    provider_code: edition.provider_code,
    expire_at: null
  }, edition);
  const cover = await transferCover(ctx.cloud, editionId, edition.cover_origin_url);
  await ctx.db.collection("book_editions").doc(editionId).update({
    data: { ...cover, updated_at: ctx.now() }
  });
  await recordSystemEvent(ctx, "isbn_provider_called", { cache_hit: false, provider_called: true, result_code: "OK" });
  return { lookup_status: "found", edition: editionSummary({ ...edition, ...cover }), provider_called: true, cache_hit: false };
}

async function getLookupStatus(ctx, payload) {
  const isbn13 = toIsbn13(payload.isbn);
  if (!isbn13) throw new AppError("INVALID_ISBN", "请输入正确的 ISBN");
  const cached = await getById(ctx.db.collection("isbn_lookup_cache"), `isbn_${isbn13}`);
  if (!cached) return { lookup_status: "not_found" };
  if (cached.status === "found") {
    const edition = await getById(ctx.db.collection("book_editions"), cached.edition_id);
    return { lookup_status: "found", edition: editionSummary(edition) };
  }
  if (cached.status === "querying") return { lookup_status: "querying", retry_after_ms: 1000 };
  return { lookup_status: cached.status === "provider_error" ? "provider_error" : "not_found" };
}

async function searchCachedBooks(ctx, payload) {
  const query = normalizeSearchText(text(payload.query, "搜索词", { min: 1, max: 100 }));
  const limit = payload.limit === undefined ? 24 : integer(payload.limit, "limit", 1, 50);
  const binding = { action: "searchCachedBooks", owner: ctx.userId, filter: query };
  const position = payload.cursor ? decodeCursor(payload.cursor, binding) : null;
  let candidates = [];
  const exact = await getById(ctx.db.collection("book_editions"), `isbn_${normalizeIsbn(query)}`);
  if (exact && exact.audit_status === "approved") candidates.push(exact);
  if (candidates.length < 100) {
    const tokenCandidates = await queryAll(
      ctx.db.collection("book_editions").where({
        audit_status: "approved",
        deleted_at: null,
        search_prefixes: ctx.command.all([query])
      }),
      100
    );
    candidates.push(...tokenCandidates);
  }
  candidates = Array.from(new Map(candidates.map((item) => [item._id, item])).values())
    .filter((item) => [item.title_normalized, item.contributors_normalized, item.publisher_normalized, item.isbn13].some((value) => String(value || "").includes(query)))
    .sort((a, b) => a.title_normalized.localeCompare(b.title_normalized, "zh-CN") || a._id.localeCompare(b._id));
  if (position) candidates = candidates.filter((item) => item.title_normalized > position.value || item.title_normalized === position.value && item._id > position.id);
  const page = candidates.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const items = page.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items: items.map(editionSummary),
    next_cursor: hasMore ? encodeCursor({ value: last.title_normalized, id: last._id }, binding) : null,
    has_more: hasMore
  };
}

async function getEditionDetail(ctx, payload) {
  const editionId = text(payload.edition_id, "edition_id", { min: 1, max: 100 });
  let edition = await getById(ctx.db.collection("book_editions"), editionId);
  if (!edition) throw new AppError("BOOK_NOT_FOUND", "绘本信息不存在");
  if (edition.audit_status === "merged" && edition.merged_into_edition_id) edition = await getById(ctx.db.collection("book_editions"), edition.merged_into_edition_id);
  let submission;
  if (edition.created_by === ctx.userId || edition.audit_status !== "approved") {
    const rows = await queryAll(ctx.db.collection("manual_book_submissions").where({ draft_edition_id: edition._id, owner_id: ctx.userId }), 1);
    submission = rows[0];
  }
  return {
    edition: {
      ...editionSummary(edition),
      description: edition.description || "",
      language: edition.language || "",
      format: edition.format || "",
      page_count_text: edition.page_count_text || "",
      keywords: edition.keywords || []
    },
    manual_submission: manualSubmissionSummary(submission)
  };
}

function manualFields(input, partial = false) {
  rejectUnknownFields(input, ["title", "contributors_text", "publisher", "isbn", "binding_type", "cover_file_id"], "payload");
  const result = {};
  if (!partial || input.title !== undefined) result.title = text(input.title, "书名", { min: 1, max: 200 });
  if (input.contributors_text !== undefined) result.contributors_text = text(input.contributors_text, "作者", { max: 200 });
  if (input.publisher !== undefined) result.publisher = text(input.publisher, "出版社", { max: 100 });
  if (input.binding_type !== undefined) result.binding_type = text(input.binding_type, "装帧", { max: 50 });
  if (input.cover_file_id !== undefined) result.cover_file_id = text(input.cover_file_id, "封面文件", { max: 500 });
  if (input.isbn !== undefined) {
    if (input.isbn === "") {
      result.isbn13 = "";
    } else {
      const isbn13 = toIsbn13(input.isbn);
      if (!isbn13) throw new AppError("INVALID_ISBN", "请输入正确的 ISBN");
      result.isbn13 = isbn13;
    }
  }
  return result;
}

async function createManualBook(ctx, payload) {
  const fields = manualFields(payload);
  const security = await verifyUploadedImage(ctx.cloud, fields.cover_file_id);
  const editionId = randomId("manual");
  const submissionId = randomId("submission");
  const conflictEditionId = fields.isbn13 && await getById(ctx.db.collection("book_editions"), `isbn_${fields.isbn13}`) ? `isbn_${fields.isbn13}` : "";
  const search = buildSearchFields([fields.title, fields.contributors_text, fields.publisher, fields.isbn13]);
  const edition = {
    _id: editionId,
    ...fields,
    ...search,
    title_normalized: normalizeSearchText(fields.title),
    contributors_normalized: normalizeSearchText(fields.contributors_text),
    publisher_normalized: normalizeSearchText(fields.publisher),
    cover_status: fields.cover_file_id ? "ready" : "missing",
    source: "manual",
    audit_status: "pending",
    created_by: ctx.userId,
    merged_into_edition_id: "",
    created_at: ctx.now(),
    updated_at: ctx.now(),
    deleted_at: null
  };
  const submission = {
    _id: submissionId,
    owner_id: ctx.userId,
    draft_edition_id: editionId,
    isbn13: fields.isbn13 || "",
    submitted_fields: fields,
    content_security_status: security,
    status: "pending",
    rejection_reason: "",
    conflict_edition_id: conflictEditionId,
    canonical_edition_id: "",
    resolution: "",
    reviewed_by: "",
    submitted_at: ctx.now(),
    reviewed_at: null,
    updated_at: ctx.now()
  };
  const userBookId = deterministicId("user_book", [ctx.userId, editionId]);
  await ctx.db.runTransaction(async (transaction) => {
    await transaction.collection("book_editions").doc(editionId).set({ data: documentData(edition) });
    await transaction.collection("manual_book_submissions").doc(submissionId).set({ data: documentData(submission) });
    await transaction.collection("user_books").doc(userBookId).set({
      data: { owner_id: ctx.userId, edition_id: editionId, quantity: 1, preference: "unmarked", private_note: "", custom_sort: 0, ...search, created_at: ctx.now(), updated_at: ctx.now(), deleted_at: null }
    });
  });
  return { edition: editionSummary(edition), submission: manualSubmissionSummary(submission), review_eta_text: "预计 1—3 个自然日" };
}

async function updateManualSubmission(ctx, payload) {
  const submissionId = text(payload.submission_id, "submission_id", { min: 1, max: 100 });
  const submission = await getById(ctx.db.collection("manual_book_submissions"), submissionId);
  if (!submission) throw new AppError("SUBMISSION_NOT_FOUND", "手工提交不存在");
  if (submission.owner_id !== ctx.userId) throw new AppError("FORBIDDEN", "不能修改他人的提交");
  if (!["pending", "rejected"].includes(submission.status)) throw new AppError("INVALID_STATE", "当前审核状态不可修改");
  const patch = manualFields(payload.patch, true);
  if (patch.cover_file_id) await verifyUploadedImage(ctx.cloud, patch.cover_file_id);
  const fields = { ...submission.submitted_fields, ...patch };
  const conflictEditionId = fields.isbn13 &&
    await getById(ctx.db.collection("book_editions"), `isbn_${fields.isbn13}`)
    ? `isbn_${fields.isbn13}`
    : "";
  const search = buildSearchFields([fields.title, fields.contributors_text, fields.publisher, fields.isbn13]);
  const editionPatch = { ...patch, ...search };
  if (patch.cover_file_id !== undefined) editionPatch.cover_status = patch.cover_file_id ? "ready" : "missing";
  await ctx.db.runTransaction(async (transaction) => {
    await transaction.collection("manual_book_submissions").doc(submissionId).update({
      data: { submitted_fields: fields, isbn13: fields.isbn13 || "", conflict_edition_id: conflictEditionId, updated_at: ctx.now() }
    });
    await transaction.collection("book_editions").doc(submission.draft_edition_id).update({
      data: { ...editionPatch, title_normalized: normalizeSearchText(fields.title), contributors_normalized: normalizeSearchText(fields.contributors_text), publisher_normalized: normalizeSearchText(fields.publisher), updated_at: ctx.now() }
    });
  });
  const edition = await getById(ctx.db.collection("book_editions"), submission.draft_edition_id);
  const nextSubmission = await getById(ctx.db.collection("manual_book_submissions"), submissionId);
  return { edition: editionSummary(edition), submission: manualSubmissionSummary(nextSubmission) };
}

async function resubmitManualBook(ctx, payload) {
  const submissionId = text(payload.submission_id, "submission_id", { min: 1, max: 100 });
  const submission = await getById(ctx.db.collection("manual_book_submissions"), submissionId);
  if (!submission) throw new AppError("SUBMISSION_NOT_FOUND", "手工提交不存在");
  if (submission.owner_id !== ctx.userId) throw new AppError("FORBIDDEN", "不能提交他人的记录");
  if (submission.status !== "rejected") throw new AppError("INVALID_STATE", "只有已驳回记录可以重新提交");
  await ctx.db.runTransaction(async (transaction) => {
    await transaction.collection("manual_book_submissions").doc(submissionId).update({
      data: { status: "pending", rejection_reason: "", submitted_at: ctx.now(), reviewed_at: null, reviewed_by: "", updated_at: ctx.now() }
    });
    await transaction.collection("book_editions").doc(submission.draft_edition_id).update({
      data: { audit_status: "pending", updated_at: ctx.now() }
    });
  });
  const next = await getById(ctx.db.collection("manual_book_submissions"), submissionId);
  return { submission: manualSubmissionSummary(next), review_eta_text: "预计 1—3 个自然日" };
}

exports.main = createMain("bookService", {
  lookupByIsbn,
  getLookupStatus,
  searchCachedBooks,
  getEditionDetail,
  createManualBook,
  updateManualSubmission,
  resubmitManualBook
});
exports.ownsLookupLock = ownsLookupLock;
