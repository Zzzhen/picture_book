const { createMain, getById, queryAll, queryAllById, documentData } = require("../_shared/cloud");
const { AppError } = require("../_shared/errors");
const { text, enumValue, integer, stringArray, rejectUnknownFields } = require("../_shared/schema");
const { deterministicId } = require("../_shared/identity");
const { userBookSummary, shelfSummary, manualSubmissionSummary } = require("../_shared/serializers");
const { normalizeSearchText, buildSearchFields } = require("../_shared/search");
const { encodeCursor, decodeCursor, stableStringify } = require("../_shared/cursor");
const { recordSystemEvent } = require("../_shared/events");

async function ownedBook(ctx, id) {
  const book = await getById(ctx.db.collection("user_books"), id);
  if (!book || book.deleted_at) throw new AppError("USER_BOOK_NOT_FOUND", "馆藏绘本不存在");
  if (book.owner_id !== ctx.userId) throw new AppError("FORBIDDEN", "不能访问他人的馆藏");
  return book;
}

async function loadEditions(ctx, books) {
  const uniqueIds = Array.from(new Set(books.map((item) => item.edition_id)));
  const rows = [];
  const chunks = [];
  for (let index = 0; index < uniqueIds.length; index += 10) chunks.push(uniqueIds.slice(index, index + 10));
  for (let index = 0; index < chunks.length; index += 5) {
    const pages = await Promise.all(chunks.slice(index, index + 5).map((ids) =>
      queryAll(ctx.db.collection("book_editions").where({ _id: ctx.command.in(ids) }), 10)
    ));
    rows.push(...pages.flat());
  }
  return new Map(rows.map((row) => [row._id, row]));
}

function sortableValue(book, sortField) {
  const value = book[sortField];
  if (sortField === "created_at") {
    const date = value && value.toDate ? value.toDate() : new Date(value);
    return date.getTime();
  }
  if (sortField === "custom_sort") return Number(value || 0);
  return String(value || "");
}

function compareUserBooks(left, right, sortField, direction) {
  const leftValue = sortableValue(left, sortField);
  const rightValue = sortableValue(right, sortField);
  let compared = typeof leftValue === "string"
    ? leftValue.localeCompare(rightValue, "zh-CN")
    : leftValue - rightValue;
  if (!compared) compared = left._id.localeCompare(right._id);
  return direction === "desc" ? -compared : compared;
}

function cursorValue(book, sortField) {
  if (sortField === "created_at") return new Date(sortableValue(book, sortField)).toISOString();
  return book[sortField] === undefined ? (sortField === "custom_sort" ? 0 : "") : book[sortField];
}

async function loadRelationCounts(ctx, items) {
  const ids = Array.from(new Set(items.map((item) => item._id)));
  if (!ids.length) return new Map();
  const relations = await queryAllById(ctx, "bookshelf_books", {
    owner_id: ctx.userId,
    user_book_id: ctx.command.in(ids)
  }, Math.min(5000, ids.length * 50));
  const counts = new Map();
  relations.forEach((relation) => counts.set(relation.user_book_id, (counts.get(relation.user_book_id) || 0) + 1));
  return counts;
}

async function listBooks(ctx, payload) {
  const limit = payload.limit === undefined ? 24 : integer(payload.limit, "limit", 1, 50);
  const sort = enumValue(payload.sort || "newest", "sort", ["newest", "oldest", "title", "custom"]);
  const preference = payload.preference ? enumValue(payload.preference, "preference", ["unmarked", "recommended", "neutral", "not_recommended"]) : undefined;
  const cover = payload.cover ? enumValue(payload.cover, "cover", ["with", "without"]) : undefined;
  const queryText = payload.query ? normalizeSearchText(text(payload.query, "搜索词", { max: 100 })) : "";
  const binding = { action: "listBooks", owner: ctx.userId, filter: stableStringify({ sort, preference, cover, queryText, bookshelf_id: payload.bookshelf_id || "" }) };
  const cursor = payload.cursor ? decodeCursor(payload.cursor, binding) : null;
  const condition = { owner_id: ctx.userId, deleted_at: null };
  if (preference) condition.preference = preference;
  const sortField = sort === "title" ? "title_sort" : sort === "custom" ? "custom_sort" : "created_at";
  const direction = sort === "newest" ? "desc" : "asc";
  if (queryText || cover || preference || payload.bookshelf_id) {
    let allowedIds = null;
    if (payload.bookshelf_id) {
      const shelf = await getById(ctx.db.collection("bookshelves"), payload.bookshelf_id);
      if (!shelf || shelf.owner_id !== ctx.userId || shelf.deleted_at) throw new AppError("BOOKSHELF_NOT_FOUND", "书架不存在");
      const relations = await queryAllById(ctx, "bookshelf_books", {
        owner_id: ctx.userId,
        bookshelf_id: payload.bookshelf_id
      }, 500);
      allowedIds = new Set(relations.map((item) => item.user_book_id));
      if (!allowedIds.size) return { items: [], next_cursor: null, has_more: false };
    }
    let books = await queryAllById(ctx, "user_books", condition, 1000);
    if (allowedIds) books = books.filter((book) => allowedIds.has(book._id));
    const editions = await loadEditions(ctx, books);
    if (queryText) {
      books = books.filter((book) => {
        const edition = editions.get(book.edition_id) || {};
        return [
          edition.title_normalized,
          edition.contributors_normalized,
          edition.publisher_normalized,
          edition.isbn13,
          edition.isbn10
        ].some((value) => String(value || "").includes(queryText));
      });
    }
    if (cover) {
      books = books.filter((book) => {
        const hasCover = Boolean(editions.get(book.edition_id) && editions.get(book.edition_id).cover_url);
        return cover === "with" ? hasCover : !hasCover;
      });
    }
    books.sort((left, right) => compareUserBooks(left, right, sortField, direction));
    if (cursor) {
      const cursorBook = {
        _id: cursor.id,
        [sortField]: sortField === "created_at" ? new Date(cursor.value) : cursor.value
      };
      books = books.filter((book) => compareUserBooks(book, cursorBook, sortField, direction) > 0);
    }
    const page = books.slice(0, limit + 1);
    const hasMore = page.length > limit;
    const items = page.slice(0, limit);
    const relationCountByBook = await loadRelationCounts(ctx, items);
    const last = items[items.length - 1];
    return {
      items: items.map((item) => userBookSummary(item, editions.get(item.edition_id), relationCountByBook.get(item._id) || 0)),
      next_cursor: hasMore && last ? encodeCursor({ value: cursorValue(last, sortField), id: last._id }, binding) : null,
      has_more: hasMore
    };
  }
  let whereCondition = condition;
  if (cursor) {
    const value = sortField === "created_at" ? new Date(cursor.value) : cursor.value;
    const compare = direction === "desc" ? ctx.command.lt : ctx.command.gt;
    whereCondition = ctx.command.and([
      condition,
      ctx.command.or([
        { [sortField]: compare(value) },
        { [sortField]: value, _id: compare(cursor.id) }
      ])
    ]);
  }
  let books = await queryAll(
    ctx.db.collection("user_books").where(whereCondition).orderBy(sortField, direction).orderBy("_id", direction),
    Math.min(100, limit * 3 + 1)
  );
  const editions = await loadEditions(ctx, books);
  if (cover) {
    books = books.filter((book) => {
      const hasCover = Boolean(editions.get(book.edition_id) && editions.get(book.edition_id).cover_url);
      return cover === "with" ? hasCover : !hasCover;
    });
  }
  const page = books.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const items = page.slice(0, limit);
  const relationCountByBook = await loadRelationCounts(ctx, items);
  const last = items[items.length - 1];
  let nextCursor = null;
  if (hasMore && last) {
    nextCursor = encodeCursor({ value: cursorValue(last, sortField), id: last._id }, binding);
  }
  return {
    items: items.map((item) => userBookSummary(item, editions.get(item.edition_id), relationCountByBook.get(item._id) || 0)),
    next_cursor: nextCursor,
    has_more: hasMore
  };
}

async function addBook(ctx, payload) {
  const editionId = text(payload.edition_id, "edition_id", { min: 1, max: 100 });
  if (payload.quantity_delta !== undefined && payload.quantity_delta !== 1) throw new AppError("INVALID_ARGUMENT", "quantity_delta 当前只允许为 1");
  if (payload.scan_session_id !== undefined) text(payload.scan_session_id, "scan_session_id", { min: 1, max: 100 });
  const edition = await getById(ctx.db.collection("book_editions"), editionId);
  if (edition && (edition._id !== editionId || (editionId.startsWith("isbn_") && edition.isbn13 && edition.isbn13 !== editionId.slice(5)))) {
    console.error("edition identity mismatch", {
      requested_edition_id: editionId,
      resolved_edition_id: edition._id,
      resolved_isbn13: edition.isbn13
    });
    throw new AppError("DATA_INCONSISTENT", "绘本版本标识与 ISBN 不一致，请联系管理员");
  }
  if (!edition || edition.deleted_at || edition.audit_status === "merged") throw new AppError("BOOK_NOT_FOUND", "绘本信息不存在");
  if (edition.audit_status !== "approved" && edition.created_by !== ctx.userId) throw new AppError("FORBIDDEN", "该绘本尚未公开");
  const id = deterministicId("user_book", [ctx.userId, editionId]);
  let created = false;
  let next;
  await ctx.db.runTransaction(async (transaction) => {
    const collection = transaction.collection("user_books");
    let existing = null;
    try { existing = (await collection.doc(id).get()).data; } catch (_) {}
    if (existing && !existing.deleted_at) {
      const quantity = (existing.quantity || 1) + 1;
      if (quantity > 99) throw new AppError("QUANTITY_LIMIT", "馆藏数量最多 99 册");
      next = { ...existing, quantity, updated_at: ctx.now() };
      await collection.doc(id).update({ data: { quantity, updated_at: ctx.now() } });
    } else {
      const search = buildSearchFields([edition.title, edition.contributors_text, edition.publisher, edition.isbn13]);
      next = {
        _id: id,
        owner_id: ctx.userId,
        edition_id: editionId,
        quantity: 1,
        preference: "unmarked",
        private_note: "",
        custom_sort: 0,
        title_sort: edition.title_normalized || normalizeSearchText(edition.title),
        ...search,
        created_at: ctx.now(),
        updated_at: ctx.now(),
        deleted_at: null
      };
      await collection.doc(id).set({ data: documentData(next) });
      created = true;
    }
  });
  if (created) {
    const count = await ctx.db.collection("user_books").where({ owner_id: ctx.userId, deleted_at: null }).count();
    const milestones = { 1: "first_book_added", 5: "book_count_reached_5", 10: "book_count_reached_10" };
    if (milestones[count.total]) {
      await recordSystemEvent(ctx, milestones[count.total], { book_count_bucket: String(count.total) });
    }
  }
  return { user_book: userBookSummary(next, edition, 0), created, quantity_changed: !created };
}

async function getUserBook(ctx, payload) {
  const userBook = await ownedBook(ctx, text(payload.user_book_id, "user_book_id", { min: 1, max: 100 }));
  let edition = await getById(ctx.db.collection("book_editions"), userBook.edition_id);
  if (edition.audit_status === "merged" && edition.merged_into_edition_id) edition = await getById(ctx.db.collection("book_editions"), edition.merged_into_edition_id);
  const relations = await queryAll(ctx.db.collection("bookshelf_books").where({ owner_id: ctx.userId, user_book_id: userBook._id }), 100);
  const shelves = (await Promise.all(relations.map((item) => getById(ctx.db.collection("bookshelves"), item.bookshelf_id)))).filter((item) => item && !item.deleted_at);
  let submission;
  if (edition.created_by === ctx.userId) {
    const rows = await queryAll(ctx.db.collection("manual_book_submissions").where({ owner_id: ctx.userId, draft_edition_id: edition._id }), 1);
    submission = rows[0];
  }
  return {
    user_book: userBookSummary(userBook, edition, relations.length),
    private_note: userBook.private_note || "",
    bookshelves: shelves.map(shelfSummary),
    manual_submission: manualSubmissionSummary(submission)
  };
}

function updatePatch(input) {
  rejectUnknownFields(input, ["quantity", "preference", "private_note", "custom_sort"], "payload.patch");
  const patch = {};
  if (input.quantity !== undefined) patch.quantity = integer(input.quantity, "quantity", 1, 99);
  if (input.preference !== undefined) patch.preference = enumValue(input.preference, "preference", ["unmarked", "recommended", "neutral", "not_recommended"]);
  if (input.private_note !== undefined) patch.private_note = text(input.private_note, "家庭备注", { max: 500 });
  if (input.custom_sort !== undefined) patch.custom_sort = integer(input.custom_sort, "custom_sort", -1000000, 1000000);
  if (!Object.keys(patch).length) throw new AppError("INVALID_ARGUMENT", "没有可更新的字段");
  return patch;
}

async function updateBook(ctx, payload) {
  const id = text(payload.user_book_id, "user_book_id", { min: 1, max: 100 });
  const userBook = await ownedBook(ctx, id);
  const patch = updatePatch(payload.patch);
  await ctx.db.collection("user_books").doc(id).update({ data: { ...patch, updated_at: ctx.now() } });
  const edition = await getById(ctx.db.collection("book_editions"), userBook.edition_id);
  return { user_book: userBookSummary({ ...userBook, ...patch }, edition), private_note: patch.private_note !== undefined ? patch.private_note : userBook.private_note || "" };
}

async function removeOwnedBook(ctx, id) {
  const book = await ownedBook(ctx, id);
  const relations = await queryAll(ctx.db.collection("bookshelf_books").where({ owner_id: ctx.userId, user_book_id: id }), 100);
  await ctx.db.runTransaction(async (transaction) => {
    await transaction.collection("user_books").doc(id).update({ data: { deleted_at: ctx.now(), updated_at: ctx.now() } });
    for (const relation of relations) {
      await transaction.collection("bookshelf_books").doc(relation._id).remove();
    }
    const grouped = Array.from(new Set(relations.map((item) => item.bookshelf_id)));
    for (const shelfId of grouped) {
      const shelf = await getById(ctx.db.collection("bookshelves"), shelfId);
      if (shelf) await transaction.collection("bookshelves").doc(shelfId).update({ data: { book_count: Math.max(0, (shelf.book_count || 0) - 1), updated_at: ctx.now() } });
    }
  });
  return book;
}

async function removeBook(ctx, payload) {
  if (payload.confirm !== true) throw new AppError("CONFIRMATION_REQUIRED", "删除馆藏需要确认");
  const id = text(payload.user_book_id, "user_book_id", { min: 1, max: 100 });
  await removeOwnedBook(ctx, id);
  return { removed: true, user_book_id: id };
}

async function updateShelfRelation(ctx, shelfId, userBookId, shouldExist) {
  const relationId = deterministicId("bookshelf_book", [shelfId, userBookId]);
  await ctx.db.runTransaction(async (transaction) => {
    let shelf = null;
    let relation = null;
    try { shelf = (await transaction.collection("bookshelves").doc(shelfId).get()).data; } catch (_) {}
    if (!shelf || shelf.owner_id !== ctx.userId || shelf.deleted_at) throw new AppError("BOOKSHELF_NOT_FOUND", "书架不存在");
    try { relation = (await transaction.collection("bookshelf_books").doc(relationId).get()).data; } catch (_) {}
    if (shouldExist && !relation) {
      if ((shelf.book_count || 0) >= 500) throw new AppError("BOOKSHELF_BOOK_LIMIT", "每个书架最多加入 500 本不同绘本");
      await transaction.collection("bookshelf_books").doc(relationId).set({
        data: {
          owner_id: ctx.userId,
          bookshelf_id: shelfId,
          user_book_id: userBookId,
          sort_order: shelf.book_count || 0,
          created_at: ctx.now()
        }
      });
      await transaction.collection("bookshelves").doc(shelfId).update({
        data: { book_count: (shelf.book_count || 0) + 1, updated_at: ctx.now() }
      });
    } else if (!shouldExist && relation && relation.owner_id === ctx.userId) {
      await transaction.collection("bookshelf_books").doc(relationId).remove();
      await transaction.collection("bookshelves").doc(shelfId).update({
        data: { book_count: Math.max(0, (shelf.book_count || 0) - 1), updated_at: ctx.now() }
      });
    }
  });
}

async function batchUpdate(ctx, payload) {
  const ids = stringArray(payload.user_book_ids, "user_book_ids");
  const operation = enumValue(payload.operation, "operation", ["set_preference", "add_to_shelf", "remove_from_shelf", "remove"]);
  if ((operation === "remove" || operation === "remove_from_shelf") && payload.confirm !== true) throw new AppError("CONFIRMATION_REQUIRED", "批量删除需要确认");
  let processed = 0;
  const failed = [];
  for (const id of ids) {
    try {
      if (operation === "set_preference") {
        const preference = enumValue(payload.value, "value", ["unmarked", "recommended", "neutral", "not_recommended"]);
        await updateBook(ctx, { user_book_id: id, patch: { preference } });
      } else if (operation === "remove") {
        await removeOwnedBook(ctx, id);
      } else {
        const shelfId = text(payload.value, "value", { min: 1, max: 100 });
        const shelf = await getById(ctx.db.collection("bookshelves"), shelfId);
        if (!shelf || shelf.owner_id !== ctx.userId || shelf.deleted_at) throw new AppError("BOOKSHELF_NOT_FOUND", "书架不存在");
        await ownedBook(ctx, id);
        await updateShelfRelation(ctx, shelfId, id, operation === "add_to_shelf");
      }
      processed += 1;
    } catch (error) {
      failed.push({ user_book_id: id, code: error.code || "INTERNAL_ERROR" });
    }
  }
  return { processed_count: processed, failed };
}

exports.main = createMain("libraryService", {
  listBooks,
  addBook,
  getUserBook,
  updateBook,
  removeBook,
  batchUpdate
});
