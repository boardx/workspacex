# ADR 索引 — 架构决策记录

> 本目录随 agentic-harness 模板分发的是**方法论层 ADR**（与具体业务无关的工程过程
> 决策）。它们源自 BoardX 项目的真实实践——每一份背后都有真实事故或真实收益，
> 叙述里保留了出处案例。你的项目自己的决策从 **ADR-100** 起编号，用
> `.harness/templates/adr.template.md` 起草，头部必须标注`适用层`。

| 编号 | 主题 | 一句话 |
|---|---|---|
| 0001 | record-architecture-decisions | 为什么要写 ADR（实践本身） |
| ADR-001 | per-owner-in-progress | 每个 owner 同时只有一个 in_progress，脚本门控 |
| ADR-002 | shell-deny-screening | 破坏性 shell 命令的拦截清单 |
| ADR-003 | ui-first-signoff-gate | 有 UI 的阶段必须先做真实 UI 经人类确认（门控实际卡在 `new-sprint`，不卡 feature_list 生成；签核位置已被 **ADR-023** 收敛到束级） |
| ADR-004 | issues-as-coordination-bus | 用 issue+label 做多 agent 协调总线（后由专用协调服务演进） |
| ADR-005 | shared-checkout-isolation | 多 agent 共享 checkout 的 worktree 隔离纪律 |
| ADR-010 | agent-org-model | 多级 coordinator 组织模型 + 性能周期 |
| ADR-011 | self-service-identity-registration | 开发者/agent 身份自助注册（人是一等实体） |
| ADR-012 | audit-chain-hardening | 证据审计链：doctor 体检 + 假 passing 防线 |
| ADR-014 | unified-clock-and-loop-discipline | 统一权威时钟 + 分级 loop 纪律 |
| ADR-018 | spec-ref-closed-loop | 每个 feature 必须能追溯到 requirements/ 下一个 story 章节，claim/verify/doctor 三道机械门 + GitHub 投影延伸闭环 |
| ADR-019 | atomic-adr-numbering | ADR 编号原子取号（new-adr 命令），同款根因/修法源自 phase-id 撞号收口 |
| ADR-020 | phase-design-signoff | UC+UI 之外，契约束也须经人类签核；洋葱架构依赖方向由脚本强制；mock 由契约生成。触发条件实为「该阶段有 `contracts/` 目录」而非 `has_ui`；签核件数已被 **ADR-023** 收敛为三件 |
| ADR-021 | context-pack-unlocatable（写正文时补一句话主题描述） | Proposed |
| ADR-022 | evidence 日志带机器指纹 + doctor 进 PR 门控（堵死「手写日志冒充 passing」） | Proposed |
| ADR-023 | unified-signoff | 签核统一为三件（UI / 用例 / API 契约）、一处签（束级 `design-signoff.md`）；束↔feature 映射改结构化 `covers:`；一致性复核须声明 `covers_bundles:`；签核文件受 CODEOWNERS+CI 保护；签核门从 `new-sprint` 扩到 `claim`/`doctor`。**扩展并收敛 ADR-003 与 ADR-020** |
| ADR-101 | provenance-event-type-missing-members | 共享 `provenance` 的**两个**封闭枚举各缺成员，四个束（`files`/`interview`/`project`/`chat`）各撞一次且**四种处理方式**；一次补齐 8 个事件类型 + 2 个 target kind，双向机械门控。**并把只补枚举补不完的 target 维度洞（`projectId` 只活在不可筛的 `detail` 里）列成三条出路，不替人裁。** ⚠ Proposed，触碰已签核的 phase-00 束，**需人类追认**；否决的回退动作写在正文 |
| ADR-100 | fabric-markdown-vendoring-and-version-lock | `fabric-markdown` 源码并入 `packages/`（本仓从此是 owner）；`fabric` / `mermaid` 锁**确切版本**而非 caret；19 个模板 `key` 冻结、`displayName` 单点在契约层；上游回流规程。**项目实现层第一条** |
| ADR-102 | phase-runtime-readiness | feature passing 与 phase runtime/E2E readiness 分离；ready 只由双 evidence 显式门控，doctor 独立复核。**Proposed** |
| ADR-103 | portable-coord-role-runtime | 稳定角色规格单源生成 Claude Code/Codex 表面；PlatformDirectory 以 `(project, stable role)` binding 保持运行时角色 SSOT；broker 只注入所选角色凭据，model 与身份解耦，再以 ULID + 双租约完成 inbox/ACK/handoff。**Proposed；实现拆为 #441–#446，复用 #396/PR #402。** |

## 状态说明
- ADR-004 已被专用协调服务取代（Superseded），保留因为它记录了"为什么 issue 总线
  会到极限"——多数项目会先走到这一步再演进。
- 编号空洞（002 旧序列、006-009、013、015-017）是上游 BoardX 的**项目实现层** ADR，
  未随模板分发；完整清单见上游仓 `docs/adr/`。

## 写新 ADR
1. 复制 `.harness/templates/adr.template.md` 为 `docs/adr/ADR-1xx-<slug>.md`。
2. 头部标`适用层`：方法论（可移植）/ 项目实现（专属）。
3. 在本索引追加一行。决策被推翻时标 Superseded 并链到取代者，不删原文。
