# 契约束 `context-pack` — ① 领域模型与不变量

> 洋葱最内层。**不依赖任何外层**：这里出现的东西不知道 HTTP、不知道 PostgreSQL、不知道 NestJS。
> 覆盖 feature：**F09 F10 F11 F12 F13**（phase-00，合计 21 点）
> 依据：`00-core/uc-0-2 Studio 打开时带上项目上下文`
> 架构：`docs/architecture/context-engine.md` 第四节（**query-planned hybrid，推翻 graph-first**）
> 裁决：D-U4（丢弃原因七类封闭枚举）· O-36（预算随模型窗口推导 / 阈值按任务类型可配）·
> D-U1（含机密整轮本地，不分流）

---

## 一、实体与值对象

### `ContextPack`（聚合根）—— 一次装配的完整结果

| 字段 | 类型 | 说明 |
|---|---|---|
| `packId` | `string` | 本次装配实例 ID |
| `runId` | `string` | **可重放的稳定标识**：同 `runId` 重放得到同一 `items[]`（I-5） |
| `query` | `QueryContext` | 本次查询上下文 |
| `retrievalPlan` | `RetrievalChannelPlan[]` | 五路各自的权重与命中数（query-planned 的可审查投影） |
| `items` | `ContextItem[]` | 三段之一：装进来的证据 |
| `claims` | `ClaimRef[]` | 三段之一：已审核的洞察/决策，**反对证据强制保留** |
| `omissions` | `Omission[]` | 三段之一：**被丢弃清单**，带原因 |
| `tokensUsed` | `number` | 预算占用（原型示例 14.9k / 120k） |
| `pinnedSnapshotId` | `string \| null` | 非 null ⇒ 已随定版固化，内容不可变（I-7） |

⚠ **Context Pack 不是字符串数组**，而是 `items[]` / `claims[]` / `omissions[]` 三段结构
（与 `context-engine.md` 第四节逐字对齐）。

### `QueryContext`（值对象）

`tenantId` / `principalId` / `projectIds` / `task` / `query` / `timeRange` /
`allowedSensitivity` / `tokenBudget` / `freshnessRequirement` / `evidencePolicy`。
⚠ `tokenBudget` **不写死 120k**：随模型窗口推导，超限按相关度截断（O-36）。

### `ContextItem`（值对象）—— **八字段六元组，无一为空**

| 字段 | 六元组映射 |
|---|---|
| `segmentId` | 资源 ID（最小检索单元，指向 `segments`） |
| `content` | — |
| `sourceType` | 来源（八来源：文件/问卷/访谈/工作坊/照片/对话/深度研究/AI 生成） |
| `artifactVersionId` | 版本（指向 `artifact` 束 F05 的不可变版本）+ 资源 ID |
| `anchor` | 来源定位（**至少命中一种锚点，缺一不可**） |
| `retrievalReasons` | 筛选动作（五种，一条可命中多个） |
| `channels` | 命中了哪几路召回（FTS 一等通道的可断言证据，V11） |
| `score` | 相关度 |
| `permissionDecisionId` | 可见范围（指向 `identity` 束一次真实的 `PermissionDecision`） |

### `Anchor`（值对象）—— 引用可定位的载体

`page` / `bbox` / `startMs` / `endMs` / `messageId` / `surveyQuestionId`，**至少命中一种**。

### `ClaimRef`（值对象）

`statement` / `status`（五态）/ `supportingSegmentIds` / `contradictingSegmentIds`。
⚠ `contradictingSegmentIds`（反对证据）**强制保留、不做筛除**（R7）。

### `Omission`（值对象）—— 被丢弃清单的一条

| 字段 | 说明 |
|---|---|
| `ref` | 被丢弃内容标识（segmentId 或召回前被挡的 candidateId） |
| `reason` | **七类封闭枚举**（下）——单一事实源 `apps/web/lib/omission-reason.ts` |
| `compliance` | 是否合规性丢弃（由单源 `OMISSION_REASONS[r].compliance` 推出，**不另存**） |
| `explain` | 面向被解释的人的一句话（取自单源 explain） |

### 丢弃原因七类（裁决 D-U4，**封闭枚举，单一事实源在 `apps/web/lib/omission-reason.ts`**）

`withdrawn` / `expired` / `unauthorized` / `low-confidence` / `budget` / `deduped` / `out-of-scope`。
其中 **`withdrawn` / `expired` / `unauthorized` 是合规性丢弃，必须始终可见**，
不因「只显示前 N 条」的折叠或截断从界面消失。**新增类别必须走 ADR。**
⚠ 契约（`context-pack.ts` 的 `OmissionReasonSchema`）**从该单源 import 七个键构造 zod enum，不另列**——
另列就是第六次「同一事实声明在两处」。

---

## 二、不变量

> 判据：**它在任何时刻都为真，违反即数据损坏，且能写成断言。**
> 写不成断言的是「规则」，请放到 `usecases.md` 的前置条件里。
> **跨束**列标 ✚ 的不变量不在本束单独求解，须提到**阶段一致性复核**（见 `coverage.md`）。

| # | 不变量 | 断言方式 | 跨束 |
|---|---|---|---|
| **I-1** | 任一 `items[]` 条目的八字段全部非空，且 `anchor` **至少命中一种锚点** | 对每条 item 断言八字段非空 + `page/bbox/startMs/endMs/messageId/surveyQuestionId` 至少一个有值。无锚点候选**不得进 items**，落 `omissions` 或抛 `ANCHOR_MISSING` | |
| **I-2** | 候选集中**每一条未进 `items[]` 的内容，都能在 `omissions[]` 里找到对应记录** | `set(candidateIds) − set(items.segmentId) ⊆ set(omissions.ref)`，差集为空 | |
| **I-3** | `omissions[].reason` **恒属七类封闭枚举** | 用 `OMISSION_REASON_KEYS` 断言 reason 取值合法；断言代码里不出现表外字面量（`lint-omission-reason`） | |
| **I-4** | 合规性丢弃（`withdrawn`/`expired`/`unauthorized`）在任何折叠/截断/分页下**都出现在返回中** | 构造 30 条丢弃（含 3 条合规）+ 「只显示前 5 条」，断言 3 条合规**全部**仍在 `complianceAlwaysShown` | |
| **I-5** | 同一 `runId` 重放得到**逐字节相同**的 `items[]` | `replay(runId).items` 深等于原 `items`（纯函数断言，context-engine 首批门槛 ⑥） | |
| **I-6** | AI 产出引用的每条证据 `segmentId` **必属**本次 `items[].segmentId` | 构造引用包外证据的调用，断言 `verifyCitation` 拒绝且 `offendingSegmentIds` 非空 | ✚ |
| **I-7** | `pinnedSnapshotId ≠ null` 的 Pack，其 `items`/`claims`/`omissions` 内容**按 `contentHash` 不可变** | 固化后改动上游材料，断言重取该快照的 `contentHash` 不变、`items` 不变 | ✚ |
| **I-8** | 个人层私有笔记**永不出现在任何 `items[]`** | 构造含私有笔记的候选，断言装配结果 `items` 与 `omissions.ref` 均不含它（不是「装了但空内容」） | ✚ |
| **I-9** | 交集/派生内容的可见性取**所有来源中最严格**的一档（不是最宽松，也不是并集） | 构造双来源交集 item，断言其 `permissionDecisionId` 对应 = `min(来源权限)` | ✚ |
| **I-10** | `items[]` 含**任何**机密条目 ⇒ 本轮 `localOnly = true`，模型选择只返回自托管模型 | 构造含 1 条机密的 Pack，断言 `resolvePackModelConstraint.localOnly = true` 且模型清单无云端项 | ✚ |
| **I-11** | 每条 `items[].permissionDecisionId` **指向一次真实存在的鉴权判定**（可回溯「为什么给你看」） | 断言该 id 能在 `identity` 的判定记录中解析到，非空占位 | ✚ |
| **I-12** | `claims[].contradictingSegmentIds`（反对证据）**不被任何筛选筛除** | 构造带反对证据的 claim，断言装配后反对证据条数不减 | |

### 为什么 I-8 说「永不出现」而不是「内容置空」

「装了但内容为空串」仍然泄漏了**存在性**——对方能推断出「这里有一条我看不到的私有笔记」。
个人层私有内容的约束是**连存在都不暴露**，故断言 `items` 与 `omissions.ref` 两处都不含它
（对比 `identity` I-8 管理员看个人层「响应体中不存在内容字段」——同一种「不暴露存在性」纪律）。

### 为什么 I-2 是本束的灵魂

「**被丢弃不等于不存在**」（R7）的可执行定义就是 I-2：装配结果里没出现的东西，
必须在 `omissions[]` 里能解释为什么没出现。没有 I-2，Context Pack 就退回成一个黑箱——
而「AI 为什么没读这条」变成不可回答的问题**正是这个束要消灭的东西**。

---

## 三、这个域不负责什么

- **权限的判定与强制**：属 `identity` 束（判定在 application，强制在 PG RLS）。
  本束只**消费** `PermissionDecision`，并保证它沿数据链路传播到 items（I-9/I-11，跨束）。
- **原件的存储与版本**：属 `artifact` 束。本束只**召回它们、引用它们**（`artifactVersionId`）。
- **Claim 的生命周期与五态机**：属 `14-brain`（phase-01 P3）。本束只定义 `ClaimRef` 结构，
  真实 claims 数据源跨阶段（见 `coverage.md` 缺口）。
- **检索算法实现细节**：向量索引、分词方案、rerank 模型属技术方案，不属领域模型。
- **出网为零的强制**：机密本地路由的「数据不出本机」由**部署形态**保证（网络层），
  契约管不到（同 `identity` I-9 的 `NetworkEgressGuard`）。
