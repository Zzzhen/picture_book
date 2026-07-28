# 家庭数字绘本馆 UI 与 Figma 设计规范

> 设计状态：核心建馆版规格已完成，待产品方最终复核  
> 当前设计版本：`V1-Core`  
> 下一阶段：`V1-Share`，只保留页面清单、流程和设计边界  
> 产品载体：微信小程序  
> 视觉方向：A · 家藏书票  
> Figma 基准画板：`375 × 812`  
> 对应研发规格：`家庭数字绘本馆 V1.md`  
> 最后更新：2026-07-28

---

## 1. 文档用途

本文档同时服务于：

1. Figma MCP：创建变量、组件、页面、状态和原型连线。
2. UI 设计师：检查视觉层级、交互一致性和品牌表达。
3. 编码 AI：把 Figma 结构映射为微信小程序 WXML、WXSS 和组件。
4. 验收人员：依据页面 ID、组件 ID、状态矩阵和视觉检查项验收。

本文件是设计唯一依据。研发文档负责业务与接口；两份文档冲突时，业务和安全规则以研发文档为准，视觉和页面结构以本文件为准。

---

## 2. Figma MCP 执行指令

### 2.1 强制执行顺序

Figma MCP 必须完整读取本文档后按以下顺序创建：

```text
00-Cover
→ 01-Foundations
→ 02-Components
→ 10-Core-Flows
→ 20-Share-Roadmap
→ 检查变量绑定、组件实例、Auto Layout 和原型连线
```

禁止：

- 在 Foundations 和 Components 完成前直接创建高保真页面。
- 在页面中使用未定义的近似颜色、字号、圆角或阴影。
- 把按钮、输入框、图书卡片画成不可复用的散装图层。
- 把 `V1-Share` 路线图画成可交付高保真页面。
- 使用 Lorem Ipsum、`标题文字`、`Button` 等无意义占位文案。
- 使用未经授权的真实绘本封面；设计稿使用抽象示意封面，运行时再显示供应商或用户合法上传的封面。

### 2.2 Figma 页面结构

| Figma Page | 内容 | 当前是否完整制作 |
| --- | --- | --- |
| `00-Cover` | 项目说明、版本范围、视觉方向、更新时间 | 是 |
| `01-Foundations` | 色彩、字体、间距、栅格、圆角、阴影、图标、动效 | 是 |
| `02-Components` | 全部组件与 Variant | 是 |
| `10-Core-Flows` | `V1-Core` 页面和原型 | 是 |
| `20-Share-Roadmap` | 下一阶段流程图、页面清单和边界说明 | 只做路线图 |

### 2.3 命名规则

```text
变量：Color/Brand/Forest
文字样式：Type/Body/Regular
组件：C/Button
组件变体：C/Button[type=primary,state=default,size=large]
页面 Frame：P03-Library-Grid-Default
页面区块：S/LibraryHeader
图层：语义英文名，例如 title、searchBar、bookGrid
流程连接：Flow/Core/ContinuousScan
```

图层名不得使用 `Frame 123`、`Group 8`、`Rectangle 4`。

---

## 3. 设计依据与取舍

### 3.1 已采用的外部设计原则

- [Anthropic Frontend Design Skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design)：视觉选择必须来自具体主题；使用真实内容；只设置一个有理由的品牌记忆点；空状态和错误状态必须指导下一步。
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)：清晰的信息层级、足够点击面积、可读文字、适应不同屏幕和辅助功能。

这些原则只用于设计判断，不改变微信小程序的技术限制、系统扫码界面和微信胶囊按钮安全区。

### 3.2 主题与单一任务

- 主题：一个家庭认真整理、逐步积累的儿童绘本收藏。
- 核心用户：家中有几十到数百本绘本的家长。
- 当前版本单一任务：让用户轻松把已有绘本录入并整理成值得欣赏的数字绘本馆。

### 3.3 视觉方向：A · 家藏书票

关键词：

- 温暖。
- 安静。
- 有家庭收藏感。
- 像一本被认真整理的阅读档案。
- 清晰、克制，不幼稚。

视觉表达：

- 暖纸背景承接实体书触感。
- 森林绿表达长期收藏和可靠感。
- 陶土色用于少量情绪与重点提示。
- 绘本封面是页面最强视觉内容。
- 不使用高饱和儿童拼色、霓虹渐变、紫粉 AI 渐变或通用后台卡片堆叠。

### 3.4 唯一品牌记忆点：家庭藏书票

`C/BookplateMark` 是唯一允许明显带有品牌装饰性的组件：

- 形态：圆角方形或圆形藏书章，内含简化书脊和“藏”字。
- 使用位置：封面页、首次建馆完成、绘本馆标题区、空绘本馆。
- 禁止位置：每一本封面、每个按钮、每个列表项。
- 每个页面最多出现一次；其余界面保持安静。

---

## 4. 画板、栅格与安全区

### 4.1 画板

| 用途 | 尺寸 | 说明 |
| --- | --- | --- |
| 主设计画板 | `375 × 812` | Figma 单位按移动端 point 使用；基准上约 `1px = 2rpx` |
| 小屏检查 | `320 × 568` | 检查折行、双列网格和键盘遮挡 |
| 大屏检查 | `430 × 932` | 检查最大内容宽度和留白 |

### 4.2 安全区

- Figma 顶部示意：状态区 `44px`，导航区 `44px`。
- 实际小程序不得硬编码顶部高度，使用微信窗口信息和胶囊位置信息计算。
- 顶部导航内容不能进入微信胶囊按钮占用区域。
- 底部 Tab 内容高 `50px`，额外保留设备底部安全区。
- Bottom Sheet 底部内边距为 `max(24px, safe-area-inset-bottom)`。

### 4.3 页面栅格

- 页面左右内边距：`16px`。
- 4 列布局栅格；列间距 `12px`。
- 主内容最大宽度：`430px`，更宽设备保持居中。
- 垂直节奏基于 `4px`。
- 区块间距：`24px`。
- 卡片内部间距：`16px`。

### 4.4 图书网格

```text
屏幕内容宽度 < 328px：2 列，间距 12px
屏幕内容宽度 ≥ 328px：3 列，间距 12px
```

- 封面展示框比例 `3:4`。
- 图片使用 `aspectFit`，背景为 `Color/Surface/CoverMat`。
- 不裁掉封面标题、作者或出版社信息。
- 书名最多两行；大字体模式允许三行并降低列数。

---

## 5. Foundations

### 5.1 Color Variables

Figma 变量集合命名为 `Library/Color`。

| Variable | Light | 用途 |
| --- | --- | --- |
| `Color/Background/Paper` | `#F7F3EA` | 页面主背景 |
| `Color/Surface/Primary` | `#FFFEFB` | 卡片、输入框、弹层 |
| `Color/Surface/Secondary` | `#EEE7DB` | 次级分区、筛选背景 |
| `Color/Surface/CoverMat` | `#E6E0D5` | `aspectFit` 封面衬底 |
| `Color/Brand/Forest` | `#315A45` | 主按钮、选中、重点图标 |
| `Color/Brand/ForestPressed` | `#244434` | 主按钮按下 |
| `Color/Brand/ForestSoft` | `#DCE8E0` | 推荐标签、成功浅底 |
| `Color/Accent/Terracotta` | `#C96E50` | 印章、提醒、装饰 |
| `Color/Accent/TerracottaSoft` | `#F4E0D8` | 浅提示底 |
| `Color/Accent/Gold` | `#9A742F` | 少量统计强调 |
| `Color/Text/Primary` | `#20251F` | 标题和正文 |
| `Color/Text/Secondary` | `#59635B` | 作者、说明、元数据 |
| `Color/Text/Muted` | `#687168` | 占位、时间、禁用文字 |
| `Color/Border/Default` | `#D8D0C3` | 分割线和边框 |
| `Color/Border/Strong` | `#AFA596` | 键盘焦点和强调边框 |
| `Color/State/Success` | `#3F7354` | 成功 |
| `Color/State/Warning` | `#8C5A22` | 警告 |
| `Color/State/Danger` | `#A9413F` | 删除、失败、不推荐 |
| `Color/State/Info` | `#356A8A` | 信息提示 |
| `Color/Overlay/Scrim` | `rgba(25,31,27,0.48)` | 弹层遮罩 |

约束：

- 白字只允许放在 `Forest`、`ForestPressed`、`Danger` 等已验证深色背景上。
- `Terracotta` 和 `Gold` 不作为白字大按钮底色。
- 正文与背景对比度至少 `4.5:1`；大标题至少 `3:1`。
- 状态不能只依赖颜色，必须搭配文字或图标。

### 5.2 Typography Styles

Figma 字体：

- 展示角色：`Songti SC`；只用于绘本馆名称、空状态标题和欢迎语。
- 功能角色：`PingFang SC`；Windows 设计环境缺失时使用 `Noto Sans CJK SC`。
- 微信小程序运行时必须设置完整系统回退字体，不下载远程字体。

| Style | Size/Line | Weight | 用途 |
| --- | --- | --- | --- |
| `Type/Display/Large` | `30/38` | Semibold | 首次欢迎、空馆标题 |
| `Type/Display/Medium` | `24/32` | Semibold | 绘本馆名称 |
| `Type/Title/Page` | `22/30` | Semibold | 页面标题 |
| `Type/Title/Section` | `18/25` | Semibold | 区块标题 |
| `Type/Body/Strong` | `16/24` | Semibold | 列表主要文字 |
| `Type/Body/Regular` | `16/24` | Regular | 正文、表单 |
| `Type/Body/Secondary` | `14/21` | Regular | 作者、出版社、说明 |
| `Type/Label/Medium` | `13/18` | Medium | 标签、按钮辅助文字 |
| `Type/Caption/Regular` | `12/17` | Regular | 时间、次要元数据 |

规则：

- 主体可读文字不小于 `14px`；`12px` 只用于非关键元数据。
- 正文不使用 Light/Thin。
- 重要文字不得仅靠截断传达；详情页必须可查看完整书名。
- 文本放大时，水平排列允许改为垂直排列。

### 5.3 Spacing Variables

`Space/1=4`、`Space/2=8`、`Space/3=12`、`Space/4=16`、`Space/5=20`、`Space/6=24`、`Space/8=32`、`Space/10=40`、`Space/12=48`。

### 5.4 Radius Variables

| Variable | Value | 用途 |
| --- | --- | --- |
| `Radius/Small` | `8` | 小标签、封面 |
| `Radius/Medium` | `12` | 输入框、列表卡 |
| `Radius/Large` | `16` | 主卡片、弹层 |
| `Radius/XLarge` | `24` | Bottom Sheet 顶部 |
| `Radius/Pill` | `999` | 胶囊标签 |

### 5.5 Effects

| Effect | 值 | 用途 |
| --- | --- | --- |
| `Effect/Card` | `0 6 18 rgba(35,56,45,0.08)` | 浮起卡片 |
| `Effect/Floating` | `0 8 24 rgba(35,56,45,0.18)` | 添加按钮 |
| `Effect/Sheet` | `0 -8 32 rgba(25,31,27,0.12)` | Bottom Sheet |

普通图书卡片默认不加阴影，只用背景和间距形成层级。

### 5.6 Motion

| Motion | Duration | Curve |
| --- | --- | --- |
| `Motion/Press` | `120ms` | ease-out |
| `Motion/State` | `160ms` | ease-in-out |
| `Motion/Content` | `180ms` | ease-out |
| `Motion/Sheet` | `220ms` | ease-out |
| `Motion/AddSuccess` | `400ms` | ease-out |

- 禁止自动轮播、持续弹跳或超过 500ms 的装饰动画。
- 用户开启减少动态效果时，只保留透明度变化，不使用缩放和位移。

### 5.7 Icons

- 图标画板 `24 × 24`，圆角线帽，描边 `1.75px`。
- 同一图标必须来自同一套自绘 SVG 资产。
- 需要：home、shelf、profile、scan、search、filter、sort、grid、list、plus、close、back、more、check、warning、error、edit、trash、camera、chevron、book。
- 图标按钮点击区域至少 `44 × 44`。
- 不直接复制 SF Symbols 作为跨平台小程序图标资产。

---

## 6. Components

所有组件使用 Auto Layout，宽度默认 `Fill container`，除非明确写为 Hug。

### 6.1 组件清单

| Component ID | Variants |
| --- | --- |
| `C/Button` | `type=primary|secondary|tertiary|danger`；`state=default|pressed|disabled|loading`；`size=large|medium` |
| `C/IconButton` | `style=plain|surface|floating`；`state=default|pressed|disabled` |
| `C/TopBar` | `mode=root|back|titleAction` |
| `C/TabBar` | `selected=library|shelves|profile` |
| `C/SearchField` | `state=empty|typing|filled|disabled` |
| `C/TextField` | `state=default|focused|filled|error|disabled`；`type=text|month|select|textarea` |
| `C/SegmentedControl` | `selected=grid|list` |
| `C/Chip` | `type=filter|preference|status`；`state=default|selected|disabled` |
| `C/BookplateMark` | `size=small|large` |
| `C/BookCover` | `state=ready|loading|missing|error|pending|rejected` |
| `C/BookCardGrid` | `preference=none|recommended|neutral|notRecommended`；`selected=true|false` |
| `C/BookListItem` | `mode=default|manage`；`selected=true|false` |
| `C/ShelfCard` | `state=default|empty` |
| `C/StatusBanner` | `type=info|success|warning|danger` |
| `C/EmptyState` | `type=library|search|shelf|error|offline` |
| `C/Skeleton` | `type=bookGrid|bookList|detail|shelfList` |
| `C/Toast` | `type=success|info|error` |
| `C/BottomSheet` | `state=collapsed|expanded` |
| `C/Dialog` | `type=confirm|danger` |
| `C/ProgressSteps` | `step=1|2|3` |
| `C/MetricCard` | `trend=none|up|down` |

### 6.2 关键尺寸

- Large Button：高 `48px`，水平 padding `20px`，最小宽 `120px`。
- Medium Button：高 `44px`。
- Icon Button：视觉图标 `24px`，容器 `44px`。
- Text Field：最小高 `48px`，多行输入最小高 `112px`。
- Search Field：高 `44px`。
- Tab Bar Item：最小 `64 × 50px`，图标 `24px`，标签 `11px`。
- List Item：最小高 `88px`。
- Status Banner：padding `12px`，图标与文字间距 `8px`。

### 6.3 图书封面规则

- `ready`：图片 aspectFit，衬底可见。
- `loading`：衬底加轻微骨架块。
- `missing`：显示抽象书脊、书名首字和“暂无封面”辅助标签。
- `error`：与 missing 相同，不显示浏览器破图图标。
- `pending`：右上角状态角标“待审核”。
- `rejected`：右上角状态角标“需修改”，同时出现警告图标。

### 6.4 空状态真实文案

| Empty State | 标题 | 说明 | 主操作 | 次操作 |
| --- | --- | --- | --- | --- |
| `library` | 你的家庭绘本馆，正等第一本书 | 扫描封底 ISBN，几秒就能收进来 | 扫描 ISBN | 手动录入 |
| `search` | 已收录的绘本里还没有找到这本书 | 你可以扫描 ISBN，或者手动录入 | 扫描 ISBN | 手动录入 |
| `shelf` | 这个书架还没有绘本 | 从绘本馆选择几本加入 | 选择绘本 | 返回绘本馆 |
| `offline` | 当前网络不可用 | 检查网络后重新加载，已有本地页面不会丢失 | 重新加载 | 无 |
| `error` | 这次没有加载成功 | 稍后重试；如果一直失败，可以提交反馈 | 重新加载 | 提交反馈 |

---

## 7. `V1-Core` 页面结构

### 7.1 全局导航

底部三个入口：

1. 绘本馆。
2. 书架。
3. 我的。

绘本馆右下角使用 `C/IconButton[style=floating]` 添加绘本。空绘本馆直接显示主按钮，不同时显示悬浮按钮。

### 7.2 页面 Frame 清单

| Frame ID | 路由/场景 | 必做状态 |
| --- | --- | --- |
| `P01-Bootstrap` | `pages/bootstrap` | loading、error、disabled |
| `P02-Onboarding` | `pages/onboarding` | step1、step2、validation |
| `P03-Library-Grid` | `pages/library` | default、loading、pagination |
| `P04-Library-Empty` | `pages/library` | first-empty |
| `P05-Library-ListManage` | `pages/library` | list、multi-select |
| `P06-AddBook` | `pages/add-book` | default |
| `P07-IsbnLoading` | ISBN 查询中 | lookup、provider、cover |
| `P08-BookConfirm` | `pages/book-confirm` | new、duplicate |
| `P09-ContinuousConfirm` | 连续扫码 | new、duplicate、failure |
| `P10-ContinuousSummary` | 连续扫码汇总 | mixed、all-success |
| `P11-CachedSearch` | 已收录搜索 | results、typing |
| `P12-CachedSearchEmpty` | 已收录搜索 | empty |
| `P13-ManualBookForm` | 手工录入 | empty、validation、submitting |
| `P14-ManualPending` | 手工图书详情 | pending |
| `P15-ManualRejected` | 手工图书详情 | rejected、editing |
| `P16-BookDetail` | `pages/book-detail` | standard、no-cover |
| `P17-Shelves` | `pages/bookshelves` | default、empty、reorder |
| `P18-ShelfDetail` | `pages/bookshelf-detail` | default、empty、manage |
| `P19-ShelfEdit` | `pages/bookshelf-edit` | create、edit、pick-books |
| `P20-Profile` | `pages/profile` | default、admin-entry |
| `P21-ProfileEdit` | `pages/profile-edit` | default、validation |
| `P22-Feedback` | `pages/feedback` | default、success |
| `P23-DeleteAccount` | 注销流程 | confirm、processing |
| `P24-AdminDashboard` | `pages/admin` | metrics、loading |
| `P25-AdminReviewList` | 管理审核 | pending、conflict-filter |
| `P26-AdminReviewDetail` | 管理审核 | normal、reject |
| `P27-AdminIsbnConflict` | ISBN 冲突 | compare、decision-confirm |

### 7.3 核心页面详细布局

#### `P02-Onboarding`

```text
Top safe area
TopBar：返回隐藏，右侧无动作
BookplateMark/large
Display title：先给家庭绘本馆起个名字
ProgressSteps：1/2
TextField：绘本馆名称（默认“我的绘本馆”）
Button/primary：下一步

Step 2
Title：认识一下家里的小读者
TextField：孩子昵称（必填）
TextField/month：出生年月（必填）
Select：性别（女孩/男孩/暂不说明，必填）
Privacy note：出生年月只用于动态计算年龄段，不会公开
Button/primary：完成建馆
```

表单错误紧贴字段下方；主按钮在键盘弹出时保持可见或随内容滚动，不固定遮挡字段。

#### `P03-Library-Grid`

```text
TopBar/root：左侧无返回，右侧 profile action 可省略
S/LibraryHeader
  eyebrow：依依的绘本馆
  Display title：今天想读哪一本？
  BookplateMark/small
  metadata：共 36 本 · 3 个书架
SearchField
Toolbar
  SegmentedControl：网格/列表
  Filter button
  Sort button
BookGrid：响应式 2/3 列
Floating scan button
TabBar/library
```

滚动后 LibraryHeader 可收起，SearchField 和 Toolbar 吸顶；吸顶区域不遮挡微信顶部胶囊。

#### `P04-Library-Empty`

不显示空白网格。内容垂直放在屏幕视觉中心稍上：

```text
BookplateMark/large
抽象书脊插画
标题：你的家庭绘本馆，正等第一本书
说明：扫描封底 ISBN，几秒就能收进来
Button/primary：扫描 ISBN
Button/tertiary：手动录入
TabBar/library
```

#### `P06-AddBook`

```text
TopBar/back：添加绘本
Primary action card
  scan icon
  title：扫描一本
  body：适合快速添加单本绘本
  Button/primary：扫描 ISBN
Secondary action card
  repeated scan illustration
  title：连续扫描
  body：适合一次录入整排绘本
  Button/secondary：开始连续扫描
Divider label：其他方式
Input：输入 ISBN
Button/secondary：查询
List action：搜索已收录的绘本
List action：手动录入
```

系统扫码画面由微信提供，Figma 不伪造相机取景器。

#### `P08-BookConfirm`

```text
TopBar/back：确认绘本
Large BookCover
Title：猜猜我有多爱你
Metadata：山姆·麦克布雷尼 · 明天出版社
ISBN：9787533258092
Status Banner（仅封面失败等情况显示）
Quantity stepper：1
Button/primary：加入绘本馆
Button/tertiary：不是这本
```

重复版本将按钮改为“数量加一”，并显示“绘本馆中已有 1 本”。

#### `P09-ContinuousConfirm`

连续模式顶部始终显示 `连续扫描 · 已处理 4 本`。

新书状态：

- 主操作：“加入并继续扫”。
- 次操作：“加入并结束”。

重复状态：

- Banner：“绘本馆中已有 1 本”。
- 主操作：“数量加一并继续”。
- 次操作：“跳过并继续”。
- 文字操作：“结束扫描”。

失败状态：

- 明确说明失败原因。
- 操作：“重试”“手动录入”“跳过继续”“结束扫描”。

#### `P10-ContinuousSummary`

```text
TopBar/back disabled：本次扫描完成
Success icon / BookplateMark
Title：这次收进了 8 本绘本
Metric row：新增 6、数量增加 2、跳过 1、失败 1
Failed section（存在失败时）
  每项显示 ISBN、原因、重新处理入口
Button/primary：回到绘本馆
Button/secondary：继续扫描
```

#### `P12-CachedSearchEmpty`

必须使用 `C/EmptyState[type=search]`，不得显示“暂无数据”。

页面文案明确说明搜索范围是“已收录的绘本”，不暗示已搜索全网或供应商数据库。

#### `P13-ManualBookForm`

```text
TopBar/back：手动录入
Status Banner/info：提交后预计 1—3 个自然日完成审核
封面上传（选填）
书名（必填）
作者/译者（选填）
出版社（选填）
ISBN（选填，输入后实时校验）
装帧（选填）
Button/primary：提交审核
```

上传封面时显示内容安全检测状态；失败不使用模糊“上传失败”，应显示“这张图片无法使用，请重新选择”。

#### `P14-ManualPending`

- 封面角标“待审核”。
- Banner：“预计 1—3 个自然日完成审核”。
- 可编辑，但修改后重新计算提交时间。
- 不出现分享相关操作。

#### `P15-ManualRejected`

- 红色状态不是页面主色，只用于状态 Banner 和角标。
- Banner 标题：“需要修改后重新提交”。
- 直接显示管理员驳回原因。
- 主操作：“修改信息”。
- 修改完成后的按钮：“重新提交审核”。

#### `P16-BookDetail`

```text
TopBar/back + more
Hero：大封面 + 标准书目信息
Preference selector：推荐/一般/不推荐/未标记
Quantity stepper
Shelf section：所属书架 + 编辑
Private note：明确标记“仅自己可见”
Book metadata accordion
Danger zone：从绘本馆删除
```

#### `P17-Shelves`

- 标题：“书架”。
- 顶部说明：“按家庭习惯，把绘本放进多个书架”。
- ShelfCard 使用 2×2 封面拼贴，不足时显示 CoverMat。
- 新建书架使用页面按钮，不做与悬浮扫描按钮相同的浮动样式。

#### `P20-Profile`

区块顺序：

1. 家庭绘本馆资料。
2. 孩子资料。
3. 藏书、书架、待审核数量。
4. 隐私与账号。
5. 意见反馈。
6. 管理入口：只有管理员显示。
7. 注销账号：放在页面最底部危险区域。

#### `P24-AdminDashboard`

管理员页面仍使用品牌变量，但布局更偏工具性：

- 指标卡：用户、建馆、首本、藏书、ISBN 缓存命中、外部调用、连续扫码、待审核。
- 不显示目标线、红绿成败评价或“健康分”。
- 待办区域优先展示审核超过 3 天、ISBN 冲突和封面失败。

#### `P27-AdminIsbnConflict`

```text
TopBar/back：ISBN 冲突
ISBN 固定标题
Compare columns/stack
  现有标准版本
  新提交版本
逐字段差异：书名、作者、出版社、封面、装帧
Radio decisions
  保留现有版本并迁移用户藏书
  用新内容更新允许字段
  驳回新提交
Reason textarea
Button/primary：确认处理
Dialog/confirm：再次确认影响的藏书数量
```

小屏使用上下堆叠，不使用横向双栏。

---

## 8. 页面状态矩阵

所有异步页面至少提供：

| State | 设计要求 |
| --- | --- |
| `loading` | 300ms 后才出现 Skeleton，避免闪烁 |
| `content` | 正常内容 |
| `empty` | 说明为什么为空并提供下一步 |
| `search-empty` | 说明只搜索已收录图书 |
| `offline` | 保留页面壳和可恢复操作 |
| `error` | 具体可理解的原因和重试 |
| `disabled` | 说明账号不可用，不展示业务数据 |
| `pagination` | 列表底部局部加载，不阻塞已显示内容 |
| `all-loaded` | 轻量结束提示，不用 Toast |

Button、IconButton、Input、Chip、BookCard 均必须在 `02-Components` 展示 default、pressed/focused、disabled、loading/error 等适用状态。

---

## 9. 原型连线

### 9.1 `Flow/Core/FirstBook`

```text
P01-Bootstrap
→ P02-Onboarding/step1
→ P02-Onboarding/step2
→ P04-Library-Empty
→ P06-AddBook
→ 微信系统扫码
→ P07-IsbnLoading
→ P08-BookConfirm
→ P03-Library-Grid
```

### 9.2 `Flow/Core/ContinuousScan`

```text
P03-Library-Grid
→ P06-AddBook
→ 开始连续扫描
→ 微信系统扫码
→ P09-ContinuousConfirm
→ 加入并继续扫
→ 微信系统扫码
→ P09-ContinuousConfirm/duplicate|failure
→ 结束
→ P10-ContinuousSummary
→ P03-Library-Grid
```

### 9.3 `Flow/Core/CachedSearchEmpty`

```text
P06-AddBook
→ P11-CachedSearch
→ P12-CachedSearchEmpty
→ 扫描 ISBN 或 P13-ManualBookForm
```

### 9.4 `Flow/Core/ManualReview`

```text
P13-ManualBookForm
→ P14-ManualPending
→ 管理员 P25-AdminReviewList
→ P26-AdminReviewDetail 或 P27-AdminIsbnConflict
→ 用户 P16-BookDetail/approved
或 P15-ManualRejected
→ 修改并重新提交
→ P14-ManualPending
```

### 9.5 `Flow/Core/AccountDeletion`

```text
P20-Profile
→ P23-DeleteAccount/confirm
→ 输入“注销账号”
→ P23-DeleteAccount/processing
→ P01-Bootstrap/deleting
```

原型交互使用 Smart Animate 时不超过本文档 Motion 时长。系统扫码、系统授权、系统图片选择用带说明的外部节点表示，不伪造系统界面。

---

## 10. 响应式与可用性

- 所有主要点击目标最小 `44 × 44px`，对应基准下 `88rpx × 88rpx`。
- 小屏优先保持操作和文字完整，再减少装饰、列数和横向排列。
- 键盘弹出时，当前输入字段和主要提交按钮必须可滚动到可见区域。
- Bottom Sheet 支持关闭按钮、遮罩点击和下滑关闭；危险确认不允许仅靠下滑误关闭。
- 长书名、空作者、无封面、系统大字体不能引起按钮重叠或横向滚动。
- 不只用颜色表示推荐、错误、审核和选中。
- 图标按钮在 Figma 设置可读的 accessibility label 备注。
- 核心流程支持单手操作；主要按钮位于内容下方或底部安全操作区。
- 不为 V1 强制制作深色模式，但变量结构必须支持未来增加 Dark Mode。

---

## 11. Figma 注释到微信小程序映射

| Figma | 微信小程序 |
| --- | --- |
| `C/Button` | `components/ui-button` |
| `C/BookCover` | `components/book-cover` |
| `C/BookCardGrid` | `components/book-grid/book-card` |
| `C/BookListItem` | `components/book-list-item` |
| `C/EmptyState` | `components/empty-state` |
| `C/StatusBanner` | `components/status-banner` |
| `C/BottomSheet` | `components/bottom-sheet` |
| Color Variables | `styles/tokens.wxss` |
| Typography Styles | `styles/typography.wxss` |
| Spacing/Radius | `styles/tokens.wxss` |
| Prototype Flow | 页面跳转与 action 调用 |

Figma Dev Mode 注释需写明：

- 组件 ID。
- 绑定变量。
- 页面状态。
- 点击后目标 Frame。
- 对应业务 action；例如 `加入绘本馆 → libraryService.addBook`。
- 无障碍标签。

---

## 12. `V1-Share` 下一阶段路线图（不做高保真）

`20-Share-Roadmap` 只创建一个流程图 Frame 和一个页面清单 Frame。

### 12.1 页面清单

- 分享设置。
- 分享预览。
- 公共分享页。
- 分享失效页。
- 我的分享与指标。
- 管理员违规分享处置。

### 12.2 流程

```text
绘本馆/书架
→ 选择公开内容和资料
→ 预览公共快照
→ 发布
→ 好友打开
→ 浏览/点赞
→ 创建自己的绘本馆
```

### 12.3 当前禁止

- 不创建上述页面的高保真 Frame。
- 不创建分享专用组件 Variant。
- 不把分享入口放进 `V1-Core` 绘本馆、书架或详情页。
- 不设计社区、推荐流、评论、关注或私信。
- 开始下一阶段前必须重新确认隐私选择、公开快照、分享统计和访客转化页面。

---

## 13. Figma 交付检查

Figma MCP 完成后逐项检查：

### 13.1 结构

- 五个 Figma Page 名称完全一致。
- 所有 `V1-Core` Frame ID 完整。
- `V1-Share` 只有路线图，没有高保真页面。
- 页面全部使用 Auto Layout，关键容器使用 Fill/Hug，不依赖绝对定位堆叠。

### 13.2 变量与组件

- 页面颜色、字体、间距、圆角和阴影全部绑定变量或样式。
- 页面中的按钮、输入框、图书卡片、封面和状态提示均为组件实例。
- 组件状态矩阵完整。
- 不存在 Detach 后重复绘制的同类组件。

### 13.3 视觉

- 绘本封面是主视觉，且不被 `aspectFill` 裁切。
- BookplateMark 使用克制，每页最多一次。
- 页面不像通用后台或默认表单堆叠。
- 主文案使用真实中文内容。
- 小屏和大屏检查 Frame 无横向溢出。

### 13.4 交互

- 五条核心流程均有 Prototype 起点。
- 所有主要按钮有去向。
- 系统扫码等外部流程使用说明节点。
- 错误、空状态和审核状态都有恢复动作。
- 点击区域、对比度和非颜色提示符合第 10 节。

---

## 14. 设计完成定义

只有同时满足以下条件，才能声明 `V1-Core` Figma 设计稿完成：

1. Foundations、Components 和全部当前页面均已创建。
2. 页面使用组件实例和变量，没有散装样式。
3. 连续扫码、缓存搜索空结果、手工审核和 ISBN 冲突页面完整。
4. 核心原型连线可从首次建馆走到首本入馆。
5. 375、320、430 三种宽度完成检查。
6. Figma 页面不存在分享运营版高保真界面。
7. 研发可从页面 ID、组件 ID 和 action 注释直接开始编码，无需自行猜测布局。
