# 书芽芽｜家庭数字绘本馆 V1-Core

原生微信小程序 + 微信云开发实现。当前只包含核心建馆版：首次建馆、ISBN 录入与缓存、连续扫码、手工审核、家庭藏书、书架、资料、指标、反馈和管理员审核。仓库中没有分享页面、分享云函数或 `share_*` 集合。

当前 `project.config.json` 使用 `touristappid`，`miniprogram/config/env.js` 的云环境 ID 为空。它们是安全占位，不可直接用于发布。

## 本地检查

要求 Node.js 18 或更新版本。

```powershell
npm test
npm run check
npm run build:cloud
npm run check:cloud-build
```

测试不会调用阿里云付费 ISBN 接口。`build:cloud` 会把共享代码复制到每个云函数的 `_shared/` 内，并输出到 `dist/cloudfunctions/`，使七个云函数可以独立部署。云函数依赖固定为 `wx-server-sdk@4.0.2`；更新模板锁文件后执行 `npm run lock:cloud` 同步七个独立锁文件。

## 导入微信开发者工具

1. 在微信公众平台创建或选择小程序，取得真实 AppID。
2. 用微信开发者工具导入仓库根目录，把 `project.config.json` 的 `appid` 从 `touristappid` 改为真实 AppID。
3. 在云开发控制台分别创建 development 和 production 环境。
4. 把环境 ID 填入 `miniprogram/config/env.js`；提交前确认当前环境与发布目标一致。
5. 创建 `database/collections.md` 列出的集合，按 `database/indexes.json` 创建索引。
6. 将 `database/security-rules.json` 对应的“客户端默认拒绝”规则配置到所有集合。小程序端不得直接访问数据库。
7. 执行 `database/migrations/001-initial.js` 的 `up` 逻辑，确认 `schema_migrations/001.status` 为 `completed`。

## 云函数环境变量

在每个需要的云函数配置中设置变量，不要写入前端、仓库、构建产物或日志：

| 变量 | 使用方 | 说明 |
| --- | --- | --- |
| `USER_ID_SECRET` | 所有业务云函数 | 用 OpenID 生成环境独立 HMAC 用户 ID；development/production 必须不同 |
| `CURSOR_SECRET` | 分页服务 | 签名游标；可与 USER_ID_SECRET 分开轮换 |
| `IDEMPOTENCY_SECRET` | 写操作服务 | AES-GCM 加密幂等回放结果；未设置时回退到 `USER_ID_SECRET` |
| `ALIYUN_ISBN_APPCODE` | `bookService` | 阿里云市场 ISBN 服务 AppCode |
| `ALIYUN_ISBN_ENDPOINT` | `bookService` | 固定为 `https://jmisbn.market.alicloudapi.com/isbn/query` |
| `ISBN_PROVIDER_TIMEOUT_MS` | `bookService` | 单次供应商请求超时，默认 `5000` |
| `COVER_SOURCE_HOST_ALLOWLIST` | `bookService`、`adminService` | 允许转存封面的来源域名，逗号分隔；必须根据真实响应配置 |
| `COVER_MAX_BYTES` | `bookService`、`adminService` | 封面字节上限，默认且最高 `5242880` |
| `ISBN_USER_DAILY_LIMIT` | `bookService` | 用户日回源上限；系统配置默认 `100` |
| `ISBN_GLOBAL_DAILY_LIMIT` | `bookService` | 系统日回源上限；系统配置默认 `3000` |
| `ISBN_GLOBAL_MONTHLY_LIMIT` | `bookService` | 系统月回源上限；系统配置默认 `50000` |

阿里云 AppCode 只能配置在 `bookService` 云函数环境变量中。接口使用 `POST application/x-www-form-urlencoded`，请求体为 `isbn=13位纯数字`，业务成功严格以 `code === 200` 且 `data.details[0]` 存在为准；供应商响应只经白名单标准化后落库。

系统日/月额度耗尽时会把 `system_config/isbn_provider.circuit_open_until` 置为长期打开状态，阻止继续产生付费调用。管理员确认额度恢复后，需在云数据库控制台同时把 `quota_exceeded` 改为 `false`、`circuit_open_until` 改为 `null`；不得只在前端绕过提示。

依赖审计说明：2026-07-28 对官方当前版 `wx-server-sdk@4.0.2` 执行 `npm audit --omit=dev`，其传递依赖报告 1 个 moderate、5 个 high（主要来自旧版 axios 与 lodash 路径工具），npm 没有提供不降级 SDK 的自动修复。代码已对所有客户端输入做白名单校验，外部封面下载也不使用该 axios 链路，但正式发布前仍需复查腾讯官方更新或完成风险接受；禁止直接执行 `npm audit fix --force`。

## 构建与部署

1. 执行 `npm run build:cloud`。
2. 在微信开发者工具将云函数根目录指向 `dist/cloudfunctions/`。
3. 依次上传并部署 `userService`、`bookService`、`libraryService`、`bookshelfService`、`eventService`、`adminService`、`maintenanceService`，选择“云端安装依赖”。
4. 按开发文档配置超时与内存：普通服务 10–20 秒、256–512 MB；`maintenanceService` 60 秒、512 MB。
5. 检查七个函数的 `USER_ID_SECRET` 一致，production 与 development 不得共用。

## 定时触发器

`maintenanceService` 禁止小程序客户端调用。建议创建以下定时触发器，事件体使用对应 `task`：

| 任务 | 建议频率 | 事件体 |
| --- | --- | --- |
| 清理查询缓存 | 每小时 | `{"task":"cleanupLookupCache"}` |
| 清理临时数据 | 每日 | `{"task":"cleanupEphemeralData"}` |
| 处理账号注销 | 每 30 分钟 | `{"task":"processDeletionJobs"}` |
| 校正书架计数 | 每日 | `{"task":"reconcileCounts"}` |
| 检查 ISBN 额度 | 每小时 | `{"task":"checkProviderQuota"}` |

## 发布前验收

必须在微信开发者工具和至少一台 iOS、一台 Android 真机完成：

- 14 个正式路由可以编译打开，没有分享路由。
- 首次建馆强制孩子昵称、出生年月、性别。
- ISBN 首次回源、二次缓存命中、付费额度和熔断提示正确。
- 20 个相同 ISBN 并发请求最多一次供应商调用。
- 连续扫码的新书、重复、失败、跳过、结束汇总完整。
- 缓存书库搜索无结果时只展示空状态，不回源。
- 手工录入展示 1–3 天时限，驳回原因可见且可修改重提。
- 管理员可处理 ISBN 冲突，馆藏与书架关系迁移后数量正确。
- 320、375、430px 下按 `docs/ui-skill-visual-review.md` 截图复查。
- 账号停用、注销、24 小时内清理和重新建馆流程通过。

当前机器未发现微信开发者工具 CLI，因此仓库只能完成自动检查，不能代替最终编译、云端联调和截图真机验收。

## 备份、恢复与回滚

发布前导出全部集合、数据库索引、安全规则和上一版 `dist/cloudfunctions/`。数据库备份应加密保存，并至少每月在隔离环境验证一次恢复。

恢复顺序：

1. 暂停小程序发布、ISBN 回源和全部定时触发器。
2. 恢复与目标代码版本匹配的数据库快照。
3. 按 `database/indexes.json` 恢复索引和拒绝客户端访问的安全规则。
4. 部署对应版本的七个云函数，再发布匹配的小程序版本。
5. 在 development 验证确定性 ID、书架计数、审核关联和账号状态后恢复流量。

代码回滚使用微信后台上一版本与上一组云函数构建产物。数据迁移回滚按 `database/migrations/001-rollback.md` 执行；不可逆变更不得在没有备份和补偿脚本时上线。

## 上线前仍需产品方提供

真实 AppID、云环境、阿里云接口购买凭证与 AppCode、封面与元数据缓存授权、用户协议、隐私保护指引、小程序主体/类目/备案信息。缺少任一项时不可宣称可以正式上线。
