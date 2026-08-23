# Sprint 12/01 — 十分冲刺第一批：组件原语/动效基础/可访问性/治理基础设施（F01-F16，F17/F18 因依赖排期另议不纳入本 sprint）

- **所属阶段**: Phase 12 (uiux-foundation)
- **创建于**: 2026-08-23 10:27:28

## 本 sprint 目标
十分冲刺第一批：组件原语/动效基础/可访问性/治理基础设施（F01-F16，F17/F18 因依赖排期另议不纳入本 sprint）

## 领取的 feature(引用自阶段权威清单,按 id)
- F01 (Pundefined, component-primitives) — 统一的 Dialog / Dropdown 弹层原语落地，全站弹窗观感一致
- F02 (Pundefined, component-primitives) — 统一的 Select / Tooltip 弹层原语 + kitchen-sink 展示区
- F03 (Pundefined, motion) — 语义化动效 token 体系 + lint 拦截裸 duration/easing
- F04 (Pundefined, motion) — 1-2 处编排级动效 + prefers-reduced-motion 降级
- F05 (Pundefined, a11y) — chat / profile 核心任务全键盘可达
- F06 (Pundefined, a11y) — org-admin 核心任务全键盘可达 + axe-core keyboard 扫描接入 CI
- F07 (Pundefined, guardrail) — 第三方组件样式覆盖登记表 + lint 关卡（防 CopilotKit 类事故复发）
- F08 (Pundefined, a11y) — 图片/图标可访问性标注补全 + U7a 规则覆盖 next/image
- F09 (Pundefined, component-primitives) — 复合组件收口：Table / Menu 原语落地
- F10 (Pundefined, component-primitives) — 复合组件收口：Breadcrumb / Pagination 原语 + kitchen-sink 展示
- F11 (Pundefined, microinteraction) — chat / profile 微交互一致性稽核与整改
- F12 (Pundefined, microinteraction) — org-admin / canvas 微交互一致性稽核与整改
- F13 (Pundefined, governance) — rev-uiux 评审结果结构化落盘 + 历史回填 + Top5 扣分维度统计
- F14 (Pundefined, fidelity-review) — chat 主屏截图级保真度评审达标（≥9）并落盘
- F15 (Pundefined, fidelity-review) — profile / org-admin 截图级保真度评审达标（≥9）并落盘
- F16 (Pundefined, governance) — 全站终验收官：机械门控全绿 + 十维评分重算并附证据

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 12/01` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
