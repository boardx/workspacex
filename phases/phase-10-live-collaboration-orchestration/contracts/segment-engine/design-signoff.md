---
bundle: segment-engine
phase: "10"
covers: [F03, F04]
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-08-20T09:19:24+08:00"
scope_note: "首轮签核覆盖『环节状态条在编排层的复用呈现』+『倒计时字段』的骨架与契约雏形；F04 的倒计时字段本身是跨 phase-01 议程束的契约变更请求，本束只能提出请求、不能单方面拍板对方的契约——见下方『硬阻断』。『第X组需介入』告警判据全仓无来源，维持 ＊ 待补契约占位，不在本束签核范围内。"
---

# 契约束 `segment-engine` 设计签核

覆盖 feature（**派生视图**，权威是上方 frontmatter `covers:`）：

| feature | 标题（摘） | 点 | 依赖 |
|---|---|---:|---|
| F03 | 环节状态条现场呈现（复用 F963）+ 分组视角内的一致展示 | 2 | — |
| F04 | 环节倒计时字段（新增契约，跨 phase-01 议程束） | 3 | F03 |

合计 **5 点**。

**依据需求**：`requirements/00-overview.md#R1`（环节引擎现场呈现，硬前置段落）。

**依据裁决**：本束的两个待办点（倒计时、"需介入"判据）**不在** `OPEN-QUESTIONS.md` 的 5 条已裁决问题里——
`OPEN-QUESTIONS.md` 文末已明确写"环节倒计时字段不是待裁决，是跨 phase 的契约变更请求"，
本文件据此把它当作跨束阻断处理，不是本轮可裁决的开放问题。

---

## ① UI —— 人看到的界面对不对

→ 本束 `ui.md`

✅ **截图已产出**：`phases/phase-10-live-collaboration-orchestration/ui-preview/`
（`stage-default-default.png` 展示黑色状态条常驻在主持台默认视图；`role-member-group-chat.png` /
`role-observer-stage-default.png` 展示状态条在分组/观察者视角下的呈现）。

🔴 **原型作者自己承认的判断点**（`ui-preview/README.md`"我替 requirements 做了哪些设计决定"第 8 条
之外、正文"R8/需求线索之间的矛盾"一节第三条）：
- 倒计时当前渲染 `12:48 剩余＊`，`＊` 标注"无契约字段，需先跟 phase-01 议程束确认是否新增"——
  这不是占位符美化，是**如实标注一个尚不存在的数据源**。
- "第X组需介入"告警 pill 同样标 `＊`，全仓无判据来源，`scope_note` 已声明不在本轮签核范围。

### 签核前请重点确认

- [ ] **状态条是不是同一份组件/同一份数据源**：`stage-default-default.png`（全场）、
      `role-member-group-chat.png`（分组）、`role-observer-stage-default.png`（观察者）三张图
      里的黑色状态条内容是否完全一致（环节 N/M、环节名）——如果不一致，说明编排层可能悄悄
      建了第二份状态副本，这正是 AGENTS.md"同一事实不得声明两处"要拦的情况。
- [ ] **倒计时占位的视觉形态**（`12:48 剩余＊`）在签核时是否可接受作为"过渡态"上线，
      还是必须等 phase-01 议程束真正加字段后才能上线这一整块 UI。

## ② 用例 —— 用例接口与失败模式穷举对不对

→ 本束 `usecases.md`

### 签核前请重点确认

- [ ] **F03 不新建任何"环节当前是什么"的状态**，只读取 F963 已接的
      `listAgendaSegments`/`advanceAgendaSegment`（`apps/web/components/project/tab-live.tsx`）——
      编排层的状态条组件必须是同一份数据的另一种渲染，不是另一次请求出的另一份数据。
- [ ] **F04 的 `getSegmentCountdown` 端口是否应该直接扩展 `listAgendaSegments` 的返回形状**，
      还是新开一个独立端口——这个决定权不完全在本束，需要 phase-01 议程束一起确认，
      本束只能提出诉求形状。

## ③ API 契约 —— 对外形状与错误码对不对

**本束有对外 HTTP 面（且部分字段权属不在本束）。** 第 ③ 件的落点是：

```
packages/contracts/src/live-collab-segment-engine.ts   （zod 单一事实源，尚未创建）
```

⚠ **本轮只是骨架，该文件尚不存在**——签核通过后开工时的第一件产出，按 ADR-023 决策一，
属于"第 ③ 件的第一种可接受形态"。

### 🛑 硬阻断（显著标注，不得弱化）

**F04（倒计时字段）是跨 phase-01 议程束的契约变更请求，不是本 phase 能单方面决定的。**

- `listAgendaSegments` 目前只返回 `{title, state}`，没有剩余时长字段
  （`requirements/00-overview.md#R1` 已确认）。
- 本束签核（即便三件全签）**只解除"编排层想要这个字段"这一层设计意图的确认**，
  不等于 phase-01 议程束已经同意新增该字段、也不等于该字段已经存在。
- F04 的真正开工前置是：phase-01 议程束就"是否新增剩余时长字段"单独给出契约变更的确认
  （走 phase-01 自己的签核流程，不是本束这份文件能替它签的）。
- 在此之前，F04 只能停留在 UI 骨架 + `＊` 占位阶段，**不得渲染编造的倒计时数值冒充真实数据**。

### 签核前请重点确认

- [ ] **状态条端口不重复声明数据**：`getSegmentState`（如需要新端口包装）必须是对
      `listAgendaSegments`/`advanceAgendaSegment` 的**转发**，不是重新查询/缓存出的第二份状态。
- [ ] **`getSegmentCountdown` 的落点归属**：本束提出诉求，最终该字段应该长在
      phase-01 的议程契约里还是本束新开一个只读补充端口，请签核时给出方向性意见
      （即便 phase-01 那边尚未正式确认，也需要本束知道该往哪个方向设计骨架）。

## 支撑材料（不在签核面，但脚本强制存在）

- `domain.md` —— 本束不变量
- `coverage.md` —— feature ↔ 需求文档映射

---

## 本束与哪些束有交叉约束（留给阶段一致性复核）

| 对方 | 交叉点 | 风险 |
|---|---|---|
| `viewer-role`（本 phase） | 状态条在四种角色视角下的降级展示（F963 已删除的 `ROLE_OWN_GROUP`/`ROLE_SEES_ALL_RAW` 需要重新设计） | 不得在编排层为每个角色各建一份状态条样式副本 |
| `group-checkin`（本 phase） | 视角切换器"缺N人"后缀 vs 状态条"第X组需介入" pill——两者都可能读到分组到场数据 | 到场数据模型只能在 group-checkin 定义一次 |
| `module-routing`（本 phase） | F08"本场状态"右侧栏的环节倒计时直接复用 F04 的真实数据源 | F04 未落地前，F08 的倒计时格子必须同样标 `＊`，不得抢先渲染假数据 |
| **phase-01 议程束（07-canvas 或议程所属域，需实现时核实具体归属文件）** | **F04 请求新增剩余时长字段——这是跨 phase 的契约变更请求，本束单方面签核不构成对方同意** | **F04 在对方确认前不得开工对接真实倒计时，只能停 UI 骨架 + `＊` 占位** |
| phase-01 07-canvas（F963 相关代码） | 状态条标题/序号/推进动作的真实数据源就是 F963 已接的 `tab-live.tsx` 调用 | 不得在编排层复制一份"环节当前是什么"的状态 |

---

## 确认动作

人类逐节核对上面三件后，把 frontmatter 的 `status` 改为 `confirmed`，
并填 `confirmed_by` / `confirmed_at`（ISO 8601，**不得晚于签核当下**）。

⚠ **这是人的动作，不是 agent 的。** agent 不得代劳。
在此之前 `new-sprint` 与 `claim` 都会拒绝把 F03/F04 开进 sprint。

⚠ **即便本文件签核通过，F04 仍不能立刻开工对接真实数据**——它还要等 phase-01 议程束
就"是否新增倒计时字段"单独给出确认。两道等待不是同一件事：本束签核确认"编排层这样设计是对的"，
phase-01 的确认才解除"这个字段真的会存在"这一层阻塞。

⚠ 另需**阶段一致性复核**（`phases/phase-10-live-collaboration-orchestration/design-coherence.md`）
覆盖本束（frontmatter `covers_bundles:` 里要有 `segment-engine`），否则即便本文件签了也不放行。
