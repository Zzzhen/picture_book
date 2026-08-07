const { createMain, getById, queryAll, queryAllById, documentData } = require("../_shared/cloud");
const { AppError } = require("../_shared/errors");
const { text, integer, stringArray, rejectUnknownFields } = require("../_shared/schema");
const { randomId, deterministicId } = require("../_shared/identity");
const { shelfSummary, userBookSummary } = require("../_shared/serializers");
const { encodeCursor, decodeCursor } = require("../_shared/cursor");
const { drainBatches } = require("../_shared/deletion");
const { buildPinPlan } = require("../_shared/bookshelf-order");

async function ownedShelf(ctx, id) {
  const shelf = await getById(ctx.db.collection("bookshelves"), id);
  if (!shelf || shelf.deleted_at) throw new AppError("BOOKSHELF_NOT_FOUND", "书架不存在");
  if (shelf.owner_id !== ctx.userId) throw new AppError("FORBIDDEN", "不能访问他人的书架");
  return shelf;
}

async function ownedBook(ctx, id) {
  const book = await getById(ctx.db.collection("user_books"), id);
  if (!book || book.deleted_at) throw new AppError("USER_BOOK_NOT_FOUND", "馆藏绘本不存在");
  if (book.owner_id !== ctx.userId) throw new AppError("FORBIDDEN", "不能操作他人的馆藏");
  return book;
}

async function listShelves(ctx) {
  const shelves = await queryAll(
    ctx.db.collection("bookshelves").where({ owner_id: ctx.userId, deleted_at: null }).orderBy("sort_order", "asc").orderBy("_id", "asc"),
    100
  );
  const items = await Promise.all(shelves.map(async (shelf) => {
    const relations = await queryAll(ctx.db.collection("bookshelf_books").where({ owner_id: ctx.userId, bookshelf_id: shelf._id }).orderBy("sort_order", "asc"), 4);
    const books = (await Promise.all(relations.map((row) => getById(ctx.db.collection("user_books"), row.user_book_id)))).filter(Boolean);
    const editions = (await Promise.all(books.map((book) => getById(ctx.db.collection("book_editions"), book.edition_id)))).filter(Boolean);
    return { ...shelfSummary(shelf), cover_urls: editions.map((edition) => edition.cover_url).filter(Boolean).slice(0, 4) };
  }));
  return { items };
}

async function createShelf(ctx, payload) {
  const name = text(payload.name, "书架名称", { min: 1, max: 20 });
  const description = payload.description === undefined ? "" : text(payload.description, "书架简介", { max: 100 });
  const count = await ctx.db.collection("bookshelves").where({ owner_id: ctx.userId, deleted_at: null }).count();
  if (count.total >= 50) throw new AppError("BOOKSHELF_LIMIT", "每个绘本馆最多创建 50 个书架");
  const id = randomId("shelf");
  const shelf = {
    _id: id,
    owner_id: ctx.userId,
    name,
    description,
    sort_order: count.total,
    book_count: 0,
    created_at: ctx.now(),
    updated_at: ctx.now(),
    deleted_at: null
  };
  await ctx.db.runTransaction(async (transaction) => {
    const user = (await transaction.collection("users").doc(ctx.userId).get()).data;
    const shelfCount = Number.isInteger(user.bookshelf_count) ? user.bookshelf_count : count.total;
    if (shelfCount >= 50) throw new AppError("BOOKSHELF_LIMIT", "每个绘本馆最多创建 50 个书架");
    await transaction.collection("bookshelves").doc(id).set({ data: documentData(shelf) });
    await transaction.collection("users").doc(ctx.userId).update({
      data: { bookshelf_count: shelfCount + 1, updated_at: ctx.now() }
    });
  });
  return { bookshelf: shelfSummary(shelf) };
}

async function updateShelf(ctx, payload) {
  const id = text(payload.bookshelf_id, "bookshelf_id", { min: 1, max: 100 });
  const shelf = await ownedShelf(ctx, id);
  rejectUnknownFields(payload.patch, ["name", "description"], "payload.patch");
  const patch = {};
  if (payload.patch.name !== undefined) patch.name = text(payload.patch.name, "书架名称", { min: 1, max: 20 });
  if (payload.patch.description !== undefined) patch.description = text(payload.patch.description, "书架简介", { max: 100 });
  if (!Object.keys(patch).length) throw new AppError("INVALID_ARGUMENT", "没有可更新的字段");
  await ctx.db.collection("bookshelves").doc(id).update({ data: { ...patch, updated_at: ctx.now() } });
  return { bookshelf: shelfSummary({ ...shelf, ...patch }) };
}

async function deleteShelf(ctx, payload) {
  const id = text(payload.bookshelf_id, "bookshelf_id", { min: 1, max: 100 });
  if (payload.confirm !== true) throw new AppError("CONFIRMATION_REQUIRED", "删除书架需要确认");
  await ownedShelf(ctx, id);
  await drainBatches(
    () => queryAll(ctx.db.collection("bookshelf_books").where({ owner_id: ctx.userId, bookshelf_id: id }), 100),
    (relation) => ctx.db.collection("bookshelf_books").doc(relation._id).remove(),
    500
  );
  await ctx.db.runTransaction(async (transaction) => {
    const user = (await transaction.collection("users").doc(ctx.userId).get()).data;
    await transaction.collection("bookshelves").doc(id).update({ data: { deleted_at: ctx.now(), book_count: 0, updated_at: ctx.now() } });
    await transaction.collection("users").doc(ctx.userId).update({
      data: { bookshelf_count: Math.max(0, Number(user.bookshelf_count || 1) - 1), updated_at: ctx.now() }
    });
  });
  return { deleted: true, bookshelf_id: id };
}

function validateOrderItems(items, idKey) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw new AppError("INVALID_ARGUMENT", "排序项数量应为 1–50");
  return items.map((item) => {
    rejectUnknownFields(item, [idKey, "sort_order"], "payload.items[]");
    return { id: text(item[idKey], idKey, { min: 1, max: 100 }), sort: integer(item.sort_order, "sort_order", -1000000, 1000000) };
  });
}

async function reorderShelves(ctx, payload) {
  const items = validateOrderItems(payload.items, "bookshelf_id");
  for (const item of items) await ownedShelf(ctx, item.id);
  await ctx.db.runTransaction(async (transaction) => {
    for (const item of items) await transaction.collection("bookshelves").doc(item.id).update({ data: { sort_order: item.sort, updated_at: ctx.now() } });
  });
  return { updated_count: items.length };
}

async function listShelfBooks(ctx, payload) {
  const shelfId = text(payload.bookshelf_id, "bookshelf_id", { min: 1, max: 100 });
  await ownedShelf(ctx, shelfId);
  const limit = payload.limit === undefined ? 24 : integer(payload.limit, "limit", 1, 50);
  const binding = { action: "listShelfBooks", owner: ctx.userId, filter: shelfId };
  const position = payload.cursor ? decodeCursor(payload.cursor, binding) : null;
  const condition = { owner_id: ctx.userId, bookshelf_id: shelfId };
  const whereCondition = position
    ? ctx.command.and([
      condition,
      ctx.command.or([
        { sort_order: ctx.command.gt(position.value) },
        { sort_order: position.value, _id: ctx.command.gt(position.id) }
      ])
    ])
    : condition;
  const relations = await queryAll(ctx.db.collection("bookshelf_books").where(whereCondition).orderBy("sort_order", "asc").orderBy("_id", "asc"), limit + 1);
  const hasMore = relations.length > limit;
  const page = relations.slice(0, limit);
  const books = (await Promise.all(page.map((row) => ownedBook(ctx, row.user_book_id)))).filter(Boolean);
  const editions = await Promise.all(books.map((book) => getById(ctx.db.collection("book_editions"), book.edition_id)));
  const last = page[page.length - 1];
  return {
    items: books.map((book, index) => userBookSummary(book, editions[index], 1)),
    next_cursor: hasMore && last ? encodeCursor({ value: last.sort_order || 0, id: last._id }, binding) : null,
    has_more: hasMore
  };
}

async function addBooks(ctx, payload) {
  const shelfId = text(payload.bookshelf_id, "bookshelf_id", { min: 1, max: 100 });
  await ownedShelf(ctx, shelfId);
  const ids = stringArray(payload.user_book_ids, "user_book_ids");
  for (const id of ids) await ownedBook(ctx, id);
  let added = 0;
  let present = 0;
  await ctx.db.runTransaction(async (transaction) => {
    const currentShelf = (await transaction.collection("bookshelves").doc(shelfId).get()).data;
    for (let index = 0; index < ids.length; index += 1) {
      const id = deterministicId("bookshelf_book", [shelfId, ids[index]]);
      let existing = null;
      try { existing = (await transaction.collection("bookshelf_books").doc(id).get()).data; } catch (_) {}
      if (existing) {
        present += 1;
      } else {
        if ((currentShelf.book_count || 0) + added >= 500) {
          throw new AppError("BOOKSHELF_BOOK_LIMIT", "每个书架最多加入 500 本不同绘本");
        }
        await transaction.collection("bookshelf_books").doc(id).set({
          data: { owner_id: ctx.userId, bookshelf_id: shelfId, user_book_id: ids[index], sort_order: (currentShelf.book_count || 0) + added, created_at: ctx.now() }
        });
        added += 1;
      }
    }
    if (added) await transaction.collection("bookshelves").doc(shelfId).update({ data: { book_count: (currentShelf.book_count || 0) + added, updated_at: ctx.now() } });
  });
  return { added_count: added, already_present_count: present };
}

async function removeBooks(ctx, payload) {
  const shelfId = text(payload.bookshelf_id, "bookshelf_id", { min: 1, max: 100 });
  await ownedShelf(ctx, shelfId);
  const ids = stringArray(payload.user_book_ids, "user_book_ids");
  let removed = 0;
  await ctx.db.runTransaction(async (transaction) => {
    const currentShelf = (await transaction.collection("bookshelves").doc(shelfId).get()).data;
    for (const bookId of ids) {
      const id = deterministicId("bookshelf_book", [shelfId, bookId]);
      let existing = null;
      try { existing = (await transaction.collection("bookshelf_books").doc(id).get()).data; } catch (_) {}
      if (existing && existing.owner_id === ctx.userId) {
        await transaction.collection("bookshelf_books").doc(id).remove();
        removed += 1;
      }
    }
    if (removed) await transaction.collection("bookshelves").doc(shelfId).update({ data: { book_count: Math.max(0, (currentShelf.book_count || 0) - removed), updated_at: ctx.now() } });
  });
  return { removed_count: removed };
}

async function reorderBooks(ctx, payload) {
  const shelfId = text(payload.bookshelf_id, "bookshelf_id", { min: 1, max: 100 });
  await ownedShelf(ctx, shelfId);
  const items = validateOrderItems(payload.items, "user_book_id");
  await ctx.db.runTransaction(async (transaction) => {
    for (const item of items) {
      const id = deterministicId("bookshelf_book", [shelfId, item.id]);
      let relation = null;
      try { relation = (await transaction.collection("bookshelf_books").doc(id).get()).data; } catch (_) {}
      if (!relation || relation.owner_id !== ctx.userId) throw new AppError("RELATION_NOT_FOUND", "绘本不在该书架");
      await transaction.collection("bookshelf_books").doc(id).update({ data: { sort_order: item.sort } });
    }
  });
  return { updated_count: items.length };
}

async function pinBooks(ctx, payload) {
  const shelfId = text(payload.bookshelf_id, "bookshelf_id", { min: 1, max: 100 });
  await ownedShelf(ctx, shelfId);
  const inputIds = payload.user_book_ids;
  const ids = stringArray(inputIds, "user_book_ids", 1, 500);
  if (ids.length !== inputIds.length) throw new AppError("INVALID_ARGUMENT", "user_book_ids 不能重复");

  const relations = await queryAllById(ctx, "bookshelf_books", {
    owner_id: ctx.userId,
    bookshelf_id: shelfId
  }, 500);
  const plan = buildPinPlan(relations, ids);

  for (let index = 0; index < plan.updates.length; index += 50) {
    const batch = plan.updates.slice(index, index + 50);
    await ctx.db.runTransaction(async (transaction) => {
      for (const item of batch) {
        await transaction.collection("bookshelf_books").doc(item.relation_id).update({
          data: { sort_order: item.sort_order }
        });
      }
    });
  }
  return { updated_count: plan.updates.length };
}

exports.main = createMain("bookshelfService", {
  listShelves,
  createShelf,
  updateShelf,
  deleteShelf,
  reorderShelves,
  listShelfBooks,
  addBooks,
  removeBooks,
  reorderBooks,
  pinBooks
});
