# Targeted CI Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小范围改动只执行可证明充分的相关回归，降低 PR 与队列关键路径耗时。

**Architecture:** 统一 diff、依赖与风险分析，产出可审计测试计划；先影子运行再逐步接入。第一轮不启用跨 SHA 测试结果复用，保留完整回归基准，先通过并行化提速。

**Tech Stack:** GitHub Actions、TypeScript/Node、Turbo、Vitest、Playwright。

**Spec:** 本文记录用户本轮范围要求：先提供计划；按影响而非代码行数选择测试；支付、权限、迁移保留强制专项；未知范围扩大验证。用户已批准按阶段实施；每阶段完成状态以真实 PR、队列验证与证据为准。

## Global Constraints
- 复用现有会话 worktree；实施前 fetch main/develop，按当时实际 develop 核对文件，禁止重建同一会话 worktree。
- 不改产品业务、生产配置、支付凭据；不降低保护规则，不伪造检查。
- 每个可独立审查的交付单独 issue/PR；先确认 #6059/#6061 实际状态和文件归属，避免冲突。
- 先部署检查 producer 并确认可上报，再切换规则/消费者；旧 PR 明确同步路径。
- 并行前证明数据库、文件、端口、夹具隔离；资源不足时排队，不绕过资源保护。

## Review Focus
- 删除、重命名、缺失 base、浅克隆不能形成空测试计划。
- 共享契约与依赖变化必须覆盖下游；配置和锁文件纳入判定。
- 路径规则无法证明动态依赖完整；未知或未登记路径扩大范围。
- 未执行不等于通过；缓存和日志不能冒充实际测试证据。
- PR head 与 queue candidate 不同；第一轮不得借用跨 SHA 绿灯。

## 文件职责与拟议接口
- 新增 `.harness/config/ci-test-impact.json`：模块输入、依赖、风险和测试套件映射单源。
- 新增 `.harness/scripts/ci-test-plan.mjs` 及测试：读取明确 base/head 和 Git diff，输出计划。
- 复用 `.harness/scripts/ci-change-scope.mjs`，逐步让 billing/skill/board scope 消费统一计划；不立即删除旧入口。
- 计划字段：schemaVersion、baseSha、headSha、policyDigest、changedFiles、affectedModules、risk、suites、reasons、fallback。
- 修改 `harness-verify.yml`、`harness-acceptance.yml`：消费计划、并行执行与完整汇总；保持必需检查名称。
- 独立 runner/helper：分片发现、覆盖核对、证据汇总；不得在 workflow YAML 复制选择策略。
- 影响队列 admission 时同步更新 policy、queue-ready、部署消费者与对应证明测试。

## 阶段 1：基线与影子选择器（一个独立 PR）
- [ ] 记录近期代表性 PR/queue 的排队、准备、测试、清理耗时；报告 p50/p95，样本不足明确标注。
- [ ] 为局部 UI、支付、公共契约、鉴权、迁移、CI、依赖、文档、删除/重命名和未知路径写失败反例。
- [ ] 实现计划 schema、diff/依赖传播、强制专项和未知范围回退。
- [ ] 影子生成并展示计划，现有测试照常执行，不让选择器决定跳过。
- [ ] 对照变更样本和人为植入缺陷，审查是否存在漏选；给出扩大范围的原因。
**验收：** 无静默空计划，所有规则可解释；测试策略输入变化会使计划身份改变。此阶段不承诺提速。

## 阶段 2：完整覆盖下并行提速（单独 PR）
- [ ] 基于耗时与隔离证明给 Web 单测、chat-read 分片，不直接把共享资源测试强行并行。
- [ ] 核对发现测试全集等于分片并集，交集为空；遗漏、重复、空执行、缺产物阻断。
- [ ] 将非 API 测试提前运行；最终汇总仍等待 API 证据，真实依赖不删除。
- [ ] 同候选控制平面验证只保留一个权威 producer；消费者核对当前 attempt 与证据。
- [ ] 衔接 #6061 已批准的失败即停实现，保留日志、清理和失败 verdict。
- [ ] 使用相同覆盖清单比较关键路径与 runner 总分钟，检查资源峰值与失败率。
**验收：** 覆盖不减且耗时下降；只提高机器规格不算唯一解法。分片数以实测确定。

## 阶段 3：按模块接入小规模回归（单独 PR）
- [ ] 从边界清晰的局部 UI 变更开始，再扩展到成熟领域；大包内按领域选择，不仅依赖 Turbo 包级 affected。
- [ ] PR 跑相关单元/集成/E2E；支付、权限、迁移保留强制专项。
- [ ] 队列对实际 candidate 重新计算影响计划，不能无条件复用 PR 结果。
- [ ] 未知影响、共享底层、锁文件和 CI 改动执行广泛或全量回归。
- [ ] 保留全量回归的显式入口；如采用定期执行，明确负责人、失败处置和阻断发布规则后再启用。
- [ ] 调整 queue-ready 的充分性判据及源证据消费者；缺套件、错 SHA、旧 attempt、取消与失败均拒绝。
**验收：** 小改动确实少测，危险改动仍触发必要覆盖；普通 PR 与队列各有耗时分布和漏选反例证据。

## 回滚与目标
- 任一阶段可退回完整选择计划，保持必需检查正常上报，不通过删除规则恢复合并。
- 先保留完整回归基准，证据证明安全后才减少常规执行范围。
- 初步目标：普通局部 PR p50 ≤10分钟、普通候选 p50 ≤20分钟；作为待实测目标，不是承诺，也不适用于全量高风险变更。
- 跨 SHA 内容寻址缓存另立后续设计，第一轮不实施；验证输入闭包与缓存污染边界后再讨论。

## 顺序与进度
```mermaid
flowchart LR
 A[基线与影子选择器] --> B[完整覆盖并行化]
 B --> C[按模块启用小回归]
 classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
 classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
 classDef active fill:#fef08a,stroke:#ca8a04,color:#111827
 class A done
 class B,C active
```

工作量初估：中等规模，约3个实现PR；涉及门禁与测试证据，审查风险高于业务代码行数。耗时需在阶段1完成发现后重新估算。
