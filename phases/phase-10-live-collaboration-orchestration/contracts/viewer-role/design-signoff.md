---
bundle: viewer-role
phase: "10"
covers: [F01, F02]
status: pending
confirmed_by: ""
confirmed_at: ""
scope_note: "首轮签核仅覆盖『主持台·全场 vs 分组』二档切换 + 四角色可见性矩阵；F01 里『需介入』状态后缀因全仓无判据来源，本轮维持 ＊ 待补契约占位，不在本束签核范围内。"
---

# 契约束 `viewer-role` 设计签核

覆盖 feature（**派生视图**，权威是上方 frontmatter `covers:`）：

| feature | 标题（摘） | 点 | 依赖 |
|---|---|---:|---|
| F01 | 视角切换器：主持台·全场 / 分组，含角色锁定与状态后缀 | 3 | — |
| F02 | 角色可见性服务端矩阵（引导师/组长/组员/观察者） | 5 | F01 |

合计 **8 点**。

**依据需求**：`requirements/01-viewer-role.md`（R1 已知硬约束、R2 需要的能力）、
`requirements/00-overview.md`（角色与视角模型）。

**依据裁决**：`requirements/OPEN-QUESTIONS.md` Q1（观察者可见范围，2026-08-20 人类会话已裁决候选 A：
全场只读聚合，不含任何一组原始转写/对话逐字稿）。

---

## ① UI —— 人看到的界面对不对

→ 本束 `ui.md`

✅ **截图已产出**：`phases/phase-10-live-collaboration-orchestration/ui-preview/`
（`viewer-switcher-expanded.png` / `role-member-group-chat.png` / `role-observer-stage-default.png` /
`stage-default-denied.png`）。这批截图来自 ui-prototyper 用真实组件
（`apps/web/components/live-collab/orchestration-preview.tsx`）+ mock 数据搭出的
`/preview/live-collab-orchestration` 路由，不是纯静态图。

🔴 **原型作者自己承认的判断点**（`ui-preview/README.md`「我替 requirements 做了哪些设计决定」1/2/3 条）：
- 分组视角预览时锚定「第 2 组」（示例选择，不影响契约本身）。
- 观察者能看全场（只读）——已按 Q1 裁定确认为最终答案，非占位。
- 组长/组员的视角切换器**直接锁定本组**（不是给一个只有一项的下拉）——本轮签核请确认这个交互形态。

### 签核前请重点确认

- [ ] **Q1 的裁决边界要落到界面上**：观察者能看到聚合进度/摘要，但**不能**看原始转写/对话逐字稿——
      `role-observer-stage-default.png` 目前只展示了全场默认视图，还没有一张截图展示「观察者试图打开
      某组对话逐字稿被拒」的态。这张图缺失，签核时请确认这条边界仅凭文字描述是否足够，
      还是要求补一张图再签。
- [ ] **顶部提示条按角色区分文案**（不是所有角色都显示引导师那句「你有全部权限」）——
      `stage-default-default.png` 只展示了引导师视角的提示条，组长/组员/观察者各自的提示条文案
      需要在 `ui.md` 里逐条列出核对，不能只签「有做区分」这句话。
- [ ] **`denied` 态的触发条件**：`stage-default-denied.png` 展示的是「组员看全场被拒」，
      还需确认「组员看别组」是否走同一个 `denied` 组件还是需要单独的态。

## ② 用例 —— 用例接口与失败模式穷举对不对

→ 本束 `usecases.md`

### 签核前请重点确认

- [ ] **视角/角色判定必须在服务端**：前端只是渲染层，`当前用户能看哪个视角` 这件事要有一个
      服务端接口返回「允许的视角列表 + 每个视角的只读/可写权限」，前端据此渲染切换器选项，
      不能靠前端自己算权限再隐藏 UI。
- [ ] **F01 的『缺N人』状态后缀依赖 F05（分组签到）**，两个 feature 有跨束依赖——
      `group-checkin` 束若改了到场数据模型，本束的状态后缀渲染逻辑要跟着核对。
- [ ] **F01 的『需介入』状态后缀不在本轮签核范围**（frontmatter `scope_note` 已声明），
      界面维持 ＊ 占位，不得在实现阶段偷偷补出一个假判据。

## ③ API 契约 —— 对外形状与错误码对不对

**本束有对外 HTTP 面。** 第 ③ 件的落点是：

```
packages/contracts/src/live-collab-viewer-role.ts   （zod 单一事实源，尚未创建）
```

⚠ **本轮只是骨架，该文件尚不存在**——签核通过后开工时的第一件产出，按 ADR-023 决策一，
属于「第 ③ 件的第一种可接受形态」。

### 签核前请重点确认

- [ ] **一个查询面**：`getViewerOptions(projectId, segmentId?) → { viewers: [...], role, canControl }`——
      这是本束唯一需要的新接口雏形，签核时请确认这个形状是否够用，还是需要拆成
      「查角色」「查可切视角」两个接口。
- [ ] **观察者拒绝路径要有明确错误码**（如 `VIEWER_SCOPE_DENIED`），前端 `denied` 态据此渲染，
      不是靠 HTTP 状态码猜。
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
| `group-checkin`（本 phase） | F01 的「缺N人」状态后缀读 group-checkin 的真实到场数 | 到场数据模型只能在 group-checkin 定义一次，不许本束另建一份 |
| `module-routing`（本 phase） | 角色可见性矩阵同样约束模块侧栏能看到哪些卡片 | 权限判定服务应该是一个共享服务，不许两束各写一套角色判定逻辑 |
| phase-00 identity | 引导师/组长/组员/观察者与项目/分组的成员关系可能已有身份模型可复用 | 实现时先核实是否已存在对应表，不在本 phase 重新定义身份模型本身 |
| phase-01 07-canvas（如 F963 相关代码） | 环节状态条的提示条文案（引导师那句「你有全部权限」）与 F963 已有实现共用同一处 | 不得在编排层复制一份状态条组件 |

---

## 确认动作

人类逐节核对上面三件后，把 frontmatter 的 `status` 改为 `confirmed`，
并填 `confirmed_by` / `confirmed_at`（ISO 8601，**不得晚于签核当下**）。

⚠ **这是人的动作，不是 agent 的。** agent 不得代劳。
在此之前 `new-sprint` 与 `claim` 都会拒绝把 F01/F02 开进 sprint。

⚠ 另需**阶段一致性复核**（`phases/phase-10-live-collaboration-orchestration/design-coherence.md`）
覆盖本束（frontmatter `covers_bundles:` 里要有 `viewer-role`），否则即便本文件签了也不放行。
