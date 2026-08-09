---
name: mod-coord-platform
description: >
  协调平台（coord-platform）的活知识库：RepoHub/PlatformDirectory 两个
  Durable Object、CoordBrain 决策引擎、反向投影、协议原语与网关 webhook
  ingest。动手改租约（Lease）、Evidence、Events/Andon、GitHub check/status
  投影或 webhook 处理之前必读——这五个包共享同一套协议契约（ADR-017），
  改协议先看这里，不要在某一个包里另起一套语义。
---

# 协调平台（mod-coord-platform） — 模块知识库

> 本文件是 coord-platform 模块的**单一经验沉淀点**：每模块一个 skill，让任何
> 开发者（人类或 agent）都能持续迭代模块的 SOP/技巧/知识结构。读完你应该知道：
> 代码在哪、什么不能破坏、前人踩过什么坑。

## 一句话定位
承载多 agent 协调所需的全部基础设施：按仓分片的 RepoHub、平台级
PlatformDirectory、机械决策引擎 CoordBrain、事件→GitHub status 的反向投影、
三原语协议（Lease/Evidence/Events+Andon）与 webhook 网关。这五个包/一个 app
共享同一套协议契约，是一个整体，不按包拆知识库。

## 代码地图
- 网关：`apps/coord-gateway`（GitHub webhook ingest：签名校验 + Queues 幂等 + REST 路由）
- RepoHub DO：`packages/coord-repohub`（每仓一个：原子租约 + issue/PR 镜像 + 事件流，ADR-017）
- PlatformDirectory DO：`packages/coord-directory`（平台单例：
  Project/Engineer/Membership/Agent/Enrollment + 只增审计事件）
- 决策引擎：`packages/coord-brain`（五类机械 SOP 纯函数：全绿可合并 / ready-for-dev
  派工 / PR 超时催办 / stale 租约回收 / andon 冻结；零 IO，输入=状态快照）
- 反向投影：`packages/coord-projection`（事件流 → GitHub check/status）
- 协议原语：`packages/coord-protocol`（Lease/Evidence/Events+Andon 的类型与运行时校验，
  参考实现；代码注释自称规格权威在一个实测不存在的目录——见下方"已知文档
  缺口"，目前 `types.ts`/`validate.ts` 本身才是唯一可信来源）
- 客户端契约：`docs/coordination-protocol.md`（另见 `.harness/instructions/project/PROJECT.md`
  里的"协调服务"一节）

## 关键契约与不变量（改代码前必读）
- **协议单源**：Lease/Evidence/Events+Andon 的语义只能改
  `packages/coord-protocol/src/{types.ts,validate.ts}`，其余四处消费方跟着改，
  不许各自诠释一套。
- ⚠ **已知文档缺口**：`coord-protocol/src/types.ts` 的注释自称规格权威在
  `docs/coord-platform/protocol/`<!-- skill-doctor:ignore：这里就是在指出这个路径不存在，不是声称它存在 -->，
  但实测该目录**当前不存在**——协议的唯一可信来源目前实际上就是
  `types.ts`/`validate.ts` 本身。发现这个缺口的人应该补一份该文档或改注释
  指向真实位置，不要假装文档存在去引用它。
- <RepoHub 的原子性假设——并发租约场景下不能破坏，待核实具体实现>
- <CoordBrain 必须保持零 IO 纯函数，任何 IO 需求都应下沉到调用方，不要在这个包里加>
- <未接线协调服务时的降级路径：`pnpm harness tick` 只读时钟模式，改动不能破坏这条退路>

## 架构知识
这五个包（+ 网关）对应 Cloudflare Durable Objects 的两种典型用法：RepoHub 是
「每个仓一个 DO 实例」（分片隔离，天然避免跨仓竞争），PlatformDirectory 是
「全局一个 DO 单例」（平台级强一致视图）。改动前先想清楚自己动的这块契约
属于哪一种拓扑，不要把单例语义误用到分片场景（或反过来）。

## 关联阶段 / ADR / 文档
ADR-017（RepoHub）；`docs/coordination-protocol.md`；
`.harness/instructions/multi-agent-coordination.md`；ADR-004、ADR-009、ADR-010

## 模块 SOP
1. 动手前：读本文件 + 上述协议文档；确认改动是否触及协议语义（触及则先改
   `coord-protocol` 再改消费方）。
2. 开发中：独立 worktree（ADR-005）；协议变更影响面覆盖五个包，逐一核对。
3. 交付：`verify --sprint` 门控；PR 描述里写清对协议契约的影响面。

## 踩坑与经验（append-only，最新在上）
<空着开始。格式：`- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`>

## 知识回流规则（本文件怎么迭代——这是这个 skill 存在的意义）

1. **谁干活谁回流**：在本模块交付 feature/修 bug/做 review 时，踩到新坑、建立新做法、
   推翻旧假设 → 在同一个 PR（或紧随的小 PR）往上方"踩坑与经验"**追加**一条：
   `- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`。append-only，不删旧条目
   （被推翻的旧经验标 ~~删除线~~ 并注明被哪条取代）。
2. **module coordinator 每 C-cycle 复盘**：检查本周期内本模块合并的 PR，有值得沉淀而
   没回流的，补写。
3. **结构变更**（新增章节/重组）走正常 review；追加"踩坑与经验"条目可随任意 PR 顺带。
4. 开源贡献者同权：任何人对本模块的经验修订都走 PR，以可验证事实为准，不看资历。
