---
bundle: module-routing
phase: "10"
covers: [F07, F08]
status: pending
confirmed_by: ""
confirmed_at: ""
scope_note: "首轮签核覆盖分组五模块侧栏（对话/访谈/研究/问卷/图谱）的路由骨架 + 统一卡片形态 + 本场状态右侧栏的骨架。模块卡片统一形态字段集已在 OPEN-QUESTIONS.md Q3 裁决为候选 A（现状默认字段集），本文件按裁决结果编写。F08 的 checklist/需要知道/已生成产出三类字段全仓无契约来源——本轮只签骨架，不签这三类字段的真实数据接入，见下方『硬阻断』。"
---

# 契约束 `module-routing` 设计签核

覆盖 feature（**派生视图**，权威是上方 frontmatter `covers:`）：

| feature | 标题（摘） | 点 | 依赖 |
|---|---|---:|---|
| F07 | 分组五模块侧栏（对话/访谈/研究/问卷/图谱）路由骨架 + 统一卡片形态 | 5 | F01 |
| F08 | 本场状态右侧栏：checklist / 需要知道 / 已生成产出 | 3 | F07 |

合计 **8 点**。

**依据需求**：`requirements/03-module-routing.md#R1`（分组视角五模块侧栏）。

**依据裁决**：`requirements/OPEN-QUESTIONS.md` Q3（模块卡片统一形态字段集，2026-08-20 人类会话
已裁决候选 A：采纳现状默认字段集——可见性徽标+状态徽标+摘要+负责人头像+"打开模块"按钮，
不额外加字段；裁决同时注明"已裁决不等于未来不可能再改"，下游 4 个 phase 的 owner 在各自
实现对接时如果发现这套字段不够用，仍可回来改这份契约）。

---

## ① UI —— 人看到的界面对不对

→ 本束 `ui.md`

✅ **截图已产出**：`phases/phase-10-live-collaboration-orchestration/ui-preview/`
（`group-chat-default.png` / `group-interview-default.png` / `group-research-default.png` /
`group-survey-default.png` / `group-graph-default.png`）。这批截图来自 ui-prototyper 用真实组件
（`apps/web/components/live-collab/orchestration-preview.tsx`）+ mock 数据搭出的
`/preview/live-collab-orchestration` 路由，不是纯静态图。

🔴 **原型作者自己承认的判断点**（`ui-preview/README.md`"我替 requirements 做了哪些设计决定"第 8 条）：
- 模块卡片的统一形态（可见性徽标+状态徽标+摘要+负责人头像+"打开模块"按钮）是原型作者为编排层
  定义的展示规范，requirements 只说"统一形态"没给字段——已按 Q3 裁定确认为最终字段集。

### 签核前请重点确认

- [ ] **5 张 `group-*-default.png` 里卡片形态是否真的一致**：签核时请逐张比对
      `group-chat-default.png`/`group-interview-default.png`/`group-research-default.png`/
      `group-survey-default.png` 四张（图谱模块 `group-graph-default.png` 形态不同，见下条），
      确认字段位置、徽标样式、"打开模块"按钮位置完全统一，不是"看起来差不多"。
- [ ] **`group-graph-default.png`（本组图谱）不是统一卡片形态，而是独立布局**（决策小树 +
      已确认事实/待决），这是否符合 requirements 原意——`03-module-routing.md#R1` 说"点开任意一个，
      中间主区域切换成该模块的卡片列表"，但图谱模块展示的不是卡片列表，签核时请确认这个例外
      是否合理，还是也应该收敛成统一卡片形态外面套一层图谱专属展开。
- [ ] **计数徽标是否来自真实接口**：`03-module-routing.md#R1` 明确"计数从各自模块的真实接口来，
      不是编排层自己维护的字段"——当前 mock 数据的计数是否已标注为待接入真实源，签核时核对
      `apps/web/lib/mock/live-collab-orchestration.ts` 里 `LC_MOCK_MODULE_TABS` 的注释。

## ② 用例 —— 用例接口与失败模式穷举对不对

→ 本束 `usecases.md`

### 签核前请重点确认

- [ ] **本束只做路由与统一卡片形态，不重新实现任一模块内部逻辑**：`与AI的对话`复用 phase-01
      08-chat 已有组件/接口，`用户访谈`复用 phase-07，`深度研究`复用 phase-06，`问卷`复用
      phase-09（含现场投票 F07，注意与本 phase 的 F07 编号相同但含义不同，不要混淆），
      `本组图谱`消费 phase-02 知识图谱数据。签核时请确认这 4 个下游 phase 当前各自的真实
      接口/组件是否已存在，还是本束路由过去时对方也还没实现（这会影响 F07 的实际可开工程度）。
- [ ] **路由跳转必须携带上下文**（`03-module-routing.md` 编排层硬约束）：从任一模块卡片跳转到
      对应模块本体时，必须带上"属于哪个项目哪个分组哪个环节"的标记，不能让用户跳转后失去上下文。

## ③ API 契约 —— 对外形状与错误码对不对

**本束有对外 HTTP 面（且是 5 个下游 phase 的接口契约雏形）。** 第 ③ 件的落点是：

```
packages/contracts/src/live-collab-module-routing.ts   （zod 单一事实源，尚未创建）
```

⚠ **本轮只是骨架，该文件尚不存在**——签核通过后开工时的第一件产出，按 ADR-023 决策一，
属于"第 ③ 件的第一种可接受形态"。

### 🛑 硬阻断（显著标注，不得弱化）

**F08 的 checklist/需要知道/已生成产出三类字段目前全仓无契约来源**
（`requirements/03-module-routing.md#R1` 第 4 点、`00-overview.md` 硬前置段落均已确认）。

- 这不是"待补充细节"，是**字段本身不存在于仓库任何契约/仓储里**——与 F963 处置纪律相同：
  本束在这三类字段补齐契约前，只能维持 UI 骨架 + 明确标注的 mock，**不得渲染编造数据**。
- 本束签核通过（即便三件全签）**不构成这三类字段已经存在的证明**，仍需要一轮独立的契约设计
  （谁来定义 checklist 的勾选来源？"需要知道"提示谁来生成？"已生成产出"列表指向哪个仓储表？）
  才能让 F08 真正开工对接真实数据。

### 签核前请重点确认

- [ ] **`getModuleCards(groupId, moduleKey) → { cards: [{id, visibilityBadge, statusBadge,
      summary, ownerAvatar, openUrl}] }`**——这是本束唯一需要的统一读端口雏形，字段集已按 Q3
      裁定，签核时请确认这个形状是否够用。
- [ ] **`getModuleCounts(groupId) → { chat, interview, research, survey }`**——五模块侧栏的
      计数徽标端口，签核时请确认是否应该拆成各模块各自提供计数（避免本束成为聚合瓶颈），
      还是本束统一聚合一次。
- [ ] **F08 三类字段的契约雏形本轮暂不提出**（硬阻断段落已说明原因），待独立契约设计阶段补齐。
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
| `viewer-role`（本 phase） | 角色可见性矩阵同样约束模块侧栏能看到哪些卡片——组员看不到别组的模块数据，即使猜到 URL | 权限判定服务应该是一个共享服务，不许本束另写一套角色判定逻辑 |
| `segment-engine`（本 phase） | F08"本场状态"右侧栏的环节倒计时直接复用 F04 的真实数据源 | F04 未落地前，本束的倒计时格子必须同样标 `＊`，不得抢先渲染假数据 |
| **phase-01 08-chat / phase-06 / phase-07 / phase-09（跨 phase，4 个下游）** | **模块卡片统一形态字段集（Q3 裁定）是编排层与这 4 个 phase 的接口契约雏形——字段定错，4 个模块未来都要返工各自的列表接口去适配** | **裁决文档已注明"已裁决不等于未来不可能再改"；这几个 phase 的 owner 在各自实现对接时需要一起确认这套字段是否够用，本束不能替它们最终拍板** |
| phase-02 知识图谱（跨 phase） | "本组图谱"模块消费 phase-02 的知识图谱数据；phase-02 目前 `not_started` | 图谱模块在 phase-02 对应契约束签核前只能是 UI 骨架 + mock，与 `stage-aggregation` 束的硬阻断同源但范围不同（本束只涉及分组视角的图谱卡片，`stage-aggregation` 涉及全场聚合视图） |

---

## 确认动作

人类逐节核对上面三件后，把 frontmatter 的 `status` 改为 `confirmed`，
并填 `confirmed_by` / `confirmed_at`（ISO 8601，**不得晚于签核当下**）。

⚠ **这是人的动作，不是 agent 的。** agent 不得代劳。
在此之前 `new-sprint` 与 `claim` 都会拒绝把 F07/F08 开进 sprint。

⚠ **F08 的 checklist/需要知道/已生成产出三类字段即便本文件签核通过也不能立刻对接真实数据**——
这三类字段需要独立的契约设计（不在本轮三件套范围内），本束签核只解除"UI 骨架该长什么样"
这一层，不解除"这些字段到底来自哪里"这一层。

⚠ 另需**阶段一致性复核**（`phases/phase-10-live-collaboration-orchestration/design-coherence.md`）
覆盖本束（frontmatter `covers_bundles:` 里要有 `module-routing`），否则即便本文件签了也不放行。
