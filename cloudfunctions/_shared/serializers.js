function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function editionSummary(edition) {
  return {
    edition_id: edition._id,
    isbn13: edition.isbn13 || "",
    title: edition.title || "",
    contributors_text: edition.contributors_text || "",
    publisher: edition.publisher || "",
    cover_file_id: edition.cover_file_id || "",
    cover_status: edition.cover_status || "missing",
    source: edition.source || "",
    audit_status: edition.audit_status || "pending",
    publish_date_text: edition.publish_date_text || "",
    binding_type: edition.binding_type || ""
  };
}

function shelfSummary(shelf) {
  return {
    bookshelf_id: shelf._id,
    name: shelf.name || "",
    description: shelf.description || "",
    sort_order: shelf.sort_order || 0,
    book_count: shelf.book_count || 0,
    cover_file_ids: shelf.cover_file_ids || [],
    updated_at: iso(shelf.updated_at)
  };
}

function userBookSummary(userBook, edition, bookshelfCount = 0) {
  return {
    user_book_id: userBook._id,
    edition: editionSummary(edition),
    quantity: userBook.quantity || 1,
    preference: userBook.preference || "unmarked",
    bookshelf_count: bookshelfCount,
    custom_sort: userBook.custom_sort || 0,
    created_at: iso(userBook.created_at),
    updated_at: iso(userBook.updated_at)
  };
}

function manualSubmissionSummary(submission) {
  if (!submission) return undefined;
  return {
    submission_id: submission._id,
    draft_edition_id: submission.draft_edition_id,
    status: submission.status,
    rejection_reason: submission.rejection_reason || "",
    conflict_edition_id: submission.conflict_edition_id || "",
    submitted_at: iso(submission.submitted_at),
    reviewed_at: iso(submission.reviewed_at)
  };
}

module.exports = { iso, editionSummary, shelfSummary, userBookSummary, manualSubmissionSummary };
