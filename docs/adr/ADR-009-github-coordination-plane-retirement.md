# ADR 009: GitHub 协调面退役——协调权威迁至 coord-service (D1)

> ⚠ **本文件是本地重建，不是上游 BoardX 原文**。`docs/adr/README.md`"状态说明"
> 一节写明 ADR-006~009/013/015~017 是上游 BoardX 的项目实现层 ADR，未随模板
> 分发。本仓 40+ 处（`.harness/instructions/*.md`、`coordinator-lock.ts`、
> `module-lock.ts` 等）反复引用"ADR-009"作为既定决策，其中一处
> （`coordinator-sop.md:175-176`）直接点出文件名
> `docs/adr/ADR-009-github-coordination-plane-retirement.md`——本文件补的正是
> 这个从未被分发进本仓、但被当作既成事实反复引用的空位。
>
> **内容来源**：全仓对"ADR-009"的每一处引用，逐条现场取值、原句摘录后综合
> 而成（见文末"引用来源"）。不是猜测上游原文写了什么，是记录"本仓的代码和
> 文档已经把 ADR-009 当作决定了什么"——这份决定本身已经在跑（D1
> claim/heartbeat/TTL 机制是真实存在的代码，不是本文件新发明的）。如果补上
> 的内容与上游真实原文有出入，以引用来源里代码的真实行为为准，不以本文件的
> 转述为准——发现出入时改这份文件，不要改代码去迁就转述。

- 状态：Accepted（已生效，2026-07-08 起）
- 适用层：项目实现（专属于本仓真实跑过的协调基础设施迁移，不是可移植方法论）
- 关联：取代 ADR-004（issue+label 协调总线）的协调面结论；被 ADR-017（协调权威
  的载体从 coord-service 迁到 coord-gateway）在语义不变的前提下换底层实现；
  ADR-010/ADR-011/ADR-014 建立在本决定之上

## 背景

`ADR-004`（issues-as-coordination-bus）用 GitHub issue + label 做多 agent
协调总线。label 没有 compare-and-swap——两个 agent 抢同一个 issue 的认领时，
两次 `gh issue edit --add-label` 可能都"成功"，产生双认领。这不是理论风险，是
`.harness/instructions/parallel-dev-workflow.md:141-143` 记录的真实原始问题。

## 决策

1. **认领/心跳/退位/租约的唯一权威迁到 coord-service (D1)**，不再是 GitHub
   issue/label。原子性由 D1 `uq_active_claim` 唯一索引保证——两次并发 `POST
   /claims` 恰好一次成功，不再有"都成功"的中间态。
2. **fail-closed，不降级回 GitHub**：权威（D1）联系不上时，`acquire` 直接拒绝
   执行，没有"读不到 D1 就退回读 label"的降级路径。`--force` 仅限人类授权的
   抢占仪式。
3. **GitHub label 心跳机制退役**：`coordination:lease`、
   `coordination:lease:<module>` 等 label 不再是唯一性判据来源；issue/PR
   评论从"协调权威"降级为"叙述层"——历史评论保留可查，但新状态不再从这里
   读写。
4. **无凭据 = 无法参与协调**（`COORD_SERVICE_URL`/`COORD_SERVICE_TOKEN`
   缺失时命令直接报错）是本决策**刻意**的强制换轨设计，不是实现疏漏。
5. **不影响规范平面**：仓库文件（SOP、registry、代码本身）的治理权威不受本决定
   影响（ADR-004 关于"规范平面"的部分继续有效，只有"协调面"被取代）。

## 后果

正面：消灭了 label 认领的竞态窗口；租约新鲜度由服务端 sweeper 按 TTL 机械裁定，
不再依赖巡检会话恰好注意到过期的认领。

负面/需注意：协调完全依赖 coord-service 可达性和凭据分发——本仓当晚（见
`work-cycle-proposal.md:104`）记录过"凭据换轨完成之前，D1 `active_claims`
数据源是空的"这类过渡期问题。

## 引用来源（现场取值，file:line）

`ADR-014-unified-clock-and-loop-discipline.md:8,41`、
`ADR-011-self-service-identity-registration.md:8-10,69`、
`ADR-010-agent-org-model.md:6-7,84,99`、
`.harness/instructions/parallel-dev-workflow.md:141-143`、
`.harness/instructions/agent-bootstrap.md:8,33`、
`.harness/instructions/multi-agent-coordination.md:12-18,61-62,115,177-180`、
`.harness/instructions/human-developer-onboarding.md:41,126,236`、
`.harness/instructions/agent-onboarding-checklist.md:7-11`（该处日期写
2026-07-09，与其余各处 2026-07-08 有一日出入，未强行统一，如实并列）、
`.harness/instructions/loop-design-principles.md:12`、
`.harness/instructions/work-cycle-proposal.md:31-32,91,104`、
`.harness/instructions/coordinator-sop.md:137,145,159,175-176,264`、
`.harness/scripts/coordinator-lock.ts:4,109`、
`.harness/scripts/module-lock.ts:5,9,80`。
