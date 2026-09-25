# 契约束 `board-fabric-surface` — ① UI（签核面第 ① 件）

> **自检：本文件引用 1 张截图，目录下实际 1 张。**
> 截图目录：`ui-preview/board-fabric-surface/`。
>
> 当前材料只证明全屏 Fabric 视觉方向与基础直接操作；它明确标注为本地 mock，尚未连接
> Yjs 或服务端。六种非默认状态仍是签核缺口，不能把本预览当成 S01 已实现。

依据：`requirements/01-fabric-surface.md` R1–R12、
`requirements/08-performance-accessibility.md` R3/R7/R8，以及 ADR-115。
覆盖 feature 的权威在 `design-signoff.md` frontmatter `covers:`。

## 一、界面落点

| 层级 | 路由 / 组件 | 目的 | 当前状态 |
|---|---|---|---|
| 签核预览 | `/preview/board-fabric-v01` | 用真实 Fabric.js 7.4 验证全屏画布、对象命中、变换、平移缩放与 DOM 对象大纲 | 已有本地 mock |
| 正式入口 | `/studio/board/:boardId` | 从 Y.Doc 增量投影正式 Board；只保留 Fabric 主对象表面 | S01 实现目标 |
| Fabric 表面 | `BoardFabricSurface`（正式实现应落到 `components/whiteboard/fabric/`） | renderer lifecycle、viewport、object registry、selection | 预览版已有；生产 adapter 未接 |
| React 外壳 | 顶栏、左工具栏、浮动工具条、属性面板、底部 viewport 控件 | 产品操作与反馈，不进入 canvas 对象树 | 已有视觉方向 |
| 可访问镜像 | React DOM 对象大纲 | 与同一 object id、selection、revision 同步的键盘/读屏入口 | 预览版已有列表；双向 command 未接 |

正式入口必须全屏占据 Studio 内容区，不出现旧预览的页内卡片边界。对象主视觉、命中、
选择框、缩放与旋转控点均由 Fabric 绘制；React DOM 只承载外壳与无障碍语义，不能把
绝对定位按钮或 SVG 节点继续作为对象主表面。

## 二、稳定 `data-testid`

### 已在真实组件中存在

| 区域 / 操作 | `data-testid` | 签核判据 |
|---|---|---|
| 全屏预览根 | `board-fabric-preview` | 页面占满 viewport，壳层不挤压画布 |
| Fabric stage / canvas | `board-fabric-stage`、`board-fabric-canvas` | canvas 是对象主渲染表面 |
| 一级工具栏 | `board-fabric-toolbar`、`board-tool-select`、`board-tool-hand`、`board-tool-sticky`、`board-tool-text`、`board-tool-rectangle`、`board-tool-ellipse` | 所有工具可键盘聚焦并有 `aria-label` |
| 浮动工具条 | `board-floating-toolbar`、`board-action-undo`、`board-action-redo` | 选择上下文可见；undo/redo 在正式接线前不得假成功 |
| 选择属性 | `board-properties-panel`、`board-selection-properties` | Fabric 变换后的世界坐标与尺寸可观察 |
| viewport | `board-zoom-controls`、`board-zoom-out`、`board-zoom-value`、`board-zoom-in`、`board-zoom-fit` | 5%–800%，fit 有明确边界 |
| 无障碍镜像 | `board-a11y-object-list`、`board-a11y-object-<objectId>` | 与 Fabric 使用同一 object id 与 selection |
| 原型披露 | `board-preview-disclosure` | 明确“真实 Fabric 渲染、未连接 Yjs 或服务端” |

### S01 实现必须补齐

| 状态 / 失败 | 预留稳定锚点 | 可见行为 |
|---|---|---|
| loading | `board-state-loading` | Board metadata/Y.Doc 未就绪时保留全屏骨架与退出入口 |
| empty | `board-state-empty` | 零对象时给出创建便利贴/粘贴内容入口，不注入示例对象 |
| invalid | `board-state-invalid` | 单对象无效显示带 object id 的隔离占位；其余对象可编辑 |
| dep-failed | `board-state-dependency-failed` | collaboration/content 依赖失败，不把旧内容伪装成最新 |
| denied | `board-state-denied` | 未授权不加载对象正文；viewer 则进入明确只读表面 |
| success | `board-state-ready` | Fabric、Y.Doc projection 与可访问镜像都已就绪 |
| context lost | `board-state-context-recovering` | 保留 Y.Doc，重建 Fabric projection，过程可见且可重试 |

`?state=default|loading|empty|invalid|dep-failed|denied|success` 只作为开发预览入口；生产构建
不得靠查询参数改变权限或服务端状态。

## 三、截图索引

| # | 截图 | 人类核对重点 |
|---:|---|---|
| 1 | `s01-fabric-board.png` | 全屏层级、真实 Fabric 对象和控点、左侧工具、顶部编辑条、右侧属性与 DOM 对象大纲、底部 zoom |

## 四、交互边界

- `select` 负责单选、框选和 Fabric controls；`hand` 负责 pan；滚轮/触控板以指针为中心缩放。
- viewport 是每位用户的本地视图状态，不能写回对象世界坐标或广播成协作对象变化。
- `object:moving/scaling/rotating` 只更新手势中的瞬时画面；手势结束的
  `object:modified` 才产生一条有界 Board command/Yjs transaction。
- Yjs patch 应按 object id 增量 add/patch/remove/reorder；普通 patch 不调用
  `canvas.clear()`、`loadFromJSON()` 或整板重建。
- DOM 对象大纲选择对象时，Fabric selection 与属性面板同步；Fabric 选择变化时，DOM 的
  `aria-selected`、焦点恢复目标与同一 object id 同步。两边都发送相同领域 command。
- viewer 可 pan/zoom/选择用于阅读，但 Fabric controls、写快捷键和属性编辑必须禁用；前端
  隐藏不能替代服务端/Yjs 写权限校验。

## 五、签核前材料缺口

1. 目前只有默认态截图；loading、empty、invalid、dep-failed、denied、success 六态均未出图。
2. 当前预览对象来自本地数组；尚不能证明 Y.Doc → Fabric 增量 projection、回声抑制或双浏览器一致性。
3. `undo`、`redo` 与分享按钮只是可见外壳，当前没有正式行为；人类不应按截图把它们签成已完成。
4. 预览中的对象大纲能选择条目，但尚未证明完整键盘移动、读屏播报、焦点恢复与远端删除兜底。
5. 正式 `/studio/board/:boardId` 还未替换旧 DOM/SVG 主渲染路径；只有正式路由真实浏览器证据可关闭该缺口。

这些缺口是 `design-signoff.md` 保持 `pending` 的直接原因。补齐材料后应更新本文件与截图目录，
由人类重新核对第 ① 件；agent 不得自行改变签核状态。
