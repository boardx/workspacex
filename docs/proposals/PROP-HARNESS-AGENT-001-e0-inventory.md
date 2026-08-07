# H3A-002 — Role/Agent/Domain/Skill/Worker inventory（含旧名）

> Epic E0 交付物。一个 subagent 广度扫描，方法：直接读源文件 + grep，不转述。
> 只报现状，不设计。完整引用见下；这里是综合结论。

## 🔴 最先要看的一条：ADR-009、ADR-017 作为"权威"被引用，但文件不存在

`ls docs/adr/` 实测确认：本仓只有 ADR-001~005、010~012、014、018~023、100~104，
**没有 ADR-006/007/008/009/013/015/016/017**。但：

- `ADR-010-agent-org-model.md` 自己的前言和 §4.1 依赖 ADR-009 作为身份/lease/claim
  权威；
- `.harness/instructions/agent-bootstrap.md:7-8,31`、`multi-agent-coordination.md:
  12,18,61-62,115` 反复引用 ADR-009；
- **本提案自己的文件头**（`PROP-HARNESS-AGENT-001.md:10`）写"建立在：ADR-009、
  ADR-010、ADR-103..."；
- `.harness/scripts/lib/lock.ts:11-17`、`module-lock-state.ts:1-8`、
  `module-lock.ts:4-7` 三处代码注释引用"ADR-017 割接"作为当前 lease 权威从
  coord-service(D1) 移到 coord-gateway/RepoHub DO 的依据。

**这不是本次扫描的误判，是真实断链**：无论 ADR-009/017 曾经存在过又被删/改号，
还是从未真正建过文件只是口头/聊天里定的、只留下了引用，现状是——**本仓当前
没有任何单一可读文件，权威地说明"身份/lease 系统今天到底跑的是哪一套"**。
这件事本身要先解决，H3A-005（依赖 002）和后续任何 Role/Agent schema 工作
（H3A-020+）都不该继续在这个断链上叠新东西。

## Roles：两套注册表，同一事实各写一份

- `.harness/agents/roles/*.yaml`（6 个文件，`gen-subagents` 的输入源）
- `.harness/agents/registry.yaml`（10 个身份 + 2 个 module-coordinator，其中
  `coord-chat-e2e`、`coord-agent-auth`、`dev-platform-baseline`、`dev-auth`
  **只在 registry 里，没有对应的 roles/*.yaml**，即没有 Claude/Codex 双表面
  生成——本提案 §2.1 表格声称"已有"的这项能力，实测只对 10 个身份里的 6 个成立）

同一角色的 `areas`/`reports_to` 在两处各写一份（`dev-ai-runtime`/`dev-chat-e2e`/
`coord-architecture`/`rev-feature`/`rev-e2e` 逐一核对，见 agent 完整报告的
file:line）。`coord-main` 的职责更夸张：`registry.yaml` + `roles/coord-main.yaml`
+ `.agents/skills/coordinator/SKILL.md` + 整份 `coordinator-sop.md` +
`ADR-010` 的表格，**五处**各写一份同一件事（"coord-main 独占合并权"）。

module-coordinator 的职责同样是**四处**重复（registry.yaml 责任列表 + ADR-010
表格与散文 + `module-coordinator/SKILL.md` + `coordinator-sop.md:280-291`）——
本提案 §2.2 第 1 条自己点名的这个问题，扫描后发现比原文描述的更普遍。

## Agents（运行时身份）：概念早于实现，且实现已经换过一次权威

- 6 个 registry 条目有 `directory_agent_id: agt_01...` 字段，但全部
  `active: false`，且都带 2026-08-04 的人工标注"没有任何在跑的会话"——
  **今天没有一个真正活跃的 Agent Runtime Instance**。
- 权威从 coord-service(D1) 到 coord-gateway/RepoHub DO 的迁移（"ADR-017"）
  已经在代码里生效，但由于 ADR-017 文件不存在，这次迁移**没有可读的决策记录**，
  只能从三处脚本注释拼凑。
- `registry.yaml` 头部写"改动走 PR review"（人工维护单一事实源），
  `ADR-011`（status: Proposed，未 Accept）却主张 registry.yaml 应该降级成
  D1 派生的只读快照——两份文件对"registry.yaml 是不是权威"给出矛盾答案，
  当前实现走的是前者（人工维护）。

## Domains：四个信号源，互相不对齐

| 信号源 | 看到的边界 |
|---|---|
| `.harness/state/module-lock-*.json`（6 个文件） | agent / auth / canvas / chat / recording / skills |
| `registry.yaml` 的 `areas:` | `coord-chat-e2e` 一个协调者管 `[chat,agent,skills,canvas,recording,e2e]` 六个 |
| `.agents/skills/mod-*/` | 只有 `mod-_template` 骨架，**0 个真实模块知识库** |
| `project/PROJECT.md` "模块清单" | 占位符 `<模块A>/<模块B>/…` 从未填写 |

对照本提案 §8.1 建议的 9 个核心模块：只有 `identity/auth`（对应
`coord-agent-auth`）和 `contract/control-plane`（对应 `coord-architecture`）
接近"边界清晰、单一 owner"；`collaboration/realtime` **今天完全不存在**
（零 lock 文件、零 registry area、零 skill）；`e2e` 被 `rev-e2e` 和
`coord-chat-e2e` **同时**声称为自己的 area，违反本提案自己那条"同一权威事实
必须只有一个 owner domain"。

## Skills：0/9 核心域有真实 Domain Skill；staleness 今天不可判定

18 个 `SKILL.md`，17 个是工作流/角色 skill，1 个是 `mod-_template` 骨架本身
（明确标"勿直接激活"）。**没有任何一个真实的 `mod-<domain>/SKILL.md` 存在**——
本提案 §2.1 表格"只有骨架，核心模块未全覆盖"的措辞比实际情况乐观：不是部分
覆盖，是零覆盖。

18 个文件全部 grep 不到 `last_verified`/`freshness` 字段——H3A-015（Skill
freshness gate）今天完全没有输入数据可判定，是从零开始建，不是加强已有信号。

## Workers/Subagents：`dispatch_authority`/深度限制目前只是设计意图，不是实现

`.harness/agents/*.yaml`（8 个扁平 subagent spec，与 `roles/` 子目录里的
持久角色是两套不同 schema）**没有一个带 `dispatch_authority` 字段**——这个
字段只存在于 6 个持久角色文件里，且只有 `coord-main`/`coord-architecture` 为
`true`。全仓搜索"第四层"/"递归"/"depth"限制的散文规则，`.harness/instructions/`
与 `.harness/agents/` 下**零命中**——本提案 G1"最大派生深度固定为三层"今天
没有任何形式的强制，纯粹是设计阶段的目标，不是已有约束的形式化。

被派生的 subagent 今天**不注册**——`context_isolation: true` 只隔离上下文窗口，
`gen-subagents.ts` 和 subagent yaml 本身都没有向 D1/gateway 登记的调用。这正是
`ADR-010` 自己"实现状态与差距"一节承认的缺口，但**同一份 ADR 文件的决策正文**
又把"子 agent 必须登记"写成已生效的硬要求——一份文件内部自相矛盾，不是跨文件
重复。

## 交给 H3A-005 的结论

不是"发现了很多琐碎重复"，是三条结构性的：

1. **身份/lease 权威链断了**（ADR-009/017 不存在），任何新 Role/Agent schema
   工作动手前，这条断链需要先被人类看见并决定怎么处理（回填 ADR，还是承认
   现状用代码注释当权威，二选一）。
2. **域边界的粒度在四个信号源里互不一致**，"核心模块 inventory" 不能从任何
   单一现有源直接读出，需要人类做一次真正的裁决（同本提案 §8.1 自己写的
   "最终清单必须…由人类签核，不能直接把本建议当作已接受注册表"）。
3. **"已经决定"和"已经实现"在现有文档里经常混在一句话里**（ADR-010 内部
   自相矛盾就是最集中的例子）——本提案自己的分层交付物设计（先 schema 后
   gate 后 pilot）如果不想重蹈这个问题，backlog 执行时每一条完成契约都要
   真的对着代码验一遍，不能对着 ADR 原文的措辞打勾。

---

方法：1 个 subagent 广度扫描 + 现场 grep/文件读取核实（含 `ls docs/adr/` 独立
复核），2026-08-07。
