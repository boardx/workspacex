# Phase 10「现场协作编排」UI 先行原型 — 签核第 ① 件（UI）材料

> 2026-08-20。这是 ADR-003 规定的 UI 先行产物：用 `apps/web` 真实组件 + **纯 mock 数据**
> 把 Phase 10 范围内**目前完全不存在**的编排层界面做出来，供人类在束级
> `contracts/<束>/design-signoff.md` 第 ① 件签核时逐条核对。
>
> ⚠ **本文列的全部是「requirements 没写、由原型实现者替它做了的决定」。** 它们不是 bug，
> 是缺口被填的位置——需要人类逐条确认。**agent 不得改任何 design-signoff.md 的 status。**

## 怎么看

```bash
pnpm --filter web dev            # 或任意端口
# 打开预览页（顶部三排切换器：屏 / 界面态 / 视角）
open "http://localhost:3000/preview/live-collab-orchestration?screen=stage-default&state=default&as=facilitator"
```

- 组件：`apps/web/components/live-collab/orchestration-preview.tsx`（真实组件库 + 设计 token）
- 预览路由：`apps/web/app/preview/live-collab-orchestration/page.tsx`
- **MOCK 数据（唯一来源）**：`apps/web/lib/mock/live-collab-orchestration.ts`
  —— 文件头有大字 MOCK 告示，每个字段标 `[原型]` / `[待补契约]` / `[待签核]` 三类之一。
- 截图取证：`apps/web/e2e/live-collab-orchestration-shots.spec.ts`
  + `apps/web/playwright.live-collab-shots.config.ts`

门控现状：`pnpm --filter web typecheck` 绿 · `./apps/web/scripts/lint-design.sh` 绿
（无硬编码色/px、无裸表单元素、字号档位单源）。每个可交互元素与关键展示区都带 `data-testid`
（旧原型零 testid，这是本产出与旧原型最重要的差别之一）。

## 与既有产品心智一致（沿用，未另起一套）

- **环节黑色状态条**复用 F963 已有样式/文案（`tab-live.tsx`），不重画。
- **AI 四种在场方式**在分组对话卡片里如实标注：线程里的同事（Scout 检索）/ 项目里的主持人
  （Facilitator 开场预设）/ 后台的 worker（下一步工作派 AI）/ 画布上的协作者（AI 边听边填旅程图）。
- **四视角预览切换器**沿用项目工作台的做法（引导师/组长/组员/观察者），且**明确标注视角切换
  只是预览手段，真实权限在服务端 RLS**。

---

## 截图清单（每张 → 对应 requirements 哪一节 → 覆盖的态）

| 文件 | 屏 | 对应 requirements | 态 |
|---|---|---|---|
| `stage-default-default.png` | 主持台·全场默认（黑状态条 + 三子视图入口） | 01-viewer-role · 00-overview（环节现场呈现） | 默认 |
| `viewer-switcher-expanded.png` | 视角下拉展开（全场 + 4 分组，各带状态后缀） | 01-viewer-role §1/§2 | 交互展开 |
| `stage-checkin-default.png` | 主持台·分组与签到（4 组卡片网格） | 02-group-checkin | 默认 |
| `stage-kanban-default.png` | 主持台·看板（4 组实时卡片 + 广播） | 03-module-routing 三视图·看板 | 默认 |
| `stage-graph-default.png` | 主持台·知识图谱决策推演（决策树+岔口+推演+下一步） | 03-module-routing 三视图·知识图谱 | 默认 |
| `group-graph-default.png` | 分组·本组图谱（决策小树+已确认事实/待决） | 03-module-routing（graph 模块） | 默认 |
| `group-chat-default.png` | 分组·与 AI 的对话（卡片列表） | 03-module-routing（chat 路由） | 默认 |
| `group-interview-default.png` | 分组·用户访谈 | 03-module-routing（interview 路由） | 默认 |
| `group-research-default.png` | 分组·深度研究 | 03-module-routing（research 路由） | 默认 |
| `group-survey-default.png` | 分组·问卷 | 03-module-routing（survey 路由） | 默认 |
| `stage-default-loading.png` | 加载态（skeleton） | 七态 U1 | **加载** |
| `stage-checkin-empty.png` | 空态（还没有分组到场） | 七态 U2 | **空** |
| `stage-checkin-invalid.png` | 校验失败（组未指定组长，无法签发链接） | 七态 U3 | **校验失败** |
| `stage-kanban-dep-failed.png` | 依赖失败（phase-02 未签，看板停骨架） | 七态 · 00-overview 硬前置 | **依赖失败** |
| `stage-default-denied.png` | 无权限（组员看全场被拒） | 七态 · 01-viewer-role 硬约束 | **无权限** |
| `stage-kanban-success.png` | 成功（广播已发出的确认反馈） | 七态 U4 | **成功** |
| `role-member-group-chat.png` | 组员视角（视角锁定本组、无全场控制） | 01-viewer-role §1 | 视角差异 |
| `role-observer-stage-default.png` | 观察者视角（全场只读默认 + 如实提示条） | 01-viewer-role §观察者 | 视角差异 |

七态齐全：默认 / 加载 / 空 / 校验失败 / 依赖失败 / 无权限 / 成功，均可从预览页顶部
「界面态」一排切换复现。

---

## 我替 requirements 做了哪些它没写明的设计决定（人类请逐条看）

1. **分组视角锚定「第 2 组」**。requirements 没指定预览时进哪个组；我沿用 identity mock
   里 groupLead/member 归属第 2 组的既有约定，让顶部视角标签、本组图谱、本组对话全部对齐第 2 组。
2. **观察者能看全场（只读）** = 默认给的答案。01-viewer-role 明说「全场只读 vs 仅分配的一组只读」
   **证据不足、需人类裁定**。我给了「全场只读聚合」这个默认（`LC_ROLE_CAN_SEE_STAGE.observer=true`），
   并在提示条与拒绝面板里**都标了 [待签核]**，没有悄悄拍板。
3. **组长/组员的视角切换器直接锁定本组**（禁用下拉），而不是给一个只有一项的下拉。
   requirements 只说「甚至可能不需要下拉，直接锁定」——我选了锁定，需确认。
4. **「到场」判定口径**取「点过加入链接即到场」这个默认（02-group-checkin 列为待确认），
   签到卡片的「已到/未到」据此渲染；心跳/在线口径未采用，已在页面底部标注 [待签核]。
5. **二维码 / 「看加入页」** 按钮做出来了但只占位；「前端本地生成 vs 服务端出图」「预览 vs 独立 URL」
   两个待确认点在签到页底部如实标注，未实现任一具体方案。
6. **校验失败的具体触发**（签到屏）我编了一个合理场景：「组未指定组长 → 无法签发链接」。
   这是为了让 U3 error 态可见，真实校验规则待 API 契约定义。
7. **危险动作的二次确认**：看板「广播提示给所有组长」点击后给「已发出 + 全组可见 + 已二次确认」
   的成功条（R8 要求危险动作有影响范围说明），但**没有做真正的确认弹窗**——留给契约阶段定弹窗文案。
8. **模块卡片的统一形态**（可见性徽标 + 状态徽标 + 摘要 + 负责人头像 + 「打开模块」按钮）是
   **我为编排层定义的展示规范**，requirements 只说「统一形态」没给字段。各模块将来只需提供符合
   这个形状的数据。请确认这套字段够不够。

---

## R8/需求线索之间的矛盾，以及怎么处理的

- **「四组并行」升级 vs F963 诚实空态**：00-overview 说要把「四组并行」从 F963 的空态升级为
  真实卡片，**但同一文档的硬前置又说** canvas 束零仓储、素材充足度/介入标记全仓无来源。
  处理：看板/图谱卡片**做出完整骨架**（这是 UI 先行该交付的），但凡无来源字段（进度%、素材充足度、
  倒计时、「需介入」判据）**一律挂 `待补契约`/`待签核` 标记 + `＊` 角标**，不伪装成真数据。
  真实页面在对应契约落地前应沿用 F963 的诚实空态纪律，不渲染编造值。
- **视角切换器「需介入」状态后缀 vs 无来源**：01-viewer-role 要状态后缀，00-overview 说「需介入」
  全仓无来源。处理：后缀照做，但「需介入」带 `＊` 并在菜单脚注说明它是待签核占位；「缺 N 人」
  则如实说明可由分组签到人数推导（有来源）。
- **倒计时**：00-overview 说 `listAgendaSegments` 只给 `{title,state}` 没有剩余时长。
  处理：黑条显示「12:48 剩余＊」，`＊` 注明「无契约字段，需先跟 phase-01 议程束确认是否新增」。

---

## 建议人类在束级 design-signoff.md 第 ① 件签核时重点核对的 3 处

1. **观察者可见范围**（决定 2 + `LC_ROLE_CAN_SEE_STAGE.observer`）——这是唯一影响「谁能看到
   全场原始数据」的安全边界决策，`role-observer-stage-default.png` 是当前默认呈现，必须人类拍板。
2. **无来源字段的清单是否完整**（看板进度%/素材充足度、倒计时、「需介入」判据、本场状态右栏的
   checklist/需要知道/已生成产出）——这些决定了 Phase 10 到底要**新建多少后端契约字段**，
   看 `stage-kanban-default.png` 与 `group-graph-default.png` 里所有带 `待补契约`/`＊` 的位置。
3. **模块卡片统一形态的字段集**（决定 8）——它是编排层与 5 个下游 phase（chat/itv/research/
   survey/KG）的接口契约雏形，形态定错会让 5 个模块都要返工。看任一 `group-*-default.png` 的卡片。

---

## 与 requirements 文档不一致 / 需补充的观察

- requirements 三份 UC 文档一致、无相互冲突；矛盾都发生在「原型想要的效果」与「00-overview 硬前置
  说无来源」之间（已在上一节列出处置）。
- **建议**：requirement-author 生成 `feature_list.json` 时，把本原型里每个 `待补契约` 位置拆成
  一个显式 feature（新建契约字段），并把 `待签核` 点写成 OPEN-QUESTIONS，避免它们在画界面时被
  「顺手创造却无人评审」（这正是 ADR-023 要防的）。
- 本 phase **未触碰** `phase-01-run-a-project/` 或任何其它 phase 的文件；`tab-live.tsx`（F963）
  保持原样未改——这些编排屏是**新增**的 `/preview/live-collab-orchestration` 路由，不替换生产屏。
