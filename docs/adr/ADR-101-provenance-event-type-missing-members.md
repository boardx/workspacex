# ADR-101: `provenance` 两个封闭枚举缺成员 —— 一次补齐，并把 target 维度的洞写在明处

- 状态: **Proposed** —— ⚠ **需人类追认**（`provenance` 属已签核的 phase-00 束）
- 适用层：项目实现（专属）
- 日期: 2026-07-31
- 相关：`design-coherence.md` **XC-10** · `project.ts` `KNOWN_CONTRACT_GAPS.P3` ·
  `chat.ts` `C_CHAT_5` · issue #49（F80）/ #101（F117）/ #99（F109）/ #85（F32）

---

## 背景

### 一、同一个根，四个束各撞一次，而且处理方式有四种

`packages/contracts/src/provenance.ts` 是**跨束共享**契约，由 phase-00 的 `identity` 与
`artifact` **两束合并**而成。phase-01 有**十个束**要写审计事件——这是它第一次被大规模消费。
`design-coherence.md` **XC-10** 早就记着这件事，代价一栏逐字写着
「`ProvenanceEventType` 扩四值（**走 ADR**）」。

到 2026-07-31 为止，四个 feature 各自撞上「已签核的 UC 要求写审计、枚举里没有可写的类型」，
**而四个人的处理方式各不相同**：

| feature | 缺什么 | 它怎么处理的 |
|---|---|---|
| F80 · `interview`（已合入） | `target.kind` 缺 `interview` | 不动契约，`get-interview.ts` 文件头写明将就内容与补法，登记上报 |
| F117 · `project`（已合入） | `ProvenanceEventType` 缺项目生命周期四值 | 不动契约，用「逐个点名四种候选拼写」的断言钉住，补上时当场红 |
| F109 · `chat`（在做） | 事件类型缺线程三值 + `target.kind` 缺 `thread` | 不动契约，用 `CHAT_LIFECYCLE_AUDIT_TYPE = "human-edited"` **顶包**，源码标红 |
| F32 · `files`（本 PR） | `ProvenanceEventType` 缺 `downloaded` | **直接加进枚举**（并写了这份 ADR） |

四种处理留在仓库里，将来没人说得清这个枚举到底是封闭的还是可以随手加的。
**这份 ADR 的第一个目的就是把它收敛成一种。**

### 二、判为「漏项」而不是「待裁」，理由

这不是「两套方案还没选」，是**规范齐全、类型缺席**：

- `contracts/files/usecases.md`（**已签核**）逐字：「下载动作写 `provenance_events`
  （17-gov/UC-17.1 四类事件之一）」；`requirements/22-files/uc-22-1` 第 98 行同义。
- `project.ts:767`（`P3`）逐字：四个操作都返回 `provenanceEventId`，而枚举里没有对应类型。
- `uc-8-1` R7 逐字：「任何覆盖、删除、撤销……都必须记录审计事件」。
- `interview` 束 `coverage.md` 有 V9 / V10 / V12 / V15 四条「审计态」验收。

四处**已签核**的 UC 都要求写审计，而共享枚举里**没有可写的成员**。
一份已签核文件要求做的事，另一份已签核文件没有提供做它的类型——这是矛盾，不是留白。

⚠ 最接近的现有成员都不是它们：`local-export` 是「本地组织 → 正式组织的导出（F17）」，
一次组织迁移；`human-edited` 是「人工编辑草稿」。拿它们顶包会让
「材料出域了吗」「哪些线程被删过」在同一个类型里混进毫不相干的事件，
而那正是本文件开头说的「封闭枚举」要防的东西。

### 三、🔴 只补枚举补不完 —— target 维度的洞（F109 指出）

`queryProvenance` 的筛选面只有 `(targetKind, targetId)`：**没有 join，也不能筛 `detail`**
（`detail` 是 `z.record(z.unknown())`）。

规矩来自 `application/provenance/record-audit.ts` 头部：
**「target 是验收标准说你按什么去搜的那个东西」**。按它，
F80 的 target 该是 `interview`、F109 的该是 `thread`、F32 的该是 `artifact-version`。
但 target 一改成具体对象，**「列出本项目下的某类审计」就没有可筛的列了**——
`projectId` 只活在 `detail` 里。

而这正是 `chat.queryChatAuditEvents` 的形状：`/chat/projects/:projectId/audit-events`，
**按项目列**。

⇒ 只补枚举的话，四个 feature 会各自往自己的 `detail` 里塞一份 `projectId` 兜底。
**那就是同一事实的第四、第五、第六处声明**——正是 `AGENTS.md` 那条
「同一事实不得声明在两处」，本仓已因此漂移九次。

⚠ 这不是某一家的问题：`admin-project-access`（F108 已在用）今天是 `target = {kind:"project"}`，
所以「**这条线程被管理员读过**」现在也查不出来。

---

## 决策

### 决策 A — 两个封闭枚举一次补齐（**本 PR 已落地，Proposed，需追认**）

`ProvenanceEventType` 新增 **8** 个成员：

| 成员 | 代谁补 | 出处 |
|---|---|---|
| `downloaded` | F32 · `files` | `files/usecases.md` `issueDownloadUrl` · `uc-22-1` R9 |
| `project-created` | F117 · `project` | `project.ts` `P3` / XC-10 **逐字** |
| `project-archived` | F117 · `project` | 同上 |
| `project-unarchived` | F117 · `project` | 同上 |
| `agenda-segment-state-changed` | F117 · `project` | 同上 |
| `thread-created` | F109 · `chat` | `uc-8-1` R7 / issue #99 评论 |
| `thread-renamed` | F109 · `chat` | 同上 |
| `thread-deleted` | F109 · `chat` | 同上 |

`ProvenanceTargetKind`（**另一个枚举**）新增 **2** 个成员：`interview`（代 F80）、`thread`（代 F109）。

命名纪律：沿用现有成员的**「对象-过去分词」**构词法
（`capability-added` / `role-changed` / `evidence-withdrawn`）。
project 四值与 chat 三值的名字**照抄**各自 issue / 契约缺口里已经写死的措辞，**不重新发明**——
F117 / F109 落地时应当直接用得上；用不上说明抄错了，那是个可发现的错误。

**线程三值不合并成 `thread-changed` + `detail.op`**：合并意味着「查所有删除」得先解析 jsonb，
而 `queryProvenance` 的筛选面上没有那个能力——那条查询在契约层就不存在。

**`unauthorized-attempt` 不动**：F80 / F109 的「被拒尝试」用它语义本来就对。

顺带收敛一处「同一事实两处」：target 的取值原先在 `ProvenanceEvent.target.kind` 与
`queryProvenance.in.targetKind` **各写了一遍**，现提成 `ProvenanceTargetKind` 单点引用。
漂移的表现会是「某类事件写得进去、查不出来」，而两边各自看都是自洽的。

### 决策 B — target 维度：**列出出路，不替人裁**

本 ADR **不裁** 这一条，但要求追认者连同 A 一起看，因为只追认 A 会让问题以另一种形态回来。

| | 做法 | 代价 / 收益 |
|---|---|---|
| **A**（F109 倾向，本文同倾向） | `provenance_events` 增加**可筛的 `project_id` 维度**（列 + 索引，`queryProvenance.in` 加一个可选筛选） | 一次解决四个束：它们都是「事件属于某个项目下的某个具体对象」。代价是给一张 append-only 表加列 + 一次回填决策（历史行的 `project_id` 从哪来） |
| B | target 保持粗粒度（`project` / `organization`），具体 id 留在 `detail` | 零改动。代价：「这场访谈被谁探过」「这条线程发生过什么」查不出来——而后者正是删除追溯要回答的问题 |
| C | `queryChatAuditEvents` 改成按 `objectRef` 而非 `projectId` 列 | 改一个**已签核**端口的形状，且只修 chat 一家 |

⚠ **在 B 或 C 之外没有「什么都不做」这一档**：不裁的结果不是维持现状，而是四个 feature
各自在 `detail` 里塞一份 id——即默认选了 B，但是以四份重复声明的形式。

### 决策 C — 机械门控（**本 PR 已落地**）

`apps/api/tests/files/provenance-enum-single-source.test.ts`：两条枚举 × **两个方向**各一条断言。

- 契约 → SQL：契约有而 CHECK 没有 ⇒ 该审计**写不进去**（INSERT 被拒，且恰在需要它的时刻）
- SQL → 契约：CHECK 有而契约没有 ⇒ 该行**读不出来**（`queryProvenance` parse 失败）

两个方向互不蕴含，生产表现完全不同。**不用 `toHaveLength`**：长度相等的 RENAME 正是漏网的形状。
另有非空性断言（提取集合必须真的含有本 ADR 加的成员），否则一个匹配不到东西的正则会让
两个方向都在空集上通过。

---

## 后果

### 正面

- 四个束的审计链从「各自将就」变成能真正写进去、查得出来。
- 枚举扩张有了唯一入口：**这份 ADR**。第五个撞上的人被带到这里，而不是发明第五种处理。
- `queryProvenance` 的 target 取值收敛成单点，少一处会静默漂移的副本。

### 负面 / 风险

- **`provenance` 是已签核的 phase-00 束，本次改动未经签核流程。** 这份 ADR 就是补办的申请。
- 追认之前，`main` 上的枚举比任何一份签核文件都宽。
- 决策 B 悬而未决期间，F109 / F117 / F80 落地时仍需在 `detail` 里放 id；
  那是**临时**的，不是结论——落地时请引用本 ADR，不要各自解释一遍。

### ⚠ 如果人类**否决**，回退动作（写在这里，免得到时候现想）

1. `git revert` 本 PR 中对 `packages/contracts/src/provenance.ts` 的改动
   （8 个事件类型 + 2 个 target kind；`ProvenanceTargetKind` 的**提取**可以保留——
   那是纯粹的去重，不新增取值）。
2. 迁移 `0027-f32-download-grants.sql` 中两条 `ALTER ... ADD CONSTRAINT` 改回 0005 的取值。
3. 删除 `apps/api/tests/files/provenance-enum-single-source.test.ts` 中的**非空性**断言
   （双向相等的两条**保留**——它们与成员多少无关，而且正是它们让回退不会漏改一边）。
4. **F32 随之失去「写审计」这条**：`deliver-artifact.ts` 的 `redeemDownloadUrl` 无类型可写，
   `download-url-short-lived-onetime.test.ts` 的 ④ 组四条断言必须删除或改写。
   ⇒ 届时 F32 的 `user_visible_behavior`（「写 provenance_events」）**不成立**，
   该 feature 需要退回 `in_progress` 并重新与已签核的 `files/usecases.md` 对账。
   **否决的代价是具体的，不是"少一个枚举值"。**
5. 同理 F109 的顶包写法、F117 的钉子断言、F80 的将就注释全部保留原样——它们本来就没动契约。

### 追认后需要跟着改的地方（不在本 PR 范围，列出以免漏）

| 位置 | 要做什么 | 谁 |
|---|---|---|
| `apps/api/tests/project/create-project-atomic-two-rows.test.ts` | 那条「逐个点名四种候选拼写、断言其**不存在**」的钉子会因本 PR **当场红**——这是它设计好的行为。改成「四个成员已存在 ∧ `create-project.ts` 仍未发出 `provenanceEventId`」，把钉子指向**剩下的活**而不是删掉它 | F32 rebase 时代改（见下），或 F117 后续 |
| `apps/api/src/application/chat/mutate-thread.ts` | `CHAT_LIFECYCLE_AUDIT_TYPE` 一个常量拆成三个成员 + `target` 改 `thread` + `projectId` 移进 `detail` | F109 |
| `apps/api/src/application/interview/get-interview.ts` | target 从 `organization` 改成 `interview`，`detail.interviewId` 移除；文件头那段「已知契约缺口」改成指向本 ADR | F80 后续 |
| `apps/api/src/application/project/create-project.ts` | 发出 `provenanceEventId` | F117 后续 |
| `design-coherence.md` XC-10 | 状态从「已定（消费侧确认）」更新——**消费侧确认不了一个不存在的成员**（F117 逐字） | 复核者 |
