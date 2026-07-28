# 001 回滚说明

该迁移只写入 `system_config/isbn_provider` 与 `schema_migrations/001`，不会删除业务数据。

回滚时先停止小程序发布和 ISBN 定时任务，备份两个文档，再在云开发控制台删除 `system_config/isbn_provider`，最后把 `schema_migrations/001.status` 标记为 `rolled_back`。索引回滚必须按 `database/indexes.json` 逐项删除本版本新增索引；禁止删除集合。
