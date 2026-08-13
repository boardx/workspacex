# PROP-ROLE-SCORECARD-WORKER-TIER-001 —— 给 worker / domain coordinator 那一格记分

> 状态：**proposal，待 coord-main 评审**。按 coord-main 2026-08-13 的要求，
> 先出「可评项定义 + 反证清单」，**不写实现代码**，通过后再开 issue 走正常流程。
>
> 背景：`pnpm harness scorecard`（#1132）v1 只实现 `clr_track` 一种可评项，
> 因此**只有 reviewer 有分数**。人类 2026-08-12 要的是「main、domain agent、subagent
> 都一眼看到自己的目标与现状」——现在只完成三分之一。

## 结论先行：**按原设想直接做，会做出一个骗人的分数**

我在设计阶段实测了 `feature_list.json`，发现 `owner` 字段**今天不足以支撑 per-role 评分**。
这份提案的主要价值就是把这件事在写代码**之前**说清楚。

### 实测数据（全部 5 个 phase，290 个 feature）

```
phase-00  22 个：passing 22
phase-01 168 个：passing 147 / in_progress 4 / not_started 17
phase-02  46 个：not_started 46
phase-03  47 个：not_started 47
phase-04   7 个：passing 3 / in_progress 1 / not_started 3
```

`owner` 字段的**实际取值**（这是问题所在）：

| 形态 | 例子 | 数量级 |
|---|---|---|
| **null** | — | **110 个**（38%） |
| sprint 期临时把手 | `w2-chat4` `w3-itv11` `w0-auth` | 绝大多数 |
| 早期编号把手 | `agent-f07` `agent-f20f21` `main-agent` | 约 20 |
| **真·registry 角色 id** | `dev-project` `dev-org-admin` `coord-voice` | **仅 13 个** |
| 裸 Directory ULID | `agt_01KZRABCZ99M2NGN20C7YWEASG` | 3 |

⇒ **`feature.owner` 与 `registry.yaml` 的角色 id 是两个不同的命名空间**，
今天**无法**可靠地把 feature 映射到角色。

> 这与我在 #1135 里犯的错**同型**：凭直觉认定「owner 字段就是角色」，
> 而没有先实测那个字段里到底装着什么。这次我在写代码前先测了。

## 三个候选方案

### A. 先补数据，再评分（**推荐**）

先做一次 `owner` 归一化：把 `w2-chat4` 这类 sprint 把手映射到真实角色 id，
`null` 的显式标成 `unowned`。归一化本身是**一次性数据迁移 + 一道机械门**
（新 feature 的 owner 必须 ∈ registry ∪ subagent specs，否则 `harness doctor` 判红）。

- ✅ 之后 `feature` 类可评项就是真的
- ✅ 顺带解决「110 个 feature 没有归属」这个**独立于评分卡的真实问题**
- ❌ 迁移要人裁（谁是 `w2-chat4`？有些 sprint 已经结束，可能查不到）

### B. 不评分，只做「我的活」视图

不给 worker 打分，只在 scorecard 里列出「owner 匹配我的 feature + 它们的 status」。

- ✅ 零新判据、零迁移，今天就能做
- ✅ 仍然满足人类要的「一眼看到我要做什么」的**一半**
- ❌ 不满足「知道自己几分」——而那是人类原话里明确要的

### C. 换一个不依赖 owner 的现状分

用**假 passing 数**（标着 passing 但 `evidence` 为空 / verification 命令跑不通）
作为分数，按 area 而非 owner 归集。

- ✅ 对齐仓里真正痛的问题（本仓九次「全绿但空转」）
- ❌ 归集到 area 不是角色，**答非所问**——人类问的是「我几分」

## 我的建议

**A + B 分两步**：先上 B（今天就能给 worker 一个「我的活」视图，不撒谎），
同时把 A 的 owner 归一化作为**独立 issue** 推进（它本身就该做，与评分卡无关）。
A 完成后 `feature` 类可评项才真正落地。

⚠ **不建议**为了赶「三层都有分数」而现在硬做 A 的简化版（比如按前缀猜 `w2-chat4` → `coord-chat`）
——猜出来的归属会产生一个**看起来精确其实编造**的分数，比没有分数更糟。

## 可评项定义（A 落地后）

```jsonc
{ "kind": "feature_ownership", "phase": "01", "target": 10, "target_source": "..." }
```

**现状分怎么算**（待评审，这是本提案最需要挑刺的部分）：

| 候选 | 公式 | 问题 |
|---|---|---|
| 完成率 | `passing / 总数 × 10` | **奖励多领活**，且 not_started 多的新 phase 天然低分 |
| 无欠债 | `10 − 假passing数 − 超期in_progress数` | 对齐真实痛点，但「超期」需要定义 |
| 混合 | 完成率 × 无欠债系数 | 复杂，两个都不纯 |

**我倾向「无欠债」**：它不奖励领活，只惩罚「声称做完但没有证据」——
正是本仓九次事故的形状。但这是**判据**，按规矩该由人类/coord 定，不是我定。

## 反证清单（每道门必须实测「拆掉就变红」）

沿用 v1 的做法，新增的门至少要有：

| 门 | 规则 | 反证 |
|---|---|---|
| **W1** | feature 的 owner 不在 registry ∪ subagent specs ⇒ 判红 | 塞一个 `w2-chat4` 进去，doctor 必须红 |
| **W2** | `owner: null` 显示为「无人认领」，**不得**静默归给任何人 | 把 null 归给某角色，测试必须红 |
| **W3** | 标着 passing 但 `evidence` 为空 ⇒ 计入「假 passing」，不得当成达标 | 造一条空 evidence 的 passing，分数必须下降 |
| **W4** | 现状分只能从 `feature_list.json`（权威）派生，**不读** `active-features.json`（派生视图） | 改派生视图不应影响分数；改权威才影响 |
| **W5** | charter 里出现 feature 现状字段 ⇒ 判红（S3 同型，复用） | 已有 |

## ⚠ 一个我暂时答不了的洞，如实写在这里

**worker 能不能自己把 feature 改成 `passing`？**

`AGENTS.md` 写着「状态不能自己改……只能跑 `pnpm harness verify`，由验证脚本门控转移」，
`features.ts` 里也有 `assertSingleInProgress`。但**我没有实测过「一个 worker 直接手改
feature_list.json 的 status 会不会被拦住」**——如果拦不住，那么 `feature` 类可评项
就有一个**自评的洞**（角色能改自己的现状分），这套 eval 在 worker 这一层就不成立。

⇒ **落地前必须先做这个反证**：手改一条 status 为 passing，看 `harness doctor` / CI 是否变红。
如果不红，**先修这个洞，再谈评分**。我没有绕过它，也没有假设它不存在。

## 明确不做什么

- **不做**第二个 `board`：本提案只回答「我几分 / 还差什么」，
  「活怎么分」仍归 `board` / `task-assignment`
- **不新定义判据**：现状分的公式必须由人类/coord 拍板并写进 authority，
  scorecard 只做投影（与 v1 同规矩）
- **不按前缀猜 owner**：宁可显示「无人认领」

## 请 coord-main 裁三件

1. **走 A+B 分两步，还是只做 B，还是先不做**？
2. **现状分公式**用哪个候选（我倾向「无欠债」，但判据该你/人类定）
3. **owner 归一化**要不要作为独立 issue 先推——它独立于评分卡也该做（110 个 feature 没归属）
