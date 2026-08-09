const { loadSdk, getById, queryAll, createContext, loadCurrentUser, runIdempotent, documentData } = require("../_shared/cloud");
const { AppError } = require("../_shared/errors");
const { handle } = require("../_shared/response");
const { validateEnvelope, text } = require("../_shared/schema");
const { randomId } = require("../_shared/identity");
const { shelfSummary, iso } = require("../_shared/serializers");
const contracts = require("../_shared/contracts");

async function ownedShelf(ctx, bookshelfId) {
  const shelf = await getById(ctx.db.collection("bookshelves"), bookshelfId);
  if (!shelf || shelf.deleted_at) throw new AppError("BOOKSHELF_NOT_FOUND", "书架不存在或已删除");
  if (shelf.owner_id !== ctx.userId) throw new AppError("FORBIDDEN", "不能分享他人的书架");
  return shelf;
}

async function createShare(ctx, payload) {
  const bookshelfId = text(payload.bookshelf_id, "bookshelf_id", { min: 1, max: 100 });
  const reason = payload.reason === undefined ? "" : text(payload.reason, "reason", { max: 80 });
  const shelf = await ownedShelf(ctx, bookshelfId);
  const existing = (await queryAll(
    ctx.db.collection("shelf_shares").where({ owner_id: ctx.userId, bookshelf_id: bookshelfId }),
    100
  )).filter((item) => item.status === "active").sort((left, right) => dateMillis(right.created_at) - dateMillis(left.created_at));
  if (existing[0] && existing[0].expires_at && dateMillis(existing[0].expires_at) > Date.now()) {
    if ((existing[0].share_reason || "") !== reason) {
      await ctx.db.collection("shelf_shares").doc(existing[0]._id).update({ data: { share_reason: reason, updated_at: ctx.now() } });
    }
    return { share_id: existing[0]._id, token: existing[0].share_token, reason, bookshelf: shelfSummary(shelf), expires_at: iso(existing[0].expires_at) };
  }
  const id = randomId("share");
  const token = randomId("token");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const share = {
    _id: id,
    share_token: token,
    owner_id: ctx.userId,
    bookshelf_id: bookshelfId,
    status: "active",
    share_reason: reason,
    created_at: ctx.now(),
    updated_at: ctx.now(),
    expires_at: expiresAt
  };
  await ctx.db.collection("shelf_shares").doc(id).set({ data: documentData(share) });
  return { share_id: id, token, reason, bookshelf: shelfSummary(shelf), expires_at: expiresAt.toISOString() };
}

function dateMillis(value) {
  const date = value && typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return date.getTime();
}

function sharedBookSummary(book, edition) {
  return {
    user_book_id: book._id,
    edition: {
      isbn13: edition.isbn13 || "",
      title: edition.title || "",
      contributors_text: edition.contributors_text || "",
      publisher: edition.publisher || "",
      cover_url: edition.cover_url || "",
      cover_status: edition.cover_status || "missing",
      publish_date_text: edition.publish_date_text || "",
      binding_type: edition.binding_type || "",
      price_text: edition.price_text || "",
      page_count_text: edition.page_count_text || ""
    },
    quantity: book.quantity || 1
  };
}

function publicContext() {
  const cloud = loadSdk();
  const db = cloud.database();
  return { cloud, db, command: db.command, getById, queryAll };
}

async function getSharedShelf(payload) {
  const token = text(payload.token, "token", { min: 10, max: 200 });
  const ctx = publicContext();
  const shares = await queryAll(ctx.db.collection("shelf_shares").where({ share_token: token }), 10);
  const share = shares.find((item) => item.status === "active");
  if (!share || (share.expires_at && dateMillis(share.expires_at) <= Date.now())) {
    throw new AppError("SHARE_NOT_FOUND", "分享链接不存在或已失效");
  }
  const shelf = await getById(ctx.db.collection("bookshelves"), share.bookshelf_id);
  if (!shelf || shelf.deleted_at) throw new AppError("SHARE_NOT_FOUND", "分享的书架已删除");
  const relations = await queryAll(
    ctx.db.collection("bookshelf_books").where({ owner_id: share.owner_id, bookshelf_id: share.bookshelf_id }).orderBy("sort_order", "asc").orderBy("_id", "asc"),
    500
  );
  const books = (await Promise.all(relations.map((row) => getById(ctx.db.collection("user_books"), row.user_book_id)))).filter(Boolean);
  const editions = await Promise.all(books.map((book) => getById(ctx.db.collection("book_editions"), book.edition_id)));
  return {
    share: { share_id: share._id, reason: share.share_reason || "", expires_at: iso(share.expires_at) },
    bookshelf: shelfSummary(shelf),
    books: books.map((book, index) => editions[index] ? sharedBookSummary(book, editions[index]) : null).filter(Boolean)
  };
}

exports.main = async (event) => handle(event, async () => {
  const envelope = validateEnvelope(event, contracts.shareService, { platformFields: ["tcbContext", "userInfo"] });
  if (envelope.action === "getSharedShelf") return getSharedShelf(envelope.payload);
  const ctx = await createContext("shareService");
  ctx.requestId = envelope.requestId;
  ctx.user = await loadCurrentUser(ctx, { statuses: ["active"] });
  return runIdempotent(ctx, envelope.action, envelope.requestId, () => createShare(ctx, envelope.payload));
});
