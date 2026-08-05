const read = (fields) => ({ fields, write: false });
const write = (fields) => ({ fields, write: true });

module.exports = {
  userService: {
    bootstrap: read([]),
    getProfile: read([]),
    completeOnboarding: write(["library_name", "child", "nickname", "avatar_file_id", "mother_age_range", "city"]),
    updateProfile: write(["user", "child"]),
    cancelAccount: write(["confirm_text"]),
    restartDeletedAccount: write(["confirm", "library_name", "child"])
  },
  bookService: {
    lookupByIsbn: read(["isbn", "scan_session_id"]),
    getLookupStatus: read(["isbn"]),
    searchCachedBooks: read(["query", "cursor", "limit"]),
    getEditionDetail: read(["edition_id"]),
    createManualBook: write(["title", "contributors_text", "publisher", "isbn", "binding_type", "cover_file_id"]),
    updateManualSubmission: write(["submission_id", "patch"]),
    resubmitManualBook: write(["submission_id"])
  },
  libraryService: {
    listBooks: read(["query", "preference", "bookshelf_id", "cover", "sort", "cursor", "limit"]),
    addBook: write(["edition_id", "quantity_delta", "scan_session_id"]),
    getUserBook: read(["user_book_id"]),
    updateBook: write(["user_book_id", "patch"]),
    removeBook: write(["user_book_id", "confirm"]),
    batchUpdate: write(["user_book_ids", "operation", "value", "confirm"])
  },
  bookshelfService: {
    listShelves: read([]),
    createShelf: write(["name", "description"]),
    updateShelf: write(["bookshelf_id", "patch"]),
    deleteShelf: write(["bookshelf_id", "confirm"]),
    reorderShelves: write(["items"]),
    listShelfBooks: read(["bookshelf_id", "cursor", "limit"]),
    addBooks: write(["bookshelf_id", "user_book_ids"]),
    removeBooks: write(["bookshelf_id", "user_book_ids"]),
    reorderBooks: write(["bookshelf_id", "items"]),
    pinBooks: write(["bookshelf_id", "user_book_ids"])
  },
  eventService: {
    trackBatch: write(["events"])
  },
  adminService: {
    dashboard: read(["date_from", "date_to"]),
    listUsers: read(["status", "query", "cursor", "limit"]),
    setUserStatus: write(["user_id", "status", "reason"]),
    listPendingBooks: read(["status", "conflict_only", "cursor", "limit"]),
    reviewManualBook: write(["submission_id", "decision", "rejection_reason", "approved_fields"]),
    updateEdition: write(["edition_id", "patch", "reason"]),
    retryCoverTransfer: write(["edition_id"])
  },
  maintenanceService: {}
};
