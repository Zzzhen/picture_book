# 数据库集合

V1-Core 使用以下集合：

`users`、`children`、`book_editions`、`manual_book_submissions`、`isbn_lookup_cache`、`user_books`、`bookshelves`、`bookshelf_books`、`events`、`feedback`、`audit_logs`、`system_config`、`schema_migrations`、`rate_limits`、`idempotency_keys`、`deletion_jobs`。

全部私人文档带 `owner_id`；业务时间使用服务端时间；个人数据使用 `deleted_at` 软删除。`book_editions` 的 ISBN 版本 ID 为 `isbn_{isbn13}`，藏书和书架关系使用确定性 SHA-256 ID。

分享功能使用 `shelf_shares` 保存不可猜测的短期分享令牌；令牌只允许公开读取对应书架的最新书籍，不保存书籍快照。
