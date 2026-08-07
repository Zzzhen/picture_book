# 七牛封面 CDN 与绘本馆首屏性能优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将公共 ISBN 封面直接存储并通过七牛 CDN 访问，同时减少绘本馆首屏的逐本网络和数据库请求。

**Architecture:** 云函数继续负责封面安全下载与校验，校验通过后上传七牛并把 `cover_url` 写入 `book_editions`；前端优先使用 `cover_url`，不再为每本书调用临时文件 URL。`libraryService.listBooks` 通过一次关系查询汇总当前页书架数量，不再逐本 `count()`。

**Tech Stack:** 微信云函数 Node.js 18、七牛 Kodo HTTP/Node SDK、微信小程序原生 API、Node `node:test`。

---

### Task 1: 固化七牛封面 URL 数据契约

**Files:**
- Modify: `cloudfunctions/_shared/serializers.js`
- Modify: `cloudfunctions/bookService/index.js`
- Modify: `cloudfunctions/adminService/index.js`
- Test: `tests/qiniu-cover.test.js`

- [ ] 先测试 `editionSummary` 暴露 `cover_url`，并验证缺失配置不会生成伪 URL。
- [ ] 增加 `cover_url` 字段；provider/管理员封面写入七牛 URL，状态为 `ready`。
- [ ] 保留 `cover_file_id` 仅用于手工上传兼容，不再作为公共 ISBN 封面来源。

### Task 2: 七牛安全上传与 URL 生成

**Files:**
- Create: `cloudfunctions/_shared/qiniu-cover.js`
- Modify: `cloudfunctions/_shared/cover-transfer.js`
- Modify: `cloudfunctions/bookService/package.json`
- Modify: `cloudfunctions/adminService/package.json`
- Test: `tests/qiniu-cover.test.js`

- [ ] 测试对象 key、HTTPS 公共 URL、区域上传配置和缺失环境变量。
- [ ] 使用服务端七牛 SDK 上传已通过现有图片安全校验的 Buffer，key 固定为 `QINIU_KEY_PREFIX + editionId + extension`。
- [ ] 只记录 URL、key 和错误代码，不记录 AK/SK。
- [ ] `transferCover` 返回 `cover_url`；上传失败返回 `failed`，不阻塞 ISBN 主数据落库。

### Task 3: 前端直接使用 CDN URL

**Files:**
- Modify: `miniprogram/pages/library/index.js`
- Modify: all page mappers using `cover_file_id`
- Test: `tests/frontend-behavior.test.js`

- [ ] 测试绘本馆映射不再调用 `getTempFileURL`，直接使用 `edition.cover_url`。
- [ ] 页面、书架、确认、详情和管理列表统一优先读取 `cover_url`。
- [ ] CDN URL 为空时显示现有空封面状态。

### Task 4: 批量汇总书架关系数量

**Files:**
- Modify: `cloudfunctions/libraryService/index.js`
- Test: `tests/cloud-contracts.test.js`

- [ ] 测试 `listBooks` 的当前页关系统计通过一次批量查询汇总，不再执行每书 `count()`。
- [ ] 对最多 50 个当前页 user book ID 分块查询 `bookshelf_books`，内存聚合后传给序列化器。
- [ ] 保持返回字段和排序、游标行为不变。

### Task 5: 文档、配置和验证

**Files:**
- Modify: `README.md`
- Modify: `database/database-security-rules.md`
- Modify: `家庭数字绘本馆 V1.md`

- [ ] 记录七牛环境变量、HTTPS CDN 域名、公开读与 `edition-covers/` 前缀要求。
- [ ] 运行针对性测试、全量测试、项目检查、云函数构建和 `git diff --check`。
- [ ] 在微信开发者工具真机验证封面 URL、首屏网络请求数量和新 ISBN 查询。
