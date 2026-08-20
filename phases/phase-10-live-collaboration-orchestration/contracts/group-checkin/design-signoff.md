---
bundle: group-checkin
phase: "10"
covers: [F05, F06]
status: pending
confirmed_by: ""
confirmed_at: ""
scope_note: "首轮签核覆盖分组签到聚合视图（4 组卡片网格）+ 到场状态写入/二维码/加入页出口三个新出口。到场判定口径、二维码生成方式、看加入页目标均已在 OPEN-QUESTIONS.md Q2/Q4/Q5 裁决为候选 A，本文件按裁决结果编写，不是再重新开放讨论——但裁决只解除『方案未定』这一层阻塞，design-signoff 三件套仍需人类正式签核。"
---

# 契约束 `group-checkin` 设计签核

覆盖 feature（**派生视图**，权威是上方 frontmatter `covers:`）：

| feature | 标题（摘） | 点 | 依赖 |
|---|---|---:|---|
| F05 | 分组签到聚合视图（4 组卡片网格 · 复制链接 · 成员到场列表） | 5 | — |
| F06 | 到场状态写入与二维码/加入页出口 | 3 | F05 |

合计 **8 点**。

**依据需求**：`requirements/02-group-checkin.md`（R1 用户故事、R2 需要人类确认的点）、
`requirements/00-overview.md`（本束是全仓库全新领域，此前无任何 UC/feature 提到过）。

**依据裁决**：`requirements/OPEN-QUESTIONS.md` Q2（到场判定口径，2026-08-20 人类会话已裁决候选 A：
点过加入链接即到场，不做心跳/在线判定）、Q4（二维码生成方式，已裁决候选 A：前端本地生成，
不新增后端接口）、Q5（"看加入页"按钮目标，已裁决候选 A：站内预览，不离开现场协作 Tab）。

---

## ① UI —— 人看到的界面对不对

→ 本束 `ui.md`

✅ **截图已产出**：`phases/phase-10-live-collaboration-orchestration/ui-preview/`
（`stage-checkin-default.png` / `stage-checkin-empty.png` / `stage-checkin-invalid.png`）。
这批截图来自 ui-prototyper 用真实组件（`apps/web/components/live-collab/orchestration-preview.tsx`）+
mock 数据搭出的 `/preview/live-collab-orchestration` 路由，不是纯静态图。

🔴 **原型作者自己承认的判断点**（`ui-preview/README.md`"我替 requirements 做了哪些设计决定"第 4/5/6 条）：
- "到场"判定口径取"点过加入链接即到场"这个默认——已按 Q2 裁定确认为最终答案，非占位。
- 二维码/"看加入页"按钮做出来了但只占位，未实现任一具体方案——Q4/Q5 已裁定，实现时按裁决落地。
- 校验失败的具体触发（"组未指定组长 → 无法签发链接"）是原型作者编的合理场景，
  真实校验规则待本束 API 契约定义，签核时请确认这个触发条件是否是产品真正想要的规则，
  还是只是为了让 U3 态可见而编的示例。

### 签核前请重点确认

- [ ] **"已到/未到"这个二值状态是否足够**：Q2 裁定"点过链接即到场"后不做心跳，意味着参与者
      点开链接后立刻退出也会被记为"已到"——`stage-checkin-default.png` 的卡片只展示二值状态，
      没有"最近一次进入"这类补充信息（这是 Q2 候选 C 的做法，已被否决），签核时请确认这个简化
      是否可接受，还是需要在 UI 上加一句免责说明。
- [ ] **`stage-checkin-invalid.png` 的校验失败场景是否要保留**：这是原型作者编的示例场景，
      不是需求原文点名的规则，签核时请确认这条校验规则本身要不要保留、要不要改。
- [ ] **二维码/看加入页两个按钮从占位变真实功能后的视觉形态**：`stage-checkin-default.png` 目前
      只展示按钮存在，没有一张图展示二维码弹出/站内预览打开后的具体样子，签核时请确认仅凭
      Q4/Q5 的文字裁决是否足够开工，还是要求补图再签。

## ② 用例 —— 用例接口与失败模式穷举对不对

→ 本束 `usecases.md`

### 签核前请重点确认

- [ ] **本束不重新定义免注册进场的链接生成/校验逻辑**——那是
      `phases/phase-01-run-a-project/requirements/01-auth/uc-1-2-用分组链接免注册进场.md` 已 spec 过、
      归 phase-00/01-auth 所有的能力域，本束只消费它。签核时请确认该能力域当前是否已有可调用的
      真实接口（而不是仅有 spec 没有实现），如果实现缺失，本束的 F06 会连带被阻塞。
- [ ] **"到场"写入事件与"缺N人"状态后缀的关系**：`viewer-role` 束的 F01 状态后缀依赖本束的
      真实到场数，两束之间是单向依赖（viewer-role 读 group-checkin 的数据），不是互相定义。

## ③ API 契约 —— 对外形状与错误码对不对

**本束有对外 HTTP 面。** 第 ③ 件的落点是：

```
packages/contracts/src/live-collab-checkin.ts   （zod 单一事实源，尚未创建）
```

⚠ **本轮只是骨架，该文件尚不存在**——签核通过后开工时的第一件产出，按 ADR-023 决策一，
属于"第 ③ 件的第一种可接受形态"。

### 签核前请重点确认

- [ ] **两个查询/写入面**：`getGroupCheckinBoard(projectId) → { groups: [{no, name, joinUrl,
      members: [{name, roleBadge, arrived}], missingCount}] }`（读）+ `recordCheckinEvent(groupId,
      userId)`（写，由参与者点击加入链接时触发，消费 phase-01 01-auth 的链接校验结果）——
      签核时请确认这个形状是否够用。
- [ ] **二维码不经过后端**（Q4 已裁定前端本地生成），因此契约文件里**不应该**出现二维码生成接口——
      签核时请确认这条边界写清楚了，不要在实现阶段误加一个不需要的后端接口。
- [ ] **"看加入页"是站内预览**（Q5 已裁定），意味着契约里可能只需要一个"取参与者视角预览数据"
      的只读端口，不需要一个真实可跳转的独立 URL——签核时请确认这条边界。
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
| `viewer-role`（本 phase） | F01 的"缺N人"状态后缀读本束的真实到场数 | 到场数据模型只能在本束定义一次，viewer-role 不许另建一份；本束若改到场数据模型，viewer-role 的状态后缀渲染逻辑要跟着核对 |
| `segment-engine`（本 phase） | 状态条"第X组需介入" pill 与本束的到场/成员数据可能有重叠语义（"需介入"≠"未到场"，但都涉及分组状态） | 两者判据不同，不得混用；本束只负责"到场"这一个语义 |
| phase-00/01-auth（跨 phase） | 免注册进场的链接生成/校验机制归其所有，本束只消费不重造 | 实现前需核实该能力域是否已有真实可调用接口，若只有 spec 无实现，F06 会连带受阻 |
| phase-01 01-auth uc-1-2 | 参与者点开链接进入分组视角的入口逻辑与本束"到场"事件写入的触发时机必须对齐 | 不得在本束另建一套"进场"判定，要复用对方已有的进场事件（如果有）或明确本束新增的写入点 |

---

## 确认动作

人类逐节核对上面三件后，把 frontmatter 的 `status` 改为 `confirmed`，
并填 `confirmed_by` / `confirmed_at`（ISO 8601，**不得晚于签核当下**）。

⚠ **这是人的动作，不是 agent 的。** agent 不得代劳。
在此之前 `new-sprint` 与 `claim` 都会拒绝把 F05/F06 开进 sprint。

⚠ 另需**阶段一致性复核**（`phases/phase-10-live-collaboration-orchestration/design-coherence.md`）
覆盖本束（frontmatter `covers_bundles:` 里要有 `group-checkin`），否则即便本文件签了也不放行。
