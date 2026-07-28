---
phase: "00"
status: confirmed          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: " yanbin shen"
confirmed_at: "2026-7-28"
---

# phase-00 阶段一致性复核（ADR-020 第二级门）

> **只查交叉约束。** 单束内的问题在签该束时已经看过了，这里不重复。
> 四个束共产出 **30 个缺口**，本文把其中**跨束的**挑出来统一处置——
> 不统一的后果是每束各造一套，那就是第七次「同一事实声明在多处」。

## 复核范围

| 束 | feature | 点 | 不变量 | 失败模式 | 操作 | 缺口 |
|---|---|---:|---:|---:|---:|---:|
| `identity` | F01 F02 F03 F15 F16 F17 | 33 | 11 | 8 | 8 | 6 |
| `artifact` | F04 F05 F06 F07 F08 | 21 | 14 | 12 | 9 | 8 |
| `context-pack` | F09 F10 F11 F12 F13 | 21 | 12 | 11 | 9 | 9 |
| `web-kernel` | F14 | 13 | 11 | — | —（门控即契约） | 7 |
| **合计** | **17 个 feature** | **88** | **48** | **31** | **26** | **30** |

`verify-uc-coverage` 已确认：**88 点全覆盖、无遗漏无重叠、46 条 R12 逐条映射、无孤儿接口。**

---

# 一、必须统一处置的四条交叉约束

## ⛓ X-1 权限沿数据链路传播 —— **三个束独立发现了同一件事**

| 束 | 它怎么描述这件事 |
|---|---|
| `identity` 缺口 2 | V10 的六条路径没有统一入口，契约只给了 `authorize` |
| `artifact` 缺口 2 + I-13 | Artifact 的 `scope` 必须传播到 segment/embedding/图节点/缓存/Context Pack |
| `context-pack` 缺口 2 + I-8/I-9 | 召回层必须消费同一判定，否则「原文看不到但摘要把内容洗白后送出去」 |

**三个束各自独立指出它，说明这不是某一束的疏漏，而是一条真实的横切约束。**

### 裁决
**六条路径（检索 / Context Pack / embedding 相似度 / 图节点遍历 / 文件浏览器 / 缓存）
必须共用同一个判定函数，判定归 `identity` 束，其余束是消费者。**

- 归属：`identity` 的 `Authorize` 用例增加**批量判定**能力（一次判一组 object，返回 decision 数组），
  否则召回层逐条调用会成为性能瓶颈，而性能瓶颈会诱导实现者绕过它——**这正是 R7 被架空的典型路径**。
- 断言：UC-0.3 R12 V10 已定「六条路径逐条断言不返回内容」，
  ⇒ 该断言**必须放在 identity 束**，不能拆到三束各写一条（拆了就无法证明「用的是同一个判定」）。
- 推论保持不变：**交集生成内容取所有来源中最严格的一档**（不是最宽松，也不是并集）。

## ⛓ X-2 provenance 查询面 —— 两个束都要写，谁提供查询

| 束 | 它写什么事件 |
|---|---|
| `identity` 缺口 1 | 能力清单增删、角色/团队变更、管理员项目访问 |
| `artifact` 缺口 1 | 回流、定版、绑定升级、越权尝试 |

两束都只返回 `provenanceEventId`，**谁都没定「怎么查」**。

### 裁决
**`provenance_events` 是单表、append-only，查询面统一设计一次，不属于任何单束。**

- 提取到一个**共享的 `provenance` 契约**（`packages/contracts/src/provenance.ts`），
  两束都只负责**写入时声明自己的事件类型**，不各造查询接口。
- 事件类型是**封闭枚举**，新增走 ADR——理由同丢弃原因（D-U4）：
  它是「谁在什么时候动了什么」的可审查性，开放结构必然长出几十种说法。
- ⚠ 这条要在**开工前**做完，否则两束会各自先写一个 `queryProvenance`，之后再合并就是返工。

## ⛓ X-3 「出网为零」是部署形态约束 —— **契约管不到，最容易掉进缝里**

`identity` 缺口 3 与 `context-pack` 缺口 8 是同一件：
本地组织的 I-9「出网请求数为 0」、机密材料的本地路由——**这两条都无法用 API 契约保证**。

### 裁决
**它是部署形态约束，写进 `architecture.md`，并指定负责人。**

- 落法：容器网络策略（egress deny-all + 白名单），不是应用层开关。
- 断言位置：**网络层**观测，不是应用日志。
  ⚠ 应用层只能证明「我没主动发起出网」，证明不了「没有任何出网」——
  第三方 SDK、遥测、依赖库都可能出网。
- **这条如果没人认领，它会在前后端的缝里掉下去**：前端以为后端管，后端以为运维管。
  ⇒ 签核时必须确认它有归属。

## ⛓ X-4 快照不可删 vs 合规撤回删除 —— 两条不变量正面冲突

- `artifact` I-11：**固定快照不可删、不可改、不可降级**
- `22-files/uc-22-4` + `17-gov/uc-17-2`：撤回后**物理删除**（D-15 两级 SLA）

### 裁决
**撤回删除是不可变原则的唯一豁口，必须显式建模，不能靠「实现时再说」。**

- 豁口的边界：**只有合规撤回**能删快照，且必须同时作用于 **S3 与 PG**（否则指针悬空）。
- 删除后引用它的下游**标失效而非静默消失**（D-19：对内可见，对外需人工确认后替换）。
- ⚠ 与 **O-01「不可删对象不受留存期约束、单独走 O-39 法定留存清单」**相接，
  而 **O-39 本身仍是外部合规输入缺口**（需合规/法务给）。
  ⇒ 在 O-39 给出之前，「哪些快照属于法定留存、不得删」**没有判据**。这是真实阻塞点。

---

# 二、错误语义一致性检查

三个业务束各有失败枚举（8 + 12 + 11 = 31 种）。查同一种失败是否用了同一个码：

| 失败情形 | identity | artifact | context-pack | 一致？ |
|---|---|---|---|---|
| 无项目角色 | `NO_PROJECT_ROLE` | 前置条件引用 identity | 前置条件引用 identity | ✅ 三束共用一个来源 |
| 资源不存在 vs 无权限 | 不泄露存在性 | `ARTIFACT_NOT_FOUND` **兼任草稿越权**（404 非 403） | — | ✅ 语义一致 |
| 依赖不可用 | `AUTH_SERVICE_UNAVAILABLE`（**一律拒绝不降级**） | `DEPENDENCY_UNAVAILABLE`（不静默） | `RETRIEVAL_UNAVAILABLE`（**阻断 AI**） | ✅ 三者都是「拒绝而非降级」 |
| 机密约束 | `resolveModelConstraint` | — | `resolvePackModelConstraint` | ⚠ **见 X-5** |

## ⛓ X-5 机密模型约束有两个入口

`identity.resolveModelConstraint` 与 `context-pack.resolvePackModelConstraint` **是同一条判定（D-U1 全程本地）的两处**。

### 裁决
**判定归 `identity`（它持有 `OrgKind` 与 `modelPolicy`），`context-pack` 消费其结果并附加自己的 `dataScope`。**
两处返回的 `source`（`promise` / `policy` / `none`）**必须来自同一个函数**，
否则会出现「一处说是产品承诺、一处说是组织策略」——而这两者的可否关闭性质完全不同。

---

# 三、单源检查：有没有第七次漂移的候选

> 本项目已 **6 次**因「同一事实声明在两处」而漂移：
> 设计 token · 字号档位 · 丢弃原因枚举 · 撤回链 SLA · 估点 · 七态保留 testid（第 6 次已在本轮提前掐掉）。

| 候选 | 出处 | 处置 |
|---|---|---|
| ~~手写 mock 的 `interface`~~ | 同上 | ✅ **已处置（2026-07-28）**，见下方「X-6」 |
| **丢弃原因枚举跨包引用** | `context-pack.ts` 从 `apps/web/lib/omission-reason.ts` import —— 契约包依赖 app 包，方向反了 | 迁进 `packages/contracts`，app 侧改为再导出 |
| token 豁免清单 | `web-kernel` G-3：`globals.css` 的 `@contrast none` 与测试里硬编码的 Set | 让测试从 CSS 动态解析 |
| 屏清单 | `web-kernel` G-4：`verify-ui-states.sh` 的 `SCREENS` 手维护 | 从路由表派生（phase-01 屏数增长后风险放大） |

## ⛓ X-6 门控漏网已补，且查出的比预计的多 —— 附一条真分歧

复核初稿指出 `lint-contract-source` 只抓 `export const/type`、**漏过 `interface` 形态**。
已扩规则，扩完抓到 **5 处**（比预计的 3 处多）。逐个分辨性质后，**处置方式不同**：

| 名字 | 契约侧字段 | 前端侧字段 | 性质 | 处置 |
|---|---|---|---|---|
| `Organization` | id name kind team modelPolicy | **完全相同** | **真重复** | 改为 `z.infer<typeof C.Organization>` |
| `Citation` | segmentId artifactVersionId | index sourceFullName anchor anchorKind | **同名不同层**：线上引用 vs 渲染视图 | 前端改名 `CitationView` |
| `Omission` | ref reason compliance explain | id kind title reason detail sourceRef | 同上 | 前端改名 `OmissionView` |
| `IngestionRun` | id artifactId **status** idempotencyKey pipelineVersion note | id fileName **state** elapsed failure duplicateOf reviewReasons artifactId | 同上，**但藏着真分歧** | 前端改名 `IngestionRunView`；⚠ 见下 |

### ⚠ `IngestionRun` 的 `status` vs `state`

同一个东西**线上字段名叫 `status`、前端视图叫 `state`**。
这与之前抓到的 `"org" | "team"` vs `"org-wide" | "team-only"` 是**同一类**——
**会成为联调 bug**。写下来是因为：它不是「视图多几个字段」，而是**同一语义两个名字**。

⇒ 需裁决：以契约的 `status` 为准（建议），还是以前端的 `state` 为准。
   改名的一侧要连带改所有引用。

### 顺带确立的一条命名纪律

**线上结构与渲染视图同名会掩盖分歧。** 视图模型一律加 `View` 后缀，
使「这是契约里的那个 X 吗」在读代码时就有答案，而不是靠人去比字段。
⚠ 门控现在只能抓「同名」，**抓不到「不同名但其实是同一个概念」**——
那种只能靠这里的人工复核。

---

# 四、开工前必须补的（阻塞项）

| # | 事项 | 为什么阻塞 |
|---|---|---|
| B-1 | **X-2 provenance 查询面**提取为共享契约 | 不做则两束各写一个，之后合并是返工 |
| B-2 | **X-1 批量判定**加进 `identity` 的 `Authorize` | 不做则召回层逐条调用，性能压力会诱导绕过 |
| B-3 | **X-5 机密判定**统一到 identity | 不做则 `source` 语义可能分叉 |
| ~~B-4~~ | ~~`lint-contract-source` 扩规则~~ | ✅ **已完成**，见 X-6 |
| B-6 | **裁决 `IngestionRun` 的 `status` vs `state`** 用哪个名 | 同一语义两个名字，不定就是下一个联调 bug（X-6） |
| B-5 | 丢弃原因枚举迁进 `packages/contracts` | 契约包不该依赖 app 包 |

# 五、不阻塞但需人类裁决

| # | 事项 | 需要谁 |
|---|---|---|
| N-1 | **O-39 法定留存清单**（X-4 的判据） | 合规 / 法务 —— **外部输入缺口** |
| N-2 | pgvector 带权限过滤的 recall 基线数值 | 产品 —— 它是上线门槛却没有门槛值 |
| N-3 | token 预算五路各自配额（O-36 只定了总量） | 产品，不阻塞 |
| N-4 | Context Pack 快照留存期 | 合规（并入 D-14 五参数） |
| N-5 | 「删除组织」API 提供与否（identity 缺口 5） | 建议不提供，用架构测试断言路由表里没有 |
| N-6 | REVIEW_PENDING 触发判据（含数值阈值） | 产品；先做结构性断言「命中即进复核、不得静默入库」 |
| N-7 | **V9 响应式无自动化覆盖**（web-kernel G-2） | 需装 Playwright。UC-0.4 R8 承诺「以机器门控代替人类 sign-off」，**V9 是唯一未兑现的一条** |

---

# 六、签核前请重点核对

- [ ] **X-1 / X-2 / X-5 三条统一处置的归属对不对** —— 归错了会导致两束各造一套
- [ ] **X-3「出网为零」有没有人认领** —— 它是契约管不到的东西，最容易在缝里掉下去
- [ ] **X-4 的豁口边界** —— 「快照不可删」与「合规必须删」的冲突处置，
      且它依赖 **O-39 这个外部输入缺口**（N-1）
- [ ] **B-4：门控漏网** —— `lint-contract-source` 漏过 `interface`，第七次漂移正在酝酿
- [ ] **N-7：V9 是 UC-0.4 R8 承诺里唯一未兑现的一条**

## 确认动作

人类核对后把 frontmatter 的 `status` 改为 `confirmed`，填 `confirmed_by` / `confirmed_at`。
⚠ **这是人的动作，不是 agent 的。**
四个束的 `design-signoff.md` 也各需人类单独签。
