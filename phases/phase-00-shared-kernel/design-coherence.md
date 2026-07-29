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

> **2026-07-29 处置进度：7 条中 5 条已关闭或转为结构性断言，2 条转为对外问询。**
> N-5 / N-7 已实现关闭；N-2 / N-3 / N-6 的**规则**已做成可执行断言，只剩数值待产品；
> N-1 / N-4 需合规与法务输入，已成文问询 → `phases/requirements/COMPLIANCE-INQUIRY.md`。
>
> ⚠ 待定的数值全部登记在 `packages/contracts/src/thresholds.ts`，
> **取值时抛错而不是返回默认值**，且业务代码里硬编码会被门控拦下——
> 本项目发生过一次「有人编了 sampleSize=18 制造出已算过的假象」，这是防它复发的机制。


| # | 事项 | 需要谁 |
|---|---|---|
| N-1 | **O-39 法定留存清单**（X-4 的判据） | 🔴 仍缺。已成文问询 → `phases/requirements/COMPLIANCE-INQUIRY.md` Q-1。代码里登记为 `legalHoldCategories: {known:false}`，**取值抛错而非放行**（放行等于默认全都能删，那是更危险的默认） |
| N-2 | pgvector recall 基线 | ✅ **结构性断言已就位（2026-07-29）**：规则「低于基线判失败、不得静默放行」已可断言；数值登记为 `vectorRecallBaseline: {known:false}`，产品给出后填 `{known:true, value, source}` |
| N-3 | token 五路配额 | ✅ **结构性断言已就位**：规则「五路之和不超总预算、任何截断必须产生 budget 类 omission」已可断言；配额值待产品 |
| N-4 | 留存期五参数 + Context Pack 快照留存期 | 🟠 仍缺。已成文问询 → `COMPLIANCE-INQUIRY.md` Q-2 / Q-4。⚠ 顺带修了一处真风险：`/consent` 上的「180 天」**曾被写死**，只要有项目配了不同值就会向受访者作出与实际不符的承诺；已改为显式占位 + 门控防止重新写死 |
| ~~N-5~~ | ~~「删除组织」API 提供与否~~ | ✅ **已关闭（2026-07-29）**：取「不提供」。补 `no-forbidden-routes.test.ts` 断言路由表里确实没有它——**「没有」这件事本身没人会去验**，某天有人为别的需求加上，不会有任何东西报警；这个测试就是那个警报。同时禁掉 `DELETE /artifacts/*/versions` 与 `PUT/PATCH/DELETE /provenance`（append-only） |
| N-6 | REVIEW_PENDING 触发判据 | ✅ **结构性断言已就位**：规则「命中即进复核、不得静默入库、处置必留痕」已可断言；阈值待产品 |
| ~~N-7~~ | ~~V9 响应式无自动化覆盖~~ | ✅ **已关闭（2026-07-29）**：装 Playwright，75 断言（25 屏 × 3 档）。⚠ **断言写了三版才真正有效**，前两版都「全绿」但都在空转——过程记在 `web-kernel/coverage.md` 末尾。顺带抓到画布在 375/768 下裁掉 245px 且不可达的真缺陷，已修。**UC-0.4 R8「V1–V10 无一依赖人工判断」的承诺现已全部兑现** |

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

---

# 七、修订 A（2026-07-29）—— 第五个束 `api-kernel` 加入，**需人类复签**

> ⚠ 上面第一节的复核范围表（四束 / 17 feature / 88 点）是 **2026-07-28 的状态**。
> 起第一个 sprint 时核实出一处缺失，补了第五个束。本节记录它对复核结论的影响。
> **frontmatter 的 `status` 仍是 2026-07-28 那次的 confirmed，agent 未改动**——
> 本节的内容需要人类重新过目并决定是否重签。

## 为什么补这个束

F01「两层角色落到 `acl_bindings`」估 **5 点**，开工前核实发现它的前提不存在：
`apps/api` 不存在、零 NestJS、零迁移、零 PG 连接。F01 实际要交付的是
「NestJS 骨架 + 洋葱四层 + 迁移体系 + RLS 策略 + `acl_bindings` 表 + 两层交集判定」——
**估点失真三倍**，且 F02~F13 十二个后端 feature 的共同前置会被埋进 F01 里，
**下一个 feature 的人不知道它已经有了**。

⇒ 拆出 **F18 后端内核**（`uc-0-6`，13 点），契约束 `api-kernel`。
理由与 UC-0.4 从 F01~F13 里拆出前端内核完全相同——**前端有内核，后端没有**。

## 复核范围表更新

| 束 | feature | 点 | 说明 |
|---|---|---:|---|
| 原四束 | F01–F17 | 88 | 2026-07-28 已签 |
| **`api-kernel`（新）** | **F18** | **13** | 待签 → `contracts/api-kernel/design-signoff.md` |
| **合计** | **18 个 feature** | **101** | |

同时：**F01 转 `blocked`**，`depends_on: [F18]`。解除条件是 F18 passing。

## 对四条交叉约束的影响 —— **只有 X-3 需要重新看**

| 约束 | 受影响？ | 说明 |
|---|---|---|
| X-1 权限沿数据链路传播 | ❌ 不受影响 | 本束零业务领域、零业务表，不引入新的跨束语义 |
| X-2 provenance 查询面 | ❌ 不受影响 | 同上 |
| **X-3 出网为零** | ✅ **本束是它的自然归属** | 见下 |
| X-4 快照不可删 vs 合规撤回 | ❌ 不受影响 | 同上 |
| X-5 机密模型约束两个入口 | ❌ 不受影响 | 同上 |

### X-3 的归属终于有着落了

原文写：「**这条如果没人认领，它会在前后端的缝里掉下去**：前端以为后端管，
后端以为运维管。⇒ 签核时必须确认它有归属。」

⚠ **复核当时并没有任何束能认领它**——`identity` 管判定、`context-pack` 管召回，
都不管部署形态。这一条当时是**带着缺口签过去的**。

`api-kernel` 认领它的**落点**：`docker-compose.dev.yml` 与部署清单里的网络策略位，
并在文件里署名负责人。**deny-all 的断言**留给 **F16**（本地组织完整形态）——
断言需要本地组织的完整形态才有意义。

⇒ **请在复签时确认这个分工**（落点归 `api-kernel`、断言归 F16）。
若不认可，请指定另一个归属——**但不要让它再悬空一轮**。

> ### ✅ 归属已确认（2026-07-29，yanbin shen 签 `api-kernel` 束时一并确认）
> **X-3「出网为零」不再悬空**：落点归 `api-kernel`（F18 交付
> `docker-compose.dev.yml` 与部署清单里的网络策略位并署名），
> deny-all 的**断言**归 **F16**（本地组织完整形态）。
> ⚠ 这是本条从 2026-07-28 复核起第一次有明确归属——在此之前它是**带缺口签过去的**。

## 顺带修正：第一节表格里 `web-kernel` 那行

原表 `web-kernel` 的「操作」列写「—（门控即契约）」。`api-kernel` 同理。
两个内核束的第 ③ 件都不是 zod：`web-kernel` 因为**没有后端消费者**，
`api-kernel` 因为它是 zod 的**消费者不是生产者**（执行者是 node 脚本 / SQL /
PG 系统目录 / NestJS 管道，没有一个能 import zod）。两者理由不同，结论相同。

## 复签前请重点核对（在原第六节之外新增）

- [ ] **X-3 的分工成立吗**（落点归 `api-kernel`、断言归 F16）
- [ ] **A-4：后端不引入 ORM** —— 决定 F01~F13 全部持久化代码的写法，很难回头
- [ ] **两处现存的门控空洞** —— `lint-arch-deps` 至今**从未扫过一个文件**；
      `lint-contract-source` **只覆盖前端侧**，后端抄一份 DTO 不会有任何东西报警
- [ ] **F01 转 blocked 的处置认可吗** —— 它仍在 sprint 00/01 里，但已挂在 F18 上

---

# 八、修订 B（2026-07-29，F01 实现）—— 契约束 `identity` 的两处缺陷，**需人类复签**

> 这两条不是「实现遇到困难所以改契约」，是**契约表达不了它自己声明的状态**。
> 都由机械门控抓出来，不是靠人读出来的——记在这里是因为它揭示了一类此前没人查的东西。

## ⚠ B-7 `PermissionDecision` 表达不了自己的拒绝态

**原定义**（已签）：

```ts
orgLayer:     z.object({ role: OrgRole,     teamId: …, passed: … })          // 非空
projectLayer: z.object({ role: ProjectRole, groupId: …, passed: … }).nullable()
```

**问题**：同一份 `usecases.md` 的失败枚举里，第一条是 `NO_ORG_MEMBERSHIP`
——**「不是这个组织的成员」的判定结果里没有组织角色可填**。
第三条 `NO_PROJECT_ROLE` 更明确，原文写着「**这是正常状态不是异常**」，
可 `projectLayer.role` 是非空的，同样填不出来。

⇒ 实现时只有三条路：编一个假角色 / 把整个 layer 置空（丢掉「哪一层没过」这个信息）/
把 `role` 放开为可空。**前两条都会让「为什么被拒」失真，而那正是这个对象存在的全部理由。**

**处置**：两处 `role` 改为 `.nullable()`，并在契约里写明两种 null 的区别——
`projectLayer === null` 是「本次请求没有项目上下文」（I-11），
`projectLayer.role === null` 是「有上下文但此人无角色」。
**合并这两者会让前端分不清「不是项目页」与「是项目页但你没权限」**，而这两种要渲染的东西完全不同。

**怎么发现的**：`lint-contract-source` 报「`apps/api` 里用 interface 重新定义了契约已有的
`PermissionDecision`」。改为 `z.infer` 派生后，类型当场对不上。
——门控本来是防副本的，顺手证明了契约本身不成立。

## ⚠ B-8 响应体从未被契约校验过

**问题**：全局 ValidationPipe 校验的是**进来的**请求。**出去的响应没有任何东西校验。**
即 ADR-020「同一份 zod → 后端 DTO + 前端类型」这条链，**返回方向是断的**：
服务端可以返回一个契约没描述的结构，所有门控照样全绿——
因为前端类型也从同一份契约生成，它只会**对现实的判断是错的**，不会报错。

**这不是假设**：F01 实现时，契约的 `Organization` 带 `team` 字段，仓储层的行类型漏了它，
`/identity/me` 会返回一个缺字段的 body。**在 `contract-response.test.ts` 存在之前，没有任何东西会失败。**

**处置**：补 `apps/api/tests/kernel/contract-response.test.ts`，
对每条路由的响应体 `C.operations.<op>.out.safeParse()` 逐条断言，
并**特别覆盖拒绝路径**（就是 B-7 里契约写错的那条）。
另加一组反向断言证明这些 schema 确实会拒绝漂移的 body——否则整个文件可能在空转。

⚠ **刻意不做「响应校验管道」**：那会把一次 schema 疏漏变成生产环境的 500。
构建期失败才是发现它的正确位置。

## 需要人类做什么

1. 复看上述两处对**已签契约束 `identity`** 的修订，认可后重签
   `contracts/identity/design-signoff.md`（agent 不代劳）。
2. 顺带确认一条推论：**「响应必须被契约校验」应当成为所有束的通用要求**，
   而不只是 identity 这一束补了。若认可，它该写进 `contract-design.md` 的硬规则。

## 附：同一轮抓到的一个 NestJS 陷阱（不涉及契约，记着免得再踩）

方法级 `@UsePipes(schema)` 会作用于 **handler 的每一个参数**，包括 `@CurrentPrincipal()`
这类自定义参数装饰器——于是契约 schema 被拿去校验 principal，**所有请求一律 400**。
症状看起来像「客户端请求体不对」，第一反应会去查调用方。
⇒ 校验管道一律挂在**参数**上：`@Body(new ZodBodyPipe(SCHEMA))`。

---

# 九、修订 C（2026-07-29，F03 实现）—— 契约束 `identity` 缺两个操作，**需人类复签**

> 和修订 B 同类：不是「实现遇到困难所以改契约」，是**契约表达不了它自己声明的验收**。
> 两条都由「写断言时发现无处可断」抓出来，不是靠人读文档读出来的。

## ⚠ C-1 V1/V2 记在 `authorize` 名下，而 `authorize` 不返回内容

`contracts/identity/coverage.md` 一、V1 与 V2 两行的「API 操作」列都填的是
`authorize → ADMIN_NOT_SUPERUSER / PERSONAL_LAYER_CLOSED`。两条都对不上：

- **V1 说的是读取路径**。`authorize` 只返回判定对象。于是「管理员不是超级用户」
  只被证明在**判定函数**里成立，**没有任何一条真实读取路径被证明会去问它**。
  判定函数绿着、读取路径绕过它，正是本项目最想防住的那种绿。
- **V2 的断言是「响应体中不存在内容字段」**。`authorize` 的响应体里本来就没有内容字段——
  **拿它去断言 I-8 是空转**。要让这条断言有意义，必须有一个**真的返回了东西**的响应，
  而它返回的恰好只有计数。

**处置**：契约新增两个操作（连同 `ContentLayer` / `ContentStatus` / `ReadPurpose` 三个枚举）——

| 操作 | 路径 | 作用 |
|---|---|---|
| `readContent` | `POST /identity/content/read` | 唯一的内容读取面。个人层与项目层**共用这一道门**，由服务端按 `layer` 分流；另开一个个人层读取接口意味着 I-8 要写两遍，漏掉的那一遍不会有任何东西报警 |
| `getPersonalLayerSummary` | `GET /identity/personal-layer/summary` | 管理员对他人个人层唯一拿得到的东西：计数 |

⚠ `readContent` 是 POST 而非 GET，因为它**有副作用**（审计目的读取必写 `provenance_events`）。
一个会写库的 GET 比一个语义不纯的 POST 危险得多。

## ⚠ C-2 `admin-project-access` 是个没人能产生的事件类型

`provenance.ts` 的封闭枚举里有 `admin-project-access`，注释写着「D-18：必留痕且对负责人可见」。
但**两束的操作表里没有任何一个操作会写它**——R4 A1 的审计目的读取在契约里根本不存在。
即：留痕的**事件类型**定义好了，**产生它的动作**没定义。

**处置**：`readContent` 的 `purpose: "audit"` 就是那个动作，返回 `provenanceEventId`。
查询走**已有的**共享 `queryProvenance`（X-2 的裁决在此第一次被真正消费，没有另造第二个查询面）。

## 两条实现期裁决，请一并复看

1. **审计豁口只给 `admin`，不给 `compliance`。** R5 合规负责人一行写明「可查审计链……
   **不因此获得项目内容读取权**」，R4 A1 的豁口写的是管理员。故两者在此**恰好分道**：
   合规能看到「谁读了什么」，管理员还能看到「什么」，代价是自己进记录。
2. **`purpose: "audit"` 只豁免项目层，不豁免组织层可见性范围。** AC3 说「仅某团队」的资源
   「无论其项目角色为何」都不可见。两层都豁免的话，`purpose: "audit"` 就是一把**谁都能敲出来的万能钥匙**，
   而那正是 D-18 要防的形状。

## 需要人类做什么

1. 复看 C-1 / C-2 对**已签契约束 `identity`** 的修订与上面两条裁决，认可后重签
   `contracts/identity/design-signoff.md`（agent 不代劳）。
2. `coverage.md` 一、V1/V2 两行的「API 操作」列需据此更新（`authorize` → `readContent` /
   `getPersonalLayerSummary`），并复核反向检查表「有没有多余的 API」新增两行。
   ⚠ 这两处**没有由 agent 代改**：覆盖矩阵是签核件的一部分。

---

# 十、修订 D（2026-07-29，F04 实现）—— 三处契约缺陷，**需人类复签 `artifact` 束**

## ⚠ D-1 `Artifact.scope` 是 `acl_bindings.scope` 的第二份声明

契约给 `artifacts` 一个 `scope` 字段。但 `authorize()` **只从 `acl_bindings` 读 scope**，
从别处一概不读。两处都存 ⇒ **鉴权器不看的那一份可以是错的，而且看起来是对的**。

这正是本项目已发生七次的那个形态，且这次是在**权限**上。

**处置**：不存。`0006` 里没有 `scope` 列，`Artifact.scope` 是**从绑定投影出来的读模型**
（无绑定 ⇒ org-wide，即已文档化的默认）。理由写在迁移里。
⇒ **契约文本仍写着要存，需要修订。**

## ⚠ D-2 `operations.saveDraft` 做不到它自己 `out` 承诺的事

```
in:  { artifactId?, orgId, projectId, source, title }   ← 不含任何内容
out: { …, materializedKeys }                            ← 却要返回落盘的文件键
```

**按这份契约实现的 HTTP 端点，无论如何都产不出文件。** 而 schema 有 `size_bytes > 0`，
照它建出来的端点只会 400 或者写不进任何东西。

⇒ F04 **刻意不出 controller**：编一个 body 形状（multipart？base64？）就是**第二份请求契约**，
而那是这个项目最不该再犯的错。契约需要先补一个内容/parts 字段，F05 才能接端点。

## ⚠ D-3 `content_items` 被当作 `artifact` 引用，但住在另一张表

`pg-content-repository.ts` 把 `content_items` 的行当 `ObjectRef { kind: "artifact" }` 用。
在 `acl_bindings` 的 I-1 触发器补上 artifact 校验之前，这处**看不出来**——
现在 `admin-boundary-deny.test.ts` 必须塞一行 id 与 `content_items` 相同的 `artifacts`。

它能跑，但它是一次**命名空间碰撞**。已在测试里写明而不是抹平。
⇒ phase-01 `22-files` 之前需要一个明确裁决：content_items 是不是 artifact 的一种。

## 顺带记两条

**F04 自查出自己一条测试是空转的。** 「什么都没写进去」那条用了新的 id 工厂，
于是第二次调用死在主键冲突上，**根本没走到被测逻辑**——把前置检查关掉它照样绿。
改为共用一个 id 工厂后才真正生效。⚠ 第八次「门控看起来在跑其实没在测」。

**`artifacts.id` 是全局主键而非租户内唯一**，与 `projects` / `content_items` 及所有既有表一致，
故是系统性的、不是 F04 引入的。两个后果：并行测试文件会在裸 id 上撞；
调用方可以用主键冲突探测别的租户的 id 空间（尽管 RLS 让行不可见）。
未单方面改动——改它会与五张既有表分家。**需要一次裁决。**

---

# 十一、修订 E（2026-07-29，F09 实现）—— 五处契约缺陷，**需人类复签 `context-pack` 束**

> 同修订 B/C/D：不是「实现遇到困难所以改契约」，是**照契约实现会产出错误行为**。
> F09 只交付结构契约（items/claims/omissions 三段 + 八字段无一为空），下述五条都是在
> 「把一条真实的 F04 segment 变成一条合法 item」这一步撞出来的。

## ⚠ E-1 `Anchor` 有两份声明，且**覆盖面不一致**——`image-region` 无处可去

| 束 | 形状 | 用途 |
|---|---|---|
| `artifact.Anchor` | `{ id, segmentId, kind, locator }`，`kind` 六取值 | **存**（migration 0006） |
| `contextPack.Anchor` | `{ page?, bbox?, startMs?, endMs?, messageId?, surveyQuestionId? }` | **引**（items[]） |

两份都已签核，彼此不引用。映射后：`page→page` `bbox→bbox` `timecode→startMs`
`message-id→messageId` `question-no→surveyQuestionId` 五条通，**`image-region` 一条都不通**——
`contextPack.Anchor` 没有任何字段能装图像区域。

后果不是理论上的：`photo` 是 `ContextSourceType` 的八来源之一，而照片的 segment 正是按
图像区域锚定的。**按签核的契约实现，任何照片派生的 segment 都被 I-1 结构性地挡在 items[] 之外**，
且挡得很安静——它落进 `omissions[]`，读起来像「低相关」，而不是「schema 装不下它的出处」。

**处置**：F09 **不发明字段**（发明 `imageRegion?` 就是实现者写第二份契约，即 F04 对 `saveDraft`
拒绝做的事）。`toContextItemAnchor` 返回 `{ mapped: false, why: "no-field-in-contract" }`，
并在 `context-pack-schema.test.ts` 里把这个缺口**断言下来**，改契约时该断言会红。
⇒ **契约需补 `imageRegion?` 或把两份 Anchor 收敛成一份，需复签。**

## ⚠ E-2 `endMs` 永远填不上——同一缺陷的反向

`contextPack.Anchor` 有 `startMs` + `endMs`（一个区间），`artifact.AnchorKind` 只有
`timecode`（一个点）。**没有任何可存储的东西能填 `endMs`**，而 `SegmentKind` 里有 `audio-span`。
音频区间只能引到它从哪开始，引不到到哪结束。危害小于 E-1，同一个根因。

## ⚠ E-3 「八字段」是九字段

UC-0.2 R12 V10、`feature_list.json` F09、`domain.md` 的小标题都写「**八字段**」并列举八个；
而签核的 `ContextItem` schema 与 `domain.md` 该标题下的表格是**九个**——`channels` 为 V11
（「FTS 是一等通道」的可断言证据）后加。

实现**按 schema 走（查九个）**：schema 是权威，而没人查的那个字段正是会空掉的那个。
⇒ 三处散文的计数需要更正，否则下一个实现者会照「八」写死一份清单。

## ⚠ E-4 I-1 的「落 omissions」分支在封闭七类下**不可执行**

I-1 原文：无锚点候选「**不得进 items，落 `omissions` 或抛 `ANCHOR_MISSING`**」。
但 `OmissionReason` 是封闭七类（D-U4），**七类里没有一类意思是「定位不到」**：
写 `out-of-scope` 对使用者渲染成「不在本次检索范围」，是句谎话；加第八类要走 ADR。

⇒ 「落 omissions」这条路当前**走不通**，只剩抛 `ANCHOR_MISSING` 一条。F09 的
`buildContextItems` 因此把这类候选放在**单独的 `unanchorable` 列表**里返回，不硬塞进七类之一。
后果：E-1 里的照片 segment **既不被引用、也不被解释**——恰恰是 I-2「被丢弃不等于不存在」
要消灭的状态。⇒ 需裁决：补第八类（走 ADR），还是在 Pack 里另开一段。

## ⚠ E-5 I-2 与 I-8 在个人层内容上**互相矛盾**

- I-2：候选集中**每一条**未进 `items[]` 的内容，都要能在 `omissions[]` 找到记录。
- I-8：个人层私有笔记**永不出现**在 `items[]` **与 `omissions.ref`** 两处（连存在都不暴露）。

两条只有在「个人层私有笔记**根本不进候选集**」时才相容——即在候选集构造期就排除
（UC-0.2 R3 第 2 步「个人层私有笔记一律不进」），而不是在过滤期排除。
**`domain.md` 没有任何一处说这件事**，只读 I-2 的实现者会老老实实写下那条 omission 记录，
从而泄漏存在性。⇒ I-2 的措辞需明确「候选集」的定义已排除个人层私有内容。
候选集构造属 F10，F09 已在 `build-items.ts` 头部写明交接。

## 顺带记一条：**V10 通过不等于 V2 通过，而 `coverage.md` 把它们记成同一件事**

`coverage.md` 把 V2（八字段无一为空）的 API 列填 `assembleContextPack（ContextItem schema）`。
**schema 给不了 V2**：`CP.ContextItem.parse()` 接受

```
{ segmentId: "", content: "", artifactVersionId: "", anchor: {},
  retrievalReasons: [], channels: [], score: 0, permissionDecisionId: "" }
```

——每个字段都在、类型都对、校验通过，而这条 item 一文不值：它不引用任何东西、定位不到任何地方，
`permissionDecisionId` 对「为什么这条能给你看」的回答是沉默。**这比缺一条 item 更糟**，
因为缺的看得出来缺，这条会照常渲染、照常占预算、照常被引用。
⇒ V2 与 V10 是两条断言，只有一条能用 zod 表达。F09 交付的
`emptyContextItemFields` / `packStructureViolations` 是另一条；`coverage.md` 该格应分开写。
