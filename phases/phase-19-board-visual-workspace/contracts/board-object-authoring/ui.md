# 契约束 `board-object-authoring` — ① UI（签核面第 ① 件）

> **自检：本文件引用 8 张截图，目录下实际 8 张。N == M == 8。**
> 截图目录：`ui-preview/board-object-authoring/`。
>
> 本束已提供真实 Fabric.js 组件与 mock command adapter 原型，但不 claim、不实现正式产品路由。
> Sticky/Text 编辑、连续创作、IME、Delete/Undo、Reaction 与 Link Preview 的 8 个状态
> 已由主 session 从页面文件 `apps/web/app/preview/board-object-authoring/page.tsx` 对应的
> `/preview/board-object-authoring?state=<状态>` 取材。截图材料已齐，但本束仍保持
> `pending`，等待人类核对；S01 的已签核截图没有冒充本束新增界面。

依据：`requirements/02-object-authoring.md` R1–R12、
`requirements/05-collaboration-history.md` R3/R7，以及原始 PRD 第 6–11、37、47–49、57–58 节。
覆盖 feature 的权威在 `design-signoff.md` frontmatter `covers:`。

## 一、界面落点

| 层级 | 路由 / 组件边界 | 目的 | 当前状态 |
|---|---|---|---|
| 正式 Board | `/studio/board/:boardId` | 在已签核 Fabric surface 内完成对象创作；不新增第二画布 | 待实现 |
| 一级工具 | Sticky、Text | 单击工具后点画布创建；`N`/`T` 直达；双击空白默认 Sticky | 待实现 |
| inline editor | Sticky/Text 的 Fabric 对象上方受控文本编辑层 | 创建后立即聚焦、显示 caret、承接 IME/RTL/长文本；内容仍写 canonical text command | 原型与截图已齐，待人类核对 |
| contextual toolbar | 对象附近的高频浮动工具条 | Sticky 形状/颜色/字号/标签/链接/Reaction；Text 层级和文字样式 | 原型与截图已齐，待人类核对 |
| property panel | 右侧精确设置 | normal/free/auto-height、固定/自动尺寸、精确颜色和链接状态 | 原型与截图已齐，待人类核对 |
| history feedback | 顶部 Undo/Redo 与短暂结果提示 | 删除、恢复、冲突、无可撤销动作；只有 canonical transaction 确认后才报成功 | 待实现 |
| accessible mirror | S01 DOM 对象大纲与编辑入口 | 使用同一 object id/selection；可键盘进入编辑、删除、撤销并接收状态播报 | 原型可浏览/选择，正式接线待实现 |

所有 Sticky/Text 本体、选择与变换仍由 Fabric 投影。inline editor 可以是 React DOM 输入层，
但它只承接编辑会话和可访问语义，不能保存第二份文本、几何、样式或历史。

## 二、稳定 `data-testid`

| 区域 / 状态 | `data-testid` | 可见判据 |
|---|---|---|
| Sticky 工具 | `board-tool-sticky` | 可点击、可键盘聚焦，tooltip 显示 `N` |
| Text 工具 | `board-tool-text` | 可点击、可键盘聚焦，tooltip 显示 `T` |
| 新建 Sticky | `board-sticky-<objectId>` | 创建即被选中，Fabric metadata 与 canonical id 相同 |
| 新建 Text | `board-text-<objectId>` | 点击画布后立即进入文字编辑 |
| inline editor | `board-inline-editor-<objectId>` | caret 可见，`aria-label` 含类型与对象名 |
| IME 状态 | `board-inline-editor-composing` | composition 中不提交半个字符、不触发 Tab 连续创建 |
| Sticky 形状 | `board-sticky-shape-menu` | square / rectangle / circle 三种形状可预览并提交一次 style command |
| resize 模式 | `board-sticky-resize-mode` | normal / free / auto-height 的当前模式可读 |
| 浮动工具条 | `board-sticky-contextual-toolbar` | 高频属性与 readonly 禁用态清楚 |
| Reaction | `board-object-reaction-menu`、`board-object-reaction-summary` | 每个 actor/emoji 的结果可读、可撤销 |
| Link | `board-object-link-editor`、`board-object-link-preview` | loading / ready / failed / blocked 四态不丢原始安全链接 |
| 删除反馈 | `board-object-delete-status` | 删除确认后对象退出 projection；失败不假成功 |
| Undo / Redo | `board-action-undo`、`board-action-redo` | 不可用时 disabled；恢复后相同 object id 重新出现 |
| 体验 trace | `board-authoring-trace` | 仅测试/诊断构建暴露 board-ready、create-intent、caret-ready、continued-count 时间戳 |
| 可访问播报 | `board-authoring-announcer` | 创建、删除、恢复、冲突与链接失败以 `aria-live` 播报 |

## 三、核心交互

### 1. 第一张想法：TTFI `< 5 秒`

1. 空 Board 进入 `board-state-ready` 后，不打开菜单。
2. 用户双击空白，或按 `N` 后点画布。
3. 系统产生一条 `CreateSticky` command；Yjs observer 投影对象。
4. inline editor 立即聚焦，caret 可见，用户可直接输入。

计时从 `board-state-ready` 到第一张 Sticky 的 caret-ready；自动化轨迹固定执行一次双击，
不得通过预置隐藏对象或先行创建来缩短数字。阈值是 `< 5 秒`，不能改成平均值或 5 秒以内含等号。

### 2. 连续创作：第一张后再建 10 张 `< 30 秒`

- 当前 Sticky 完成文本后按 `Tab`，提交当前 composition，再按附近排列方向创建下一张并聚焦。
- 默认横向、world-space 间距 24px；已有明确纵向序列时继续纵向。
- 计时从第一张 Sticky 提交并获得焦点完成信号开始，到第 11 张 Sticky 的 caret-ready；即“第一张后再创建 10 张”，不是总数 10 张。
- `Shift+Tab` 保留为正常焦点导航，不得静默反向批量创建；IME composition 中的 Tab 由输入法优先处理。

### 3. Sticky / Text 直接编辑

- Sticky 支持 square、rectangle、circle；normal resize 保持形态比例，按修饰键进入 free resize，
  auto-height 随 canonical 文本测量增加高度且不把 viewport zoom 写回 geometry。
- Text 支持 Title、Heading、Subheading、Body、Caption；高频层级在浮动工具条，精细字号、行高、
  对齐和链接在属性面板。
- 双击已存在对象或从 DOM 大纲触发“编辑”进入同一编辑会话；`Escape` 结束会话并保留已确认 composition，
  空新对象是否删除由用例契约决定，不能在 UI 私自发明。

### 4. Delete 与基础 Undo/Redo

- `Delete/Backspace` 只在画布 selection 有焦点且不处于文本/IME 编辑时删除对象。
- 删除经 canonical tombstone transaction 确认后才从 Fabric 与 DOM mirror 移除；Undo 恢复相同 id，
  不是复制一个新对象。Redo 重放同一语义动作而非复用 Fabric 实例。
- Iteration 2 只承诺当前在线会话的基础创建、文本、样式、移动、删除历史；多人冲突、离线 outbox、
  认证 tombstone restore 与 checkpoint 属于 BV22，但本束不能覆盖他人后续写入。

### 5. Reaction 与 Link Preview

- Reaction 是对象元数据上的可访问汇总，不用绝对定位 DOM 卡片替代对象；键盘可打开、选择与撤销自己的 reaction。
- Link editor 只接受允许的 `http/https` URL；用户提交后立即保留规范化链接，预览异步进入 loading。
- 预览成功显示标题、描述、站点和安全缩略图；失败、超时、被策略阻止时保留普通链接并给重试/移除入口，
  不显示伪造的“已加载”卡片，也不把远端 HTML 注入 Board。

## 四、截图索引（8/8）

全部 PNG 均由主 session 从真实组件取材，尺寸为 1280×800；原型页明确披露 mock command
adapter 与未连接 Yjs/服务端的边界。

| # | state | 文件 | 验收要点 |
|---:|---|---|---|
| 1 | default | `default.png` | Sticky inline editor 已聚焦；Fabric 对象、属性面板与 DOM mirror 同屏；移动端 editor 仍保持安全边距 |
| 2 | continuous | `continuous.png` | 第一张加后续 10 张共 11 张完整可见；蛇形顺序相邻对象边缘间距均为 24 world-space px，未进入右侧属性面板下方 |
| 3 | composing | `composing.png` | 中文 IME 候选与“Tab 暂交给输入法”反馈可见；composition 中不声明半成品已提交 |
| 4 | resize | `resize.png` | normal、free、auto-height 三种尺寸同时可辨；长文本对象完整显示 |
| 5 | contextual | `contextual.png` | 选中 Text 时显示 Text 工具条与文字属性；选择、属性和 mirror 共用同一 object id |
| 6 | link-failed | `link-failed.png` | blocked 状态保留原始安全链接，明确没有加载远端内容，并提供可控重试入口 |
| 7 | readonly | `readonly.png` | Viewer 仍可浏览 Fabric 与 DOM mirror；创建、属性修改和 Undo 写入口禁用，安全链接仍可打开 |
| 8 | undo-conflict | `undo-conflict.png` | 明确说明他人后续编辑导致无法安全撤销；画布保持当前对象，没有假成功或错误闪回 |

### 主 session 真实浏览器验收摘要

- 覆盖 8 个 state × 375 / 768 / 1280 三档 viewport，共 24/24 组合通过。
- 每个组合均验证 `document.scrollWidth <= innerWidth`、Fabric Canvas 存在非透明绘制像素，且 DOM mirror 至少包含一个对象。
- 375×800 的 default 状态额外核对 inline editor 完整位于 viewport 内，紧凑 `Board` 标题与场景选择器互不遮挡。
- 1280×800 的 continuous 状态额外核对 11 个对象全部位于右侧属性面板之前，连续路径每一步边缘间距精确 24px。
- 这些证据证明原型在目标视口的材料完整性；它们不证明正式 Yjs、权限、服务端 Link Preview 或协作 Undo 已完成。

## 五、签核边界

- 当前 8 张截图已齐，① UI 已具备人类核对材料；只有人类可以确认，本文件不代签。
- S01 已确认的画布层级与工具位置继续成立；本束只扩展对象创作状态，不重新打开 S01 renderer 决策。
- 出图必须来自真实组件 + mock command adapter，并清楚标识哪些行为仍未接 Yjs/服务端；静态设计稿不能替代。
- 人类确认视觉与状态后，才可把本束 `design-signoff.md` 改为 `confirmed`；确认 UI 不等于 BV04–BV06 完成。
