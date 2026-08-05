# 书架资料编辑与批量管理实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task by task.

**Goal:** 将书架资料编辑、添加绘本和书架内批量管理拆成独立流程，并实现最多 500 本的全选、移出与书架内置顶。

**Architecture:** 继续以 `bookshelf_books` 作为书架与馆藏的关系表，复用 `sort_order` 实现书架内排序。前端详情页负责选择状态，独立 picker 页面负责添加，编辑页只保存元数据。云函数新增 `pinBooks`，服务端根据当前稳定顺序计算置顶值，不修改 `user_books.custom_sort`。

**Tech Stack:** 原生微信小程序 WXML/WXSS/JavaScript、微信云开发、Node.js、`node:test`。

---

## Task 1：为书架置顶建立失败测试和纯排序算法

**Files:**

- Modify: `tests/backend-core.test.js`
- Create: `cloudfunctions/_shared/bookshelf-order.js`

**Step 1: 写失败测试**

增加纯函数测试，覆盖：

- 单本置顶。
- 多本保持原有相对顺序。
- 客户端 ID 顺序不能改变服务端当前顺序。
- 重复 ID 和不存在关系被拒绝。
- 接近排序下界时返回归一化更新。

**Step 2: 验证测试失败**

Run: `node --test tests/backend-core.test.js`

Expected: 因 `bookshelf-order.js` 不存在或导出缺失而失败。

**Step 3: 实现最小排序算法**

实现 `buildPinPlan(relations, selectedIds)`，返回需要更新的关系及是否执行归一化。排序基准固定为 `sort_order ASC, _id ASC`。

**Step 4: 验证测试通过**

Run: `node --test tests/backend-core.test.js`

Expected: PASS。

## Task 2：新增 `pinBooks` 云函数契约与服务实现

**Files:**

- Modify: `tests/service-contracts.test.js`
- Modify: `tests/integration-guards.test.js`
- Modify: `cloudfunctions/_shared/contracts.js`
- Modify: `cloudfunctions/bookshelfService/index.js`

**Step 1: 写失败契约测试**

- 期望 action 清单包含 `pinBooks`。
- 期望 `pinBooks` 为写操作。
- 期望服务只更新 `bookshelf_books.sort_order`，不引用 `user_books.custom_sort`。
- 期望校验 1–500 个去重 ID、书架所有权和关系存在性。

**Step 2: 验证测试失败**

Run: `node --test tests/service-contracts.test.js tests/integration-guards.test.js`

Expected: 缺少 `pinBooks` 而失败。

**Step 3: 实现服务**

- 注册 `pinBooks: write(["bookshelf_id", "user_book_ids"])`。
- 查询当前书架全部关系，最多 500 条。
- 在任何写入前完成所有关系校验。
- 使用 `buildPinPlan` 计算更新。
- 每批最多 50 条执行事务更新。
- 返回 `updated_count`。

**Step 4: 验证契约通过**

Run: `node --test tests/service-contracts.test.js tests/integration-guards.test.js`

Expected: PASS。

## Task 3：将书架编辑页收敛为资料编辑

**Files:**

- Modify: `tests/frontend-behavior.test.js`
- Modify: `miniprogram/pages/bookshelf-edit/index.js`
- Modify: `miniprogram/pages/bookshelf-edit/index.wxml`
- Modify: `miniprogram/pages/bookshelf-edit/index.wxss`

**Step 1: 写失败页面行为测试**

- 编辑页不得调用 `listBooks`、`listShelfBooks`、`addBooks`、`removeBooks`。
- 页面不得出现搜索、全选或绘本选择列表。
- 保留名称、说明、保存和删除。

**Step 2: 验证测试失败**

Run: `node --test tests/frontend-behavior.test.js`

Expected: 现有编辑页仍包含选书逻辑而失败。

**Step 3: 删除关系编辑逻辑**

- 删除馆藏分页加载、搜索、选择和差异同步函数。
- `save` 只调用 `createShelf` 或 `updateShelf`。
- 保留底部固定保存/删除栏和删除确认。

**Step 4: 验证测试通过**

Run: `node --test tests/frontend-behavior.test.js`

Expected: PASS。

## Task 4：扩展书卡选择态并实现书架详情批量管理

**Files:**

- Modify: `tests/frontend-behavior.test.js`
- Modify: `miniprogram/components/book-card/index.js`
- Modify: `miniprogram/components/book-card/index.wxml`
- Modify: `miniprogram/components/book-card/index.wxss`
- Modify: `miniprogram/pages/bookshelf-detail/index.js`
- Modify: `miniprogram/pages/bookshelf-detail/index.wxml`
- Modify: `miniprogram/pages/bookshelf-detail/index.wxss`

**Step 1: 写失败交互测试**

- 详情页普通状态显示编辑和选择。
- 选择状态包含全选、取消、计数、移出和置顶。
- 加载函数通过游标累计最多 500 本。
- 移出按 50 个 ID 分批。
- 置顶调用 `pinBooks`。
- 选择状态点击书卡不会打开详情。

**Step 2: 验证测试失败**

Run: `node --test tests/frontend-behavior.test.js`

Expected: 缺少选择模式而失败。

**Step 3: 扩展 `book-card`**

- 保留现有 `manage`、`selected` 兼容行为。
- 选择态增加明显描边、遮罩和勾选标记。
- 默认状态视觉和事件不变。

**Step 4: 实现详情状态机**

- 新增 `mode`、`selectedIds`、`allSelected`、`operating` 和确认弹窗状态。
- 通过 `next_cursor` 加载完整书架。
- 实现进入选择、取消、切换单本和全选。
- 普通状态打开详情，选择状态切换选择。
- 实现移出确认与 50 条分批调用。
- 实现 `pinBooks` 调用。
- 成功或失败后重新读取服务端数据。

**Step 5: 实现页面视觉**

- 普通状态右上角显示`编辑｜选择`。
- 选择状态显示选择栏和固定底部操作栏。
- 隐藏添加入口并适配安全区。

**Step 6: 验证测试通过**

Run: `node --test tests/frontend-behavior.test.js`

Expected: PASS。

## Task 5：新增独立添加绘本页面

**Files:**

- Modify: `tests/scaffold.test.js`
- Modify: `tests/frontend-behavior.test.js`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/sitemap.json`
- Create: `miniprogram/pages/bookshelf-book-picker/index.js`
- Create: `miniprogram/pages/bookshelf-book-picker/index.json`
- Create: `miniprogram/pages/bookshelf-book-picker/index.wxml`
- Create: `miniprogram/pages/bookshelf-book-picker/index.wxss`
- Modify: `miniprogram/pages/bookshelf-detail/index.js`
- Modify: `miniprogram/pages/bookshelf-detail/index.wxml`

**Step 1: 写失败路由和行为测试**

- 新页面四个文件必须存在并注册。
- 添加入口必须跳转到 picker，而不是编辑页。
- picker 支持搜索、选择、全选和确认加入。
- 当前书架已有绘本从候选中排除。
- `addBooks` 按每批 50 个 ID 调用。

**Step 2: 验证测试失败**

Run: `node --test tests/scaffold.test.js tests/frontend-behavior.test.js`

Expected: 新路由和文件不存在而失败。

**Step 3: 创建页面与配置**

- 注册新路由和 sitemap 规则。
- 并行加载绘本馆藏书和当前书架关系。
- 映射统一封面字段并过滤已有关系。
- 实现搜索、多选、全选和空状态。
- 实现固定底部加入按钮和分批提交。

**Step 4: 验证测试通过**

Run: `node --test tests/scaffold.test.js tests/frontend-behavior.test.js`

Expected: PASS。

## Task 6：同步产品开发文档和视觉复查记录

**Files:**

- Modify: `家庭数字绘本馆 V1.md`
- Modify: `docs/ui-skill-visual-review.md`

**Step 1: 更新接口和路由文档**

- 第 15 节加入 `pinBooks` action、payload、响应与错误码。
- 正式路由清单加入独立添加绘本页。
- 明确 V1-Core 当前实现边界。

**Step 2: 按 frontend-design 复查**

记录普通、选择、添加、空、搜索空、操作中和错误状态；检查信息层级、真实文案、品牌辨识度、320/375/430px 和底部安全区。

**Step 3: 文档检查**

Run: `git diff --check`

Expected: 无空白错误。

## Task 7：全量验证

**Files:**

- Verify only

**Step 1: JavaScript 语法与项目结构检查**

Run: `npm run check`

Expected: PASS。

**Step 2: 全部自动测试**

Run: `npm test`

Expected: 全部通过，0 failures。

**Step 3: 云函数独立打包检查**

Run: `npm run build:cloud`

Run: `npm run check:cloud-build`

Expected: 所有云函数可独立打包且共享模块完整。

**Step 4: 变更检查**

Run: `git diff --check`

Expected: 无错误。

**Step 5: 人工验收提醒**

在微信开发者工具中验证 320、375、430px，重点检查底部安全区、批量选择、500 本分页和云端真实排序。自动化验证不能替代真机验收。

