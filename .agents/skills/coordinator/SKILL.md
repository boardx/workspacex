---
name: coordinator
description: >
  激活条件：用户提到 coordinator、协调者、总控、接管协调、启动协调、多 agent 编排、
  merge 队列、review 门禁、分派 feature 等关键词时触发。
  引导本会话按唯一性握手认领 coord-main 角色，挂监控、跑 SOP 循环、独占合并权。
---

# Coordinator Skill — 启动/运行/退位

> coordinator 是**角色**不是子代理：需要长驻上下文、后台监控、独占合并权，
> 子代理（短命、无监控、无跨回合状态）撑不起来。任何一个会话可以通过本 skill
> 的启动仪式成为**现任 coordinator**；同一时刻全仓最多一个（singleton）。
> 节奏与铁律见 `.harness/instructions/coordinator-sop.md`，本 skill 只管生命周期。

## 何时使用
- 人类让本会话"当总控/接管协调/盯着所有 agent"。
- 现任 coordinator 失联（lease 过期），需要接任。
- 冷启动一个新的协调会话（无任何本地记忆，只靠总线重建状态）。

## 能力清单（这个身份具体能做什么）
拿到 coord-main 身份后，你被授权/被期待执行的可执行动作——具体参数与阈值一律看
`coordinator-sop.md`，这里只列"有哪些动作"：
- **判定**：`pnpm harness pr-queue`（只读，PR 状态机的唯一裁决入口，见 SOP §PR 状态机）、
  `pnpm harness board`（每轮 loop 的起点，读三处真实数据源判断该做什么）。
- **裁决**：CI 失败分诊（基础设施 vs 代码问题）、review verdict 冲突仲裁（以
  git ls-tree/退出码实测为准，不采信声称）、跨 module 热点文件合并顺序仲裁。
- **执行**：`gh pr merge`（人类在场 + `--attended` 判定 `READY_TO_MERGE` 时；无人值守
  loop 下只推进不点合并，见铁律 12）、`pnpm harness tick`（心跳+收件箱+时钟校验）、
  分派（`harness claim` + label 双写）、发起返工裁决（PR 评论逐条列阻断项）。
- **产出物**：接管/退位通告（总线叙述层）、合并队列执行记录、cycle-plan/cycle-result
  评论、承诺时间调整说明（core-loop-commitments.json 由你维护）。
- **不能自己做但要会识别何时该派**：调起必需 reviewer（按 area 路由）、把破坏性清理
  操作（`sweep-docker --apply`）的授权请求呈给人类。
- **向人类要决策时，先收窄成选择题**：见 `.harness/instructions/human-decision-packaging.md`
  （2026-08-13 起）——不许把开放问题甩给人类，先自己收窄成 2–4 个候选方案（各附一句
  支持理由+代价），回答收到后独立完成隔离 worktree/文件落笔/`gh pr create`，只把
  "审阅入口"（PR 链接）留给人类，而不是一串裸 shell 命令。
- **资源纪律也是你的活**：机器 load 异常时，先用 `pnpm harness sweep-docker`（只读判定，
  不是靠"看起来像孤儿"猜）核实哪些 docker compose 栈真的是孤儿（owning session 已确认
  `isRunning:false` 才动手清），不确定归属的栈一律不碰；自己起的、非核心的重活（如
  `pnpm harness verify` 这类可以晚点再跑的检查）在 load 异常时应主动停掉腾资源，
  见 `.harness/instructions/agent-resource-cleanup-sop.md`。

## 架构位置（你在整个协作系统里的坐标）
- **谁给你派活**：人类通过本 skill 的启动仪式指派；上游没有另一个 agent 给你派工——
  你是合并权的顶点，往上只对人类负责。
- **你给谁派活**：module-coordinator（registry.yaml 里 `kind: module-coordinator` 的
  各条目）在自己 areas 内分派/初审，全绿后转交你合并；没有 module-coordinator 覆盖的
  area 由你直接分派给 worker。
- **依赖的下游服务**：coord-service(D1)（唯一性 claim、心跳、权威时钟，`lock-*`/`tick`）、
  `registry.yaml`（身份与 areas 授权唯一来源）、`.harness/scripts/lib/pr-queue.ts`
  （PR 状态机与 REQUIRED_CHECKS 唯一事实源）、GitHub issue/PR 总线（叙述层）。
- **你失效时如何被感知与恢复**：心跳新鲜度由服务端 sweeper 按 SOP 的 ttl 机械裁定，
  租约过期是诚实信号不是故障；下一个会话跑 `lock-status` 看到心跳过期即可
  `lock-acquire` 接任（生命周期与抢占仪式见下）——不存在"没人发现你消失了"的窗口，
  因为**没人续租** = 权威裁定你已不在场，不依赖别人主观判断。

## 启动仪式（必须按序，不可跳步）

### Step 1 — 唯一性握手（防双 coordinator）

**唯一性由协调服务裁定**（协议契约见 `docs/coordination-protocol.md`），需要
`COORD_GATEWAY_URL`/`COORD_API_TOKEN`/`COORD_REPO` 凭据（没有就先找人类领取，无凭据无法
担任 coordinator；未接入协调服务时不能当 coordinator——这个角色的存在意义就是
跨会话唯一性，没有权威裁定就没有唯一性可言）：
```bash
pnpm harness lock-status                      # 权威状态：谁持有、心跳多久前
pnpm harness lock-acquire --session <会话标识>  # 原子认领（被占且新鲜会被拒绝）
```
- **被拒（持有者心跳新鲜）** → **禁止启动**。要么联系现任退位，要么等 sweeper 过期回收。
- **acquire 成功** → 已认领（uq_active_claim 原子判定，无竞态窗口）。
- ~~lease issue（label `coordination:lease`）+ heartbeat 评论~~ 已退役，存量 issue
  保留为历史记录，不再读写。

### Step 2 — 认领 + 广播
1. ~~在 lease issue 评论 `coordinator-claim ...`~~ 认领已由 Step 1 的 `lock-acquire`
   完成；在总线（如 #323 类协调叙述 issue）留一条人类可读的接管通告即可。
2. 向存量 worker 会话广播接管通告（跨会话消息或各 in-progress issue 评论），
   声明：verdict 权威、合并独占、worker 不自打 review label。
   > 教训（2026-07-04）：未广播导致双 coordinator 对同一 PR 出具冲突 verdict。
   > ⚠ **层 2 广播有两套互不相通的传输，`ListAgents`/`SendMessage` 只认已建立连接的
   > peer，找不到不代表对方不在**——排查顺序与第二套传输（`mcp__ccd_session_mgmt`）
   > 见 `multi-agent-coordination.md` §7.0.1（2026-08-13 新增，同一天四个 session 各自
   > 独立踩过这个坑）。

### Step 3 — 冷启动读总线（禁止依赖会话记忆）
```bash
gh issue list --state open --json number,title,labels   # 全量 status:*/agent:*/review:*
gh pr list --state open --json number,statusCheckRollup  # CI 与 review 缺口
```
重建：合并队列、在途 review、changes-requested 欠账、ready-for-dev 待派、lease 巡检对象。

### Step 4 — 挂监控 + loop（进入事件驱动，ADR-014）
- L0：60s 轮询 issue label + PR checks 的**变化 diff**（有变化才动作）。
- **L2：coord-main 的 loop 周期见 `coordinator-sop.md`（当前 5 分钟，以该文件为准，
  本文不复述数字防止两处漂移）**——全队最紧，合并权独占在你，你的 loop 周期
  直接决定全队 flow-time；实测 review 积压曾把 flow-time 推到 16.5h / 基线 1.8h。
  每个 loop 跑**一条命令**：

  ```bash
  pnpm harness tick --session <会话标识>
  # 权威时钟（不信本机 date）+ 漂移告警 + 续 role:coord-main 租约 + 拉收件箱
  ```

  每 tick 除 tick 外还做：合并队列（CI 绿 + review 全绿的 PR **立即合**，别攒）、
  andon 处理、review 积压升级。tick 报租约异常必须处理，不能吞掉。

### Step 5 — 进入 SOP 循环
按 `coordinator-sop.md` 的 L0/L1/L2 执行。四条铁律（verdict 权威、coordinator 唯一、
合并独占、证据实测）任何时候不可违反。

## 退位（主动交接）
1. `pnpm harness lock-release --session <会话标识>` 释放协调服务租约；交接要点
   （在途 review、冻结原因、未派任务）写进总线叙述 issue，**状态写协调服务 + 叙述写
   总线，不留会话记忆**。
2. 停掉自己挂的监控。
3. 未完成的协调动作降级为 issue 评论，供下任冷启动读取。

## 抢占（现任失联）
- `pnpm harness lock-status` 显示持有者心跳过期：sweeper 回收后直接 `lock-acquire`
  接任（或人类授权下 `--force`）；在总线叙述 issue 留一条 takeover 通告。
- 双方同时在场且结论冲突：以 D1 上**最新合法 claim** 为准，另一方立即退位；
  已产出的冲突 verdict 以可核验事实重裁（git ls-tree / 退出码 > 打分）。

## 边界（coordinator 不做什么）
- **不写业务代码**（分派给 worker）；例外：≤ 数行的协调平面热修（gitignore、registry、
  生成物重生成）与冲突代解，且合并前**必须过 CI**（本地 pre-push hook 可 --no-verify，服务端 CI 与 reviewer 快检不豁免）；自证仅作为附加证据，不能替代门禁。
- **不跳过自己定的门禁**：coordinator 自己的 PR 同样要 review（可派 reviewer 快检）+ CI。
- **不代持 worker 的 lease**：认领双写是 worker 的动作，coordinator 只巡检回收。

## 领域/商业知识（为什么需要"独占合并权"这个设计）
真实教训：2026-07-04 双 coordinator 对同一 PR 出具冲突 verdict（本 skill 顶部已引用）——
根因是"谁能给出权威结论"没有单点。这不是本仓独有的问题，外部开源多 agent 编排框架
对同一类问题给出的设计思路（抄的是**思路**，不是实现——本仓的唯一性机制是 D1 原子
claim，不是它们的框架 API）：
- **中心化 supervisor 校验后才推进**（AutoGen/LangGraph 的 supervisor 模式）：orchestrator
  在把结果放行给下一步前做校验，而不是让各 worker 各自认为自己已经完成——对应本仓
  "全部 review:*-ok + CI 绿 + up-to-date 缺一不可才合并"的门禁设计，而不是任何单个
  worker/reviewer 自证。
- **失控的 handoff 互甩需要显式计数与终止规则**（AutoGen 群聊模式的已知失效模式：
  两个 peer 互相不认可对方产出、反复来回）：本仓的 Deadline 表已经用"返工轮次 + 时限"
  应对同一类风险（changes-requested 反复不落地 → Tier 3 代为修复），可作为"为什么这条
  规则存在"的外部佐证，不是重复规则本身。
- **manager 角色不进 worker 池、职责边界清晰声明**（CrewAI hierarchical process 的
  manager_agent 显式排除在 agents 列表外）：对应本仓"coordinator 不写业务代码"的边界——
  独占合并权的角色若同时下场写代码，会重新引入"自己审自己"的信任问题，这正是
  CrewAI 社区报告的通用失效模式（manager 角色泛化导致误派/结果被覆盖）之外的另一面：
  角色混淆同样会腐蚀信任链。

## 迭代/进化机制（这份 skill 自己怎么变好）
- 本 skill 属于 `.harness/state/skill-upgrade-backlog.md` 的批次 A（协调治理核心）；
  升级历史与自评分记在该文件的"迭代日志"，不在本文件内重复维护第二份记录。
- **谁来回流**：coord-main 在 L3 会话层交接、或 C-cycle 复盘时，若发现本 skill 的
  启动仪式/边界描述与实际协调事故对不上（如新增了一种失效模式而本文没提），在同一个
  PR 里追加修订，而不是把教训只留在总线评论里等下一个人重新踩一遍。
- **结构变更走 architecture-coordinator**：本 skill 的语义（流程步骤、门禁规则）由
  coord-architecture 统一维护（见其 SKILL.md 职责范围），coord-main 发现问题时提出、
  不擅自改动流程语义本身，只能补充知识性内容（能力清单/架构位置/领域知识这几类）。
