---
bundle: stage-aggregation
phase: "10"
covers: [F09, F10]
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-08-20T09:19:24+08:00"
scope_note: "首轮签核仅覆盖主持台·看板聚合视图骨架 + 主持台·知识图谱决策推演聚合视图骨架——两个 feature 都明确停在『UI 骨架 + 诚实占位』阶段。本束即便三件（UI/用例/API 契约）全部签核通过，F09/F10 仍然完全无法对接真实数据，因为它们消费的全部是 phase-02 的领域模型，而 phase-02 目前整体 not_started、contracts/ 只签了 survey 一个束。这是本 phase 十个 feature 里依赖最重的两个，签核这件事本身不解锁真正开工，见下方『硬阻断』（显著标注，不得弱化）。"
---

# 契约束 `stage-aggregation` 设计签核

覆盖 feature（**派生视图**，权威是上方 frontmatter `covers:`）：

| feature | 标题（摘） | 点 | 依赖 |
|---|---|---:|---|
| F09 | 主持台·看板聚合视图骨架（4 组实时卡片 + 广播） | 5 | F01 |
| F10 | 主持台·知识图谱决策推演聚合视图骨架 | 5 | F01 |

合计 **10 点**。

**依据需求**：`requirements/03-module-routing.md#R2`（主持台·全场三视图聚合，看板 + 知识图谱两节）、
`requirements/00-overview.md`（硬前置：phase-02 知识图谱/看板领域模型 `not_started`）。

**依据裁决**：本束不涉及 `OPEN-QUESTIONS.md` 的 5 条已裁决问题——本束的阻塞点不是"方案未定"，
是"对方阶段还不存在"，两者是完全不同性质的阻塞，不适用同样的解除方式。

---

## 🛑🛑 硬阻断（本束最重要的一条，显著标注，不得弱化）

**F09/F10 消费的是 phase-02 的领域模型，phase-02 目前整体状态 `not_started`，
`contracts/` 目录下只有 survey 一个束签过核，看板/知识图谱相关的束（对应 phase-02 的
F02/F11/F15/F16/F17）连契约设计都还没开始，更谈不上人类签核。**

- **F09**（看板）消费 phase-02 F02（看板领域数据）+ phase-01 canvas/recording 束的实时引述数据。
- **F10**（知识图谱决策推演）消费 phase-02 F11（知识图谱节点/关系领域模型）/F15/F16（决策树模型/
  AI 不可写入闸门）/F17（下一步可开展的工作派发）。
- **本束的 design-signoff 三件套即便全部签核通过，也只解决"编排层这两个聚合视图的骨架/路由/
  展示形态应该长什么样"——完全不解决"数据从哪里真实地来"这个问题**，因为数据的领域模型
  根本还没被设计出来，本束没有东西可以对接。
- ui-preview 已经诚实地交付了这个状况本身的一个态：`stage-kanban-dep-failed.png`
  （"依赖失败：phase-02 未签，看板停骨架"）——这不是一个需要修的 bug 展示，是**如实呈现
  当前依赖关系的正确行为**，签核时不应该要求把这个态"做好看一点"或者"先接个假数据"。
- **正确的开工顺序**：① 本束三件套签核（确定骨架/路由/展示形态） → ② phase-02 对应的
  看板束、知识图谱束各自完成契约设计并经人类签核 → ③ F09/F10 才能从"骨架 + 诚实占位"
  升级为"对接真实数据"。**第①步做完不代表可以跳到第③步**，中间的第②步是本 phase 无法
  加速、也无法替 phase-02 完成的独立工作。

---

## ① UI —— 人看到的界面对不对

→ 本束 `ui.md`

✅ **截图已产出**：`phases/phase-10-live-collaboration-orchestration/ui-preview/`
（`stage-kanban-default.png` / `stage-kanban-dep-failed.png` / `stage-kanban-success.png` /
`stage-graph-default.png` / `group-graph-default.png`）。这批截图来自 ui-prototyper 用真实组件
（`apps/web/components/live-collab/orchestration-preview.tsx`）+ mock 数据搭出的
`/preview/live-collab-orchestration` 路由，不是纯静态图。

🔴 **原型作者自己承认的判断点**（`ui-preview/README.md`"R8/需求线索之间的矛盾"第一条）：
- "四组并行"从 F963 空态升级为真实卡片这件事，本身就与硬前置（canvas 束零仓储、
  素材充足度/介入标记全仓无来源）冲突——处理方式是骨架做完整、无来源字段一律挂
  `待补契约`/`待签核` + `＊` 角标，不伪装成真数据。这条方针本束延续。

### 签核前请重点确认

- [ ] **`stage-kanban-dep-failed.png` 这个"依赖失败"态是否要在真实产品里长期保留**：
      在 phase-02 看板束签核前，这应该是用户能看到的真实状态（不是仅测试用的态），
      签核时请确认这个诚实空态的文案/视觉是否可以直接上线。
- [ ] **`stage-kanban-success.png`（广播成功反馈）与真实数据无关，是否可以先行签核上线**——
      "广播提示给所有组长"这个动作本身（不涉及看板实时卡片数据）是否依赖 phase-02，
      如果不依赖，这部分功能是否可以独立于硬阻断先落地。
- [ ] **`stage-graph-default.png`/`group-graph-default.png` 是否也应该有一张"依赖失败"态截图**——
      当前只有看板视图（`stage-kanban-dep-failed.png`）交付了这个诚实空态，图谱视图（F10）
      同样依赖 phase-02 却没有对应的"依赖失败"态截图，这是一个真实缺口，见 `ui.md`。

## ② 用例 —— 用例接口与失败模式穷举对不对

→ 本束 `usecases.md`

### 签核前请重点确认

- [ ] **F09/F10 的"广播"/"开展"等编排层自身动作（不读 phase-02 数据的部分）能否独立签核开工**：
      比如"广播提示给所有组长"这个动作本身、"点开展派发工作"的路由动作，是否可以先实现
      骨架和交互反馈，只是暂时没有真实卡片数据可看——这样能让本束不完全被 phase-02 卡死。
- [ ] **依赖失败态的判定逻辑**：前端怎么知道"phase-02 看板束还没签"——是硬编码的
      feature flag，还是查询某个签核状态接口，签核时请给方向性意见。

## ③ API 契约 —— 对外形状与错误码对不对

**本束有对外 HTTP 面（但绝大部分字段权属在 phase-02）。** 第 ③ 件的落点是：

```
packages/contracts/src/live-collab-stage-aggregation.ts   （zod 单一事实源，尚未创建）
```

⚠ **本轮只是骨架，该文件尚不存在**——签核通过后开工时的第一件产出，按 ADR-023 决策一，
属于"第 ③ 件的第一种可接受形态"。**且该文件在 phase-02 对应契约未签之前，绝大部分字段
只能是空壳/占位类型，不能声明真实的看板卡片/决策树节点形状**（那属于 phase-02 的契约单源，
本束不能抢先定义，否则就是"同一事实声明在两处"）。

### 签核前请重点确认

- [ ] **`getKanbanBoard`/`getDecisionGraph` 两个端口本轮只能是空壳雏形**（返回
      `{ ready: false, blockedBy: "phase-02" }` 这类诚实的"未就绪"响应），真实的看板卡片字段
      （当前议题/时间戳/AI 摘要引述/进度条）、决策树节点字段（领先/在议待决/冲突/已否决/待验证）
      **必须由 phase-02 对应束的契约文件单一定义**，本束只引用，不重新声明。
- [ ] **`broadcastToGroupLeads`（广播动作）与 `dispatchNextWork`（开展动作）是本束独立可定义的端口**
      （不读 phase-02 数据，只是触发一个通知/任务派发动作）——这两个可能可以不受硬阻断影响，
      签核时请确认是否可以先行定义并开工。
- [ ] **mock 必须从契约生成，不许手写**——当前 `apps/web/lib/mock/live-collab-orchestration.ts`
      是手写 mock（ui-prototyper 阶段允许），契约文件建出来之后要收敛成从 schema 生成，
      不许两份并存漂移。

## 支撑材料（不在签核面，但脚本强制存在）

- `domain.md` —— 本束不变量
- `coverage.md` —— feature ↔ 需求文档映射

---

## 本束与哪些束有交叉约束（留给阶段一致性复核）

| 对方 | 交叉点 | 风险 |
|---|---|---|
| `viewer-role`（本 phase） | 只有引导师能看到主持台·全场视角，因此只有引导师能看到本束这两个聚合视图 | 权限判定复用 viewer-role 束的共享服务，不另写一套 |
| `module-routing`（本 phase） | "本组图谱"（module-routing 束的一部分）与本束的"知识图谱·决策推演"聚合视图都消费 phase-02 知识图谱数据，但粒度不同（分组 vs 全场） | 两束都要等 phase-02 对应契约签核，且不得各自对 phase-02 的数据形状做出不一致的假设 |
| **phase-02（跨 phase，硬阻断本体）** | **F09 消费 phase-02 F02（看板）；F10 消费 phase-02 F11/F15/F16/F17（知识图谱/决策树/工作派发）——phase-02 整体 `not_started`，`contracts/` 只签了 survey 一个束** | **这是本 phase 十个 feature 里最重的外部依赖；本束签核不能、也不应该被误读为"可以开工对接真实数据了"** |
| phase-01 canvas/recording 束（跨 phase） | 看板卡片的"一句 AI 摘要引述"消费 canvas/recording 束的实时数据；canvas 束契约已签但零 controller/零仓储实现（F963 notes 已记录） | 即便 phase-02 看板束签了，这部分引述数据仍可能因 canvas 束零实现而继续停留骨架态——两个依赖是独立的，不要因为解决了一个就误以为都解决了 |

---

## 确认动作

人类逐节核对上面三件后，把 frontmatter 的 `status` 改为 `confirmed`，
并填 `confirmed_by` / `confirmed_at`（ISO 8601，**不得晚于签核当下**）。

⚠ **这是人的动作，不是 agent 的。** agent 不得代劳。
在此之前 `new-sprint` 与 `claim` 都会拒绝把 F09/F10 开进 sprint。

⚠⚠ **再次强调**：本束签核通过后，F09/F10 依然不能对接真实数据，必须等 phase-02 对应的
看板束、知识图谱束各自完成契约设计并经人类签核。如果人类在签核本束时希望"顺便解锁开工"，
请明确知道这做不到——两个阻塞点是独立的，本束的签核动作解除不了 phase-02 那边的阻塞。

⚠ 另需**阶段一致性复核**（`phases/phase-10-live-collaboration-orchestration/design-coherence.md`）
覆盖本束（frontmatter `covers_bundles:` 里要有 `stage-aggregation`），否则即便本文件签了也不放行。
