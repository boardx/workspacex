# H3A-011 — 核心 Domain inventory：证据与仍然模糊的地方

> 🔶 **本文件的产出（`.harness/domains/registry.yaml`）需要人类确认，不是
> "✅ 完成"。** 完成契约原文（`PROP-HARNESS-AGENT-001.checklist.md`）：
> "最终清单必须通过 inventory 从真实代码、Contract Bundle 和 ownership
> 推导，由人类签核，不能直接把本建议当作已接受注册表"。这里做的是
> **前半句**——真实证据推导；**后半句"人类签核"尚未发生**，本文件是签核
> 材料，不是签核记录本身。

## 方法

不是重新做一次全仓扫描（H3A-002 已经在 `PROP-HARNESS-AGENT-001-e0-inventory.md`
做过一次广度扫描并现场核实），是在那份 inventory 的「Domains：四个信号源，
互相不对齐」结论上，补一次**面向登记**的证据核对，对 Proposal §8.1 建议的
9 个候选 Domain 逐一核对三类真实证据：

1. `.harness/agents/registry.yaml` 里哪个身份的 `areas:` 声称了这个边界，
   以及该身份的 `kind:` 是什么——这一步是本次复核比 H3A-002 广度扫描多做的：
   `kind: module-coordinator` 才是"Domain 规划权威候选人"，`kind: worker`
   只是执行角色，`kind: reviewer` 是独立验证角色。第一版草稿曾经把
   areas 字面重叠但 `kind` 不同的身份都当成"owner 竞争"，产生了三个假的
   `owner: null`——修正后见下表；
2. 是否存在对应的 Contract Bundle（`phases/*/contracts/<bundle>/`）；
3. `packages/contracts/src/*.ts` 是否有对应的契约类型文件。

`.harness/state/module-lock-*.json`（inventory 提到的第三个信号源）**不在本
仓库当前分支的文件树里**——`.gitignore` 把它列为运行时缓存
（`module-lock-*.json`），核实见 `.harness/scripts/lib/module-lock-state.ts:14`
的路径拼接逻辑。inventory 文档记录的 6 个文件名（agent/auth/canvas/chat/
recording/skills）是 2026-08-07 现场取值时的运行时状态，本次复核**无法重新
观察到同一份文件**，只能引用 inventory 文档已经记录的结论，如实标注这一点。

## `.harness/agents/registry.yaml` 里每个身份的真实 `kind`（本次核实的关键新证据）

| id | kind | areas |
|---|---|---|
| coord-main | coordinator | `["*"]` |
| coord-architecture | architecture-coordinator | `[harness, docs, adr, agent-protocol]` |
| coord-chat-e2e | **module-coordinator** | `[chat, agent, skills, canvas, recording, e2e]` |
| coord-agent-auth | **module-coordinator** | `[auth, identity, session]` |
| dev-platform-baseline | worker | `[platform, database, ci, baseline]` |
| dev-auth | worker | `[auth, identity, session]` |
| dev-ai-runtime | worker | `[ai-runtime, agents, skills]` |
| dev-chat-e2e | worker | `[chat, e2e]` |
| rev-feature | reviewer | `[platform, auth, ai-runtime, chat]` |
| rev-e2e | reviewer | `[e2e, release-readiness]` |

关键发现：今天全仓只有**两个** `kind: module-coordinator`（不算 `coord-main`
自己和 `architecture-coordinator` 这个不同 kind 的 `coord-architecture`）——
`coord-chat-e2e` 一个人覆盖 `[chat, agent, skills, canvas, recording, e2e]`
六个 area，`coord-agent-auth` 覆盖 `[auth, identity, session]` 三个。这正是
E0 inventory 结构问题 #3 的原句："一个 module coordinator 可能同时覆盖
chat、agent、skills、canvas、recording、e2e，模块边界和知识边界不一致"——
本次复核把这句话变成了可以在 `registry.yaml` 里机械看到的具体后果：下表
8 个 Domain 里有 3 个的 owner 都是同一个人（`coord-chat-e2e`）。

## 逐条证据与 owner 判定

| Domain（本次登记） | areas 证据 | Contract Bundle 证据 | owner 判定 |
|---|---|---|---|
| DOM-PLATFORM | `dev-platform-baseline`（worker）：`[platform, database, ci, baseline]`，唯一声称 | 无对应 `phases/*/contracts/` 目录 | `dev-platform-baseline`——唯一声称者；但该 Domain 没有任何 `module-coordinator` 覆盖，是结构问题 #2 的例子（worker 没有对应 coordinator） |
| DOM-IDENTITY-AUTH | `coord-agent-auth`（**module-coordinator**）：`[auth, identity, session]`；`dev-auth`（worker）areas 字面相同但 `reports_to: coord-main` | `phases/phase-00-shared-kernel/contracts/{identity,auth}/` | `coord-agent-auth`——唯一 module-coordinator 声称者。`dev-auth` 不构成竞争（worker 层级），但它 `reports_to coord-main` 而不是 `coord-agent-auth` 是监督链缺口，不是本条目要解决的问题 |
| DOM-CHAT | `coord-chat-e2e`（**module-coordinator**）areas 含 `chat`；`dev-chat-e2e`（worker）areas=`[chat,e2e]`，`reports_to: coord-main` | `phases/phase-01-run-a-project/contracts/chat/` | `coord-chat-e2e`——唯一 module-coordinator 声称者 |
| DOM-CANVAS-DIAGRAM | 只有 `coord-chat-e2e` 的 areas 含 `canvas`，没有其他身份声称 | `phases/phase-01-run-a-project/contracts/canvas/` | `coord-chat-e2e` |
| DOM-AI-RUNTIME | `dev-ai-runtime`（worker）areas 含 `ai-runtime`，唯一声称；**没有任何 module-coordinator** 声称这个 token | `phases/phase-01-run-a-project/contracts/agent-runtime/` | `dev-ai-runtime`——该 Domain 今天没有 coordinator 层，直接由 worker `reports_to coord-main`（结构问题 #2 的又一例） |
| DOM-AGENT-SKILL-DIRECTORY | `coord-chat-e2e`（module-coordinator）areas 含 `agent`,`skills`；`dev-ai-runtime`（worker）areas 含 `agents`,`skills`——**两者不是协调者/其下 worker 的关系**（`dev-ai-runtime` 不 `reports_to coord-chat-e2e`） | `phases/phase-01-run-a-project/contracts/{skills,templates}/` | **owner: null**——真实的 owner 竞争，不是本文件编造的歧义。额外发现：`coord-chat-e2e` 写的是单数 `agent`，`dev-ai-runtime` 写的是复数 `agents`，无法判断这是命名不一致还是有意指两个不同边界 |
| DOM-CONTRACT-CONTROL-PLANE | `coord-architecture`（architecture-coordinator）：`[harness, docs, adr, agent-protocol]`，唯一声称 | 无对应目录（harness 自己不走 `phases/*/contracts/` 那条产品契约门，见 AGENTS.md 契约签核关卡一节） | `coord-architecture` |
| DOM-E2E-RELEASE-READINESS | `coord-chat-e2e`（module-coordinator）areas 含 `e2e`；`rev-e2e`（**reviewer**）areas=`[e2e, release-readiness]`，`required_for` 同 | 无对应目录 | `coord-chat-e2e`——`rev-e2e` 是该 area 的必需独立评审角色（Proposal P6/G6：评审权与规划权本来就该分离），不计入 owner 竞争。第一版草稿曾把这条误判为"两个身份争 owner"，是没有先查 `kind` 字段就下结论——修正后这里没有真实冲突 |

## 被排除的候选：collaboration/realtime

Proposal §8.1 建议的 9 个候选里，`collaboration/realtime` **本次没有被登记进
registry.yaml`**——inventory 文档原句："`collaboration/realtime` 今天完全不
存在（零 lock 文件、零 registry area、零 skill）"。本次复核：`registry.yaml`
的 10 个身份 `areas:` 字段里搜不到 `collaboration`/`realtime` 关键字，
`packages/contracts/src/` 也没有对应文件。把它登记成 `status: active` 会是
本文件自己在文件头警告的那种"无目录猜测"，所以选择不登记，留给人类在签核
时决定：这是"确实不存在，Proposal 建议超前于现状"，还是"存在但用了不同
名字，需要人类指出真实位置"。

## 未被 Proposal §8.1 候选覆盖、但有真实 Contract Bundle 的领域

`phases/*/contracts/` 与 `packages/contracts/src/` 下还存在下列真实契约，
本次**没有**为它们各自开一个 Domain（决定权在人类）：

`research`、`project`、`org-admin`、`interview`、`asset-governance`、
`files`（含 `files-outbound-stubs.ts`）、`context-pack`、`provenance`、
`consent-item`、`filter-action`、`omission-reason`、`thresholds`、`recording`
（`packages/contracts/src/recording.ts` 存在，且 `coord-chat-e2e` 的 areas
列表里也有 `recording`，同 DOM-CANVAS-DIAGRAM 一样是它宽泛列表里的一项，
不是单独 Domain）。

这些要么明显应该并入上表某个 Domain（比如 `recording` 大概率归入
`coord-chat-e2e` 的领域），要么本身粒度就比"协调者边界"更细（比如
`consent-item`/`omission-reason` 更像 DOM-IDENTITY-AUTH 或某个新的隐私/
合规 Domain 下的具体契约，而不是独立 Domain）。本文件不替人类做这个判断，
如实列出，交给签核环节。

## 交给人类签核的三个具体问题

1. **`coord-chat-e2e` 一人覆盖 `DOM-CHAT`/`DOM-CANVAS-DIAGRAM`/
   `DOM-E2E-RELEASE-READINESS` 三个 Domain**（外加 `DOM-AGENT-SKILL-DIRECTORY`
   的部分争议边界）——这是否应该拆成更细的 coordinator 角色（比如
   `coord-canvas`、`coord-e2e`），还是"一个协调者管一大片"本来就是当前
   规模下有意为之的选择？这是 Proposal G2"每个核心 Domain 拥有稳定知识
   入口"和现状差距最大的一条。
2. `DOM-AGENT-SKILL-DIRECTORY` 的真实 owner 冲突（`coord-chat-e2e` vs
   `dev-ai-runtime`，外加 `agent`/`agents` 单复数不一致）应该如何消歧？
   是把这块边界划给 `coord-chat-e2e`、划给一个新的 `coord-ai-runtime`，
   还是与 `DOM-AI-RUNTIME` 合并成一个 Domain？
3. `DOM-PLATFORM`、`DOM-AI-RUNTIME` 今天都只有 `worker` 直接
   `reports_to: coord-main`，没有对应的 `module-coordinator`——是否需要
   为它们新建 coordinator 角色，还是接受"暂时没有 L2，worker 直接对
   `coord-main` 汇报"这种迁移期例外（Proposal §6.4 允许的第三种兼容路径）？

在这三个问题被人类回答之前，`registry.yaml` 里 `DOM-AGENT-SKILL-DIRECTORY`
的 `owner: null`、以及 `coord-chat-e2e` 同时是三个 Domain owner 这件事，
都不应被视为最终事实。

## 裁决记录（2026-08-08，人类）

三个问题逐条拍板，非批量默认接受：

1. **`coord-chat-e2e` 一人覆盖三个 Domain** → 拆分。新增 `coord-chat`/
   `coord-canvas`/`coord-e2e` 三个独立 module-coordinator（见
   `.harness/agents/registry.yaml`），`DOM-CHAT`/`DOM-CANVAS-DIAGRAM`/
   `DOM-E2E-RELEASE-READINESS` 的 owner 已改指向对应新身份（见
   `.harness/domains/registry.yaml`）。`coord-chat-e2e` 本身保留不动（真实
   活跃身份，历史/在跑分支仍以它命名），只是不再是这三个 Domain 的 owner。
2. **`DOM-AGENT-SKILL-DIRECTORY` 的 owner 冲突** → 暂缓，`owner: null` 维持
   不变。不是遗漏，是明确"留到 H3A-018（Fabric.js/Mermaid Domain Skill）
   真正用到这块边界时再定"，与问题 3 的"接受既定例外"不同——这个还没定，
   是真悬而未决。
3. **`DOM-PLATFORM`/`DOM-AI-RUNTIME` 无 coordinator 层** → 接受为既定例外，
   不补协调者层（同 H3A-029 gate 已判 WARN 的"迁移期兼容"先例一致）。

裁决落地后现场核实：`pnpm harness domains doctor`、`pnpm harness
role-authorization doctor` 均 exit 0；H3A-022b（一个 orchestrator 一个
Domain）从原本的 WARN 变为干净；剩余 WARN 精确对应上面裁决 2/3 的"暂缓"和
"接受例外"，不多不少。
