# 原始需求 — chat 内置 canvas 模板渲染改按 layoutSource 判据读组织自定义

来源：issue https://github.com/boardx/workspacex/issues/2221（2026-08-27，模板编辑器
chat 模拟功能开发中 devapp 实测发现的既有缺口）。

> 元数据：优先级 **P1**；估点 **5**；建议迭代 **Sprint 01**。

## R1 概览
- **Use Case 名称**：chat 里的内置 canvas 模板渲染读组织自定义
- **Actor**：组织成员（在 chat 里生成/查看带 `模板: <key>` 围栏的画布）、
  组织管理员（在后台模板编辑器里编辑内置模板的分区几何/贴纸样式）
- **目标**：管理员在模板编辑器里改过某个内置模板并发布后，组织成员在 chat 里
  看到的应该是改过的样子，而不是包里写死的默认样子
- **系统边界**：`apps/web/lib/canvas/fence-template-resolver.ts`（渲染判据）、
  `canvas_templates` 表 + 应用层写路径（`mint-template-version.ts` 等）、
  `packages/contracts/src/canvas.ts`（契约）

## R2 前置条件 / 触发条件
- **前置条件**：组织已开通画布模板库（`backfill-canvas-builtin-templates.ts` 跑过），
  19 个内置模板的行已存在
- **触发条件**：管理员在模板编辑器里改动某内置模板的 sections/layout 并点发布；
  之后任意组织成员的 chat 消息里出现该 key 的围栏

## R3 主流程
1. 管理员打开模板编辑器，选中一个内置模板（如 persona），改分区几何/贴纸列数/色调
2. 保存 → 铸新版本（草稿）→ 发布，应用层判定本次改动涉及几何/呈现字段，
   把该行的 `layout_source` 写为 `user-edited`（一次性，此后不可退回）
3. 组织成员在 chat 里发一条消息，模型回复含 `` ```canvas `` 模板: persona 围栏
4. 前端渲染围栏时调用 `ensureCanvasFenceTemplate(key, orgId)`：查到该 key 在这个
   组织下最高版本行的 `layout_source === 'user-edited'` → 用该行 `sections`/`layout`
   现算几何（`buildAutoTemplateSpec`）渲染
5. 画布渲染出管理员发布的颜色/列数/布局，而不是 `fabric-markdown` 包内原生几何

## R4 备选流程与异常流程
- **备选流程**：
  - A1：组织从未编辑过某内置模板（`layout_source` 仍是 backfill 写入的
    `builtin-derived`）→ 渲染仍是包内原生几何，逐坐标不变
  - A2：个人对话（无真实项目 `orgId`，但仍有 `currentOrgId`）→ 同一条渲染路径照常生效
- **异常流程**：
  - E1：查询组织模板列表失败（网络错误/超时）→ 内置 key 优雅退回原生几何渲染，
    不报错、不炸围栏、不提示用户；非内置 key 才落 `fetch-failed`
  - E2：一条消息里有多个内置围栏，或 30 秒缓存窗口内的多条消息 → 只发一次
    `listCanvasTemplates` 请求（复用既有 `AUTO_OWNER` + TTL 缓存机制）
  - E3：`backfill-canvas-builtin-templates.ts` 重跑（幂等）→ 不覆盖已经是
    `user-edited` 的行，不把用户自定义悄悄冲回默认值

## R5 权限与可见性
- 组织成员（任意角色）：能在 chat 里看到本组织已发布的自定义渲染结果，不能改它
  （改的入口是模板编辑器，鉴权规则不在本次范围内改动）
- 组织管理员：能在模板编辑器里改动内置模板并发布，触发 `layout_source` 翻转
- 其它组织：完全看不到、不受影响（`orgId` 隔离，`canvas_templates` 表已有 RLS）

## R6 后置条件 / 不包含
- **后置条件**：某组织对某内置 key 的 `layout_source` 一旦变成 `user-edited`，
  之后任何一次渲染都读该组织自己的行，即便后续版本内容又碰巧等于默认值
- **不包含**：不改内置模板列表本身（仍是 19 个 key）；不改 `builtin` 字段语义；
  不改模板编辑器 UI；不新增错误码

## R7 业务规则
- `layout_source` 是判定「是否用组织自定义几何」的唯一事实源，不得用「DB 里有无
  行」（backfill 恒建行）、「内容是否等于默认值」（比对脆弱）、`actorId`
  （backfill 也用真实管理员账号跑）三种方式替代或并存判定
- 一旦某 key 在某组织下被标过 `user-edited`，不可再退回 `builtin-derived`

## R8 界面线索
- 前端入口：无新增界面。渲染结果变化体现在 chat 消息里的已有画布气泡组件
  （`MarkdownMessage` → 围栏渲染），本次不改任何 UI 组件、不改交互
- 属**纯后端判据 + 渲染管线改动**，has_ui 阶段的界面签核第①节不适用于本 feature
  （phase-13 未开 `--ui`，见下方 R11）

## R9 非功能约束
- 性能：内置且未自定义的 key 新增一次 `listCanvasTemplates` 调用（之前 0 次），
  复用既有 30 秒/orgId 缓存摊薄，需实测这一跳延迟不产生用户可感知的渲染卡顿
- 安全/隐私/合规：无新增数据面，`canvas_templates` 既有 RLS 隔离不变
- 兼容与降级：查询失败/无 orgId 时必须优雅退回，不得让围栏渲染整体失败

## R10 已知约束 / 依赖
- 依赖：`F100`（`fabric-markdown` 源码并入 + 19 key 注册表）、
  `F104`（便签几何归区 + 布局快照，`buildAutoTemplateSpec` 所在能力）
- 技术约束：`fabric-markdown` 是 vendor 并入的上游源码，不可修改（VENDOR.md）；
  改动只能在 apps/web 侧的 resolver 层做

## R11 切分提示
- 单 feature 粒度：DB 迁移 + 契约字段 + 应用层判定 + resolver 改法 + 真实集成测试，
  一次会话可完成并验证（已有完整设计 delta：
  `phases/phase-13-canvas-fixes/design-deltas/canvas-layout-source/`）
- 无前置依赖阶段性工作，可直接排 sprint 01

## R12 AI Ready 验收线索
- 组织自定义某内置模板并发布 → chat 渲染出自定义颜色/列数（真集成测试）
- 组织从未自定义 → chat 渲染仍是原生几何，逐坐标比对不变
- DB 查询失败 → 优雅退回原生几何，围栏不炸
- 一条消息多个内置围栏 / 缓存窗口内多条消息 → 只打一次 `listCanvasTemplates`
- 已标 `user-edited` 后再发一版内容与默认值相同的版本 → 仍是 `user-edited`（不退回）
