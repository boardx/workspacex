# 原始需求索引 — uiux-foundation（Phase 12）

> 本文件夹承接 2026-08-23《WorkspaceX 十分制评估》（综合分 7.2/10）与《十分冲刺 Backlog》，
> 目标是把全站 UI/UX **底座设施**（组件原语、动效 token、可访问性机制、评审证据闭环）
> 提升到十分制评分 10 分。范围锁定基础设施层，不做逐屏视觉微调（那属于各阶段既有的
> `chat-main-fidelity-rubric.md` / `uiux-screenshot-review-profile-org.md` 常规迭代）。

## 建议阅读/开工顺序

十份需求文件按依赖关系排列，前置的组件原语类需求需先落地，后续的稽核/评审类需求
才有稳定的落点可以评估：

| # | 文件 | 一句话 | 依赖 |
|---|------|--------|------|
| 1 | `01-component-primitives-overlays.md` | 收口 dialog/dropdown/select/tooltip 四类弹层原语 | 无 |
| 2 | `02-motion-token-system.md` | 建立语义化动效 token + 1-2 处编排级动效 | 依赖 #1 作接入范例 |
| 3 | `03-keyboard-accessibility.md` | chat/profile/org-admin 核心任务全键盘可达 | 建议在 #1 之后 |
| 4 | `04-third-party-style-guardrail.md` | 第三方组件样式覆盖登记 + lint 关卡，防 CopilotKit 类事故复发 | 无 |
| 5 | `05-image-icon-accessibility.md` | 图片/图标 alt / aria-hidden 补全 | 无，可与 #3/#4 并行 |
| 6 | `06-component-primitives-composites.md` | 收口 table/menu/breadcrumb/pagination 等复合组件 | 依赖 #1 |
| 7 | `07-microinteraction-consistency-audit.md` | 四个域的 hover/focus/active 一致性稽核 | 建议在 #1/#6 之后 |
| 8 | `08-review-evidence-log.md` | rev-uiux 评审结果结构化落盘 | 无，建议在 #9 之前 |
| 9 | `09-screenshot-fidelity-review.md` | chat/profile/org-admin 正式截图级复核 + 视觉密度打磨 | 依赖 #8 的日志结构；建议在多数前置 feature 落地后进行 |
| 10 | `10-final-verification-sweep.md` | 全站终验收官：机械门控 + 十维评分重新计算 | 依赖 1-9 全部 passing |

## 需求 → 功能清单 流水线（不变）
1. 本文件夹全部 `*.md` 是**原始需求（输入/上下文）**，不是权威。
2. 调 **requirement-author** 智能体读取本文件夹全部 `*.md` → 生成/更新 `../feature_list.json`。
3. 权威永远是 `feature_list.json`（带可执行 `verification`）。

## 关于 UI 先行与设计签核
标记「需设计签核」的需求（#1/#2/#6/#9）涉及可见 UI 改动，按 ADR-023：
1. 先由 **ui-prototyper** 用 `apps/web` 真实组件把界面做出来，截图存 `../ui-preview/`；
2. 按能力域切契约束，束目录下写 `contracts/<束>/design-signoff.md`（① UI ② 用例 ③ API 契约）；
3. **人类逐束签核**，再签阶段级 `design-coherence.md`（一致性复核）；
4. 签核完成前，对应 feature 不得开工。

#3/#4/#5/#8/#10 主要是行为修复或纯基础设施，通常不改变可见视觉呈现，是否需要
签核由所属契约束负责人在切束时判断。

## 参照材料
- 《WorkspaceX 十分制评估》（Artifact）——十维评分与结构性缺口分析
- 《十分冲刺 Backlog》（Artifact）——本索引的 IT-01～IT-10 与本文件夹的 10 份需求一一对应
- `.harness/instructions/uiux-standards.md` — U1-U8 完成清单与门控规则
- `.harness/rubrics/chat-main-fidelity-rubric.md`、`uiux-screenshot-review-profile-org.md` — #9 使用的正式评分卡
