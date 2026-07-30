# 契约束 `research` — 支撑材料②：UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，只要有一条 UC 的验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature：**F144 F145 F146 F147 F148**（5 个 / 21 点）。
> ⚠ **这一行是派生视图，不是权威。** 权威是 `design-signoff.md` frontmatter 的
> `covers:`（ADR-023 决策三）。
>
> 依据 UC：`24-research/uc-24-1` … `uc-24-5`（**5 份**）。
> R12 验收线索合计 **41 条**：
> `uc-24-1: 9 · uc-24-2: 8 · uc-24-3: 7 · uc-24-4: 9 · uc-24-5: 8`。
>
> 第 ③ 件（API 契约）：`packages/contracts/src/research.ts`，**12 个操作 / 12 个错误码**。

## 怎么读这张表

**两个方向都要查，缺一个方向就是白查**（`contract-design.md` 硬规则）：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**（第一、二节）
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**（第三节）

「前端消费点」列填**已建成界面**里的真实 `data-testid` 或路由；填不出来的标 **未建**，
**但不能空着**。「状态」列是**缺口的名字**——⚠ 编号见第四节的缺口清单。

---

## 🔴 先说清楚这份表现在是什么

**它不是「已覆盖」的证明，它是一张逐行标注了缺口的覆盖映射表。**

上一版本文只有一段散文（「本文现在不是覆盖证明，是覆盖缺口清单」），
于是 `lint-third-artifact.mjs` 报「找不到任何以 R12 编号为行键的映射表」——
**那条红是对的**：没有表 = 这份文件根本没在做映射这件事。

现在补上表，但**没有为了消红给任何一行填假落点**（纪律第 10 条）。
判据是**逐行全称**：每一条 R12 要么有真实端口落点，要么**具名了缺口**。
41 行里 **41 行有端口落点**、**41 行的前端消费点是「未建」（缺口 1）**、
另有 **9 行带第二个具名缺口**（Q-7 / Q-8 / Q-10 / Q-12 / Q-14 之一）。

⚠ **「有端口落点」≠「能验收」。** 端口是**契约面**的落点；
5 条被待裁枚举卡住的线索**现在写不成机械判据**，它们在下表里逐行具名，
并在第二节被单拎出来。**不要把这张表读成「41 条都验得了」。**

---

## 一、`uc-24-1` 新建深度研究与研究配置（R12 共 9 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 三处入口任一打开弹层，标题与副标题逐字一致 | `createResearch`（入口是它的三个触发点） | **未建** | ⚠ **缺口 1**（Q-2 路由未定） |
| V2 | 七组字段默认值逐项等于 R3 表（成功态断言） | `ResearchConfig` 七个字段的形状 | **未建** | ⚠ **缺口 1**；默认值本身**刻意不在契约里**（属界面层，见 `research.ts` 的 `ResearchConfig` 注） |
| V3 | 改任一字段预览句实时重算（性质断言：含所选来源全部名称） | `ResearchConfig`（纯前端重算，**不发请求**，R9） | **未建** | ⚠ **缺口 1**；两串深度文案哪串权威 → ⚠ **缺口 9**（Q-1） |
| V4 | 从小组能力面进入时「组」被预填为该组（A1） | `ResearchConfig.groupRef` | **未建** | ⚠ **缺口 1** |
| V5 | 创建后落到详情屏并出现「研究已创建 · …」提示 | `createResearch` → `getResearchDetail` | **未建** | ⚠ **缺口 1** |
| V6 | **E1**：模型不可用时研究仍创建成功、停待运行、可重试 | `createResearch.err` **不含** `MODEL_UNAVAILABLE`（它属 `runResearch`） | **未建** | ⚠ **缺口 1**；⚠ 这条的判据是**契约里没有那个码**，加进去 E1 当场破 |
| V7 | **E2**：问题为空时拒绝提交 | `ResearchConfig.question` 的 `.min(1)` | **未建** | ⚠ **缺口 1**；⚠ **缺口 10**：`VALIDATION_FAILED` 在 `usecases.md` 1.1 有、零节无（`KNOWN_CONTRACT_GAPS.R6`） |
| V8 | **N-10**：`?as=obs` 下三处入口按钮**不存在于 DOM**（不是 disabled） | 各写端口 → `NO_PROJECT_ROLE` / `PROJECT_ROLE_INSUFFICIENT` | **未建** | ⚠ **缺口 1**；⚠ **缺口 11**：`usecases.md` 写的 `FORBIDDEN_ROLE` 全仓无出处 |
| V9 | **R7.5**：默认值断言逐项写死（本 UC 最容易画反的一处） | —（界面层断言；契约刻意不持有默认值） | **未建** | ⚠ **缺口 1** |

---

## 二、`uc-24-2` 深度研究对话与交叉验证（R12 共 8 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 四段标题逐字出现，段 ③ 置信度以**数值**渲染 | `getResearchDetail` → `ResearchResult` 四段 + `Evidence.confidence` | **未建** | ⚠ **缺口 1** |
| V2 | **N-3**：置信度 0.3 的来源**出现在**段 ③（不被过滤） | `getResearchDetail`（**刻意没有任何 `minConfidence` 参数**） | **未建** | ⚠ **缺口 1**；⚠ 判据是**契约里没有那个参数** |
| V3 | **N-2 的生产侧**：单来源结论落进段 ②，段 ① 不含它 | `runResearch` 后置 → `ResearchResult.disputed` | **未建** | ⚠ **缺口 1** |
| V4 | 段 ③ 为空时 `加入洞察库` 被阻断（**在 `uc-24-4` 验收**） | `promoteConclusionToInsight` → `NO_EXTERNAL_SOURCE` | **未建** | ⚠ **缺口 1**（落点在 24-4 / V1） |
| V5 | **E1**：12 路中 3 路失败 ⇒ 已完成路可见 + 失败路可重试 | `runResearch.out` 的 `plannedRoutes` / `completedRoutes` / `failedRoutes` | **未建** | ⚠ **缺口 1** |
| V6 | **E2**：零来源时段 ④ 是数据需求说明，不含断言性结论 | `ResearchResult.isDataRequest` | **未建** | ⚠ **缺口 1** |
| V7 | **N-10**：`?as=obs` 下无输入框、无出口动作按钮 | `askFollowUp` → `PROJECT_ROLE_INSUFFICIENT` | **未建** | ⚠ **缺口 1** |
| V8 | **R7.1**：来源偏好只含「官方与监管」时，执行步骤类别计数**不含**媒体/行业 | `runResearch.out.sourceCounts` + `SOURCE_PREF_VIOLATION` | **未建** | ⚠ **缺口 1** + ⚠ **缺口 2**（Q-7 未裁：全称↔简称映射未定，`sourceCounts` 的键现在是 `z.string()`，**这条写不成机械判据**） |

---

## 三、`uc-24-3` 研究 Studio 列表与研究计划详情（R12 共 7 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 三处列表各自渲染，头部文案与标签行逐字一致 | `listResearch` | **未建** | ⚠ **缺口 1** + ⚠ **缺口 3**（Q-10：状态徽章的词表未收敛，`Research.status` 是 `z.string()`） |
| V2 | **R7.1**：证据数改 7 ⇒ 卡片显示 `证据 7 / 50`（分子跟数据走） | `getResearchPlan.out.evidenceCount` | **未建** | ⚠ **缺口 1** |
| V3 | **N-8**：目标缺失渲染 `/ —` 而**不是** `/ 0` | `getResearchPlan.out.evidenceTarget` 是 `nullable` | **未建** | ⚠ **缺口 1** |
| V4 | **N-7**：归档后仍能被 `已归档` 筛出，**且**被引证据仍可解析 | `archiveResearch` + `listResearch{archived}` | **未建** | ⚠ **缺口 1**；⚠ 两半都要断，只断前半会漏掉 D-20 立论的依据 |
| V5 | **E5**：`?as=obs` 下未共享的研究**不在返回的数据里**（数据层，非 DOM） | `listResearch`（可见性在数据层过滤） | **未建** | ⚠ **缺口 1** |
| V6 | 证据表四列表头逐字 `证据 / 来源 / 置信度 / 去向` | `getResearchPlan.out.evidence` → `Evidence` 四字段 | **未建** | ⚠ **缺口 1** + ⚠ **缺口 5**（Q-8：三计数里「研究问题」在一层模型下无对象可数，`questionCount` 因此可空） |
| V7 | **R7.2**：「去向」取值 ⊆ 单一事实源枚举（性质断言） | `Evidence.disposition`（现为 `z.string()`） | **未建** | ⚠ **缺口 4**（Q-12：值域**与归属**双未裁——`反对证据` 与 phase-03 `14-brain` 的「≥1 条反对证据」是同一概念）。**UC 自己就写着「Q-12 裁定前此条挂起」** |

---

## 四、`uc-24-4` 研究结论回流与去向（R12 共 9 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | **N-1**：无外部来源 ⇒ 入库被阻断（**断在行为上，不是 `disabled` 属性**） | `promoteConclusionToInsight` → `NO_EXTERNAL_SOURCE` | **未建** | ⚠ **缺口 1** |
| V2 | **N-2**：「争议 / 不确定」条目无入库入口 / 入口阻断 | 同上 → `EVIDENCE_IS_DISPUTED` | **未建** | ⚠ **缺口 1** |
| V3 | **N-3 的下游一半**：低置信来源入库后**仍带标注** | `CandidateInsight.evidence`（携带证据本身，不是一个计数） | **未建** | ⚠ **缺口 1** |
| V4 | **A1**：`n0 不挂节点` 的研究入库成功且**无**回流记录 | `out.nodeBackflow.attempted === false`（**合法路径不是降级**） | **未建** | ⚠ **缺口 1** |
| V5 | 挂了 `n1` 的研究入库后，节点上出现一条带置信度的回流记录 | `out.nodeBackflow.ok === true` | **未建** | ⚠ **缺口 1**；⚠ **缺口 6**：节点侧实体属 phase-02 `09-kg`，**本 phase 只留出口** |
| V6 | **E2**：节点已删 ⇒ **入库成功** + 回流失败原因可读（部分成功） | `out.nodeBackflow.reason === "DECISION_NODE_GONE"`（**不在任何 `err` 里**） | **未建** | ⚠ **缺口 1** |
| V7 | **E5**：下游 500 ⇒ 结论原状保留、可重试、**不显示已入库**（禁乐观 UI） | 同上双返回 | **未建** | ⚠ **缺口 1** |
| V8 | **N-10**：`?as=obs` 下三个出口按钮**不存在于 DOM** | `promoteConclusionToInsight` → `PROJECT_ROLE_INSUFFICIENT` | **未建** | ⚠ **缺口 1** + ⚠ **缺口 11** |
| V9 | **N-11**：入库产出的是**候选**洞察，状态含「待…验证 / 待入定题池」 | `CandidateInsight.candidateStatus` | **未建** | ⚠ **缺口 1** + ⚠ **缺口 7**（下游验证目的地「综合 Studio」**在任何 phase 都不存在**，Q-11 / X-D） |

---

## 五、`uc-24-5` 现场深度研究与冲突判定（R12 共 8 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 屏头 `本场研究任务 \| n 个 · m 个已就绪` 两数随数据变化（性质断言） | `listLiveResearchTasks.out` 的 `total` / `ready`（**派生值**） | **未建** | ⚠ **缺口 1** + ⚠ **缺口 3**（Q-10：`ready` 的判据依赖状态词） |
| V2 | **A1**：开「只看有冲突的」⇒ 返回集 ⊆ {冲突数 > 0 的行} | `listLiveResearchTasks{onlyConflicts}`（判据取 `conflictCount > 0` **而非状态词**） | **未建** | ⚠ **缺口 1** + ⚠ **缺口 3** |
| V3 | **A2**：冲突置零 ⇒ 冲突区**仍然渲染**空态（不是消失） | `listConflicts.out.pending`（恒返回，可为 0） | **未建** | ⚠ **缺口 1** |
| V4 | **N-5**：待判定冲突的两条结论停在段 ②，且入库被阻 | `promoteConclusionToInsight` → `CONFLICT_PENDING_HUMAN` | **未建** | ⚠ **缺口 1** |
| V5 | **N-6**：三个动作**都不是**预选/自动执行（无 autofocus、无倒计时） | `ResearchConflict` **刻意没有** `suggestedAction` / `countdownSeconds` 字段 | **未建** | ⚠ **缺口 1**；⚠ 判据是**契约里没有那些字段** |
| V6 | **N-9**：每行含提出方；判定后能读到「谁在何时选了哪一条」 | `tasks[].proposedBy` + `ResearchConflict.resolution` 三字段 | **未建** | ⚠ **缺口 1** |
| V7 | **E1**：一行的 agent 失败 ⇒ 其余行状态不变 | `runResearch` → `AGENT_RUN_FAILED`（单行，非整屏） | **未建** | ⚠ **缺口 1** + ⚠ **缺口 11**（`AGENT_RUN_FAILED` 声称来自 `agent-runtime`，**那束里没有**） |
| V8 | **R5 / E4**：`?as=obs` 与**组长视角**下三个判定动作不存在于 DOM | `resolveConflict` → `PROJECT_ROLE_INSUFFICIENT` | **未建** | ⚠ **缺口 1** + ⚠ **缺口 8**（Q-14 未裁：组长能否判定；契约**不设角色分支**，UC 自己写着「裁定后复核」） |

---

## 六、反方向：API → UC（有没有多余的操作）

> 「某个 API 操作没有任何 UC 要它」= 接口多余，或有 UC 没写。
> 逐个核过 `packages/contracts/src/research.ts` 的 **12 个操作**：

| 操作 | 被哪条 UC 要 | 判定 |
|---|---|---|
| `createResearch` | 24-1 R3 | ✅ |
| `runResearch`（含重试） | 24-1 E1 · 24-2 R3 · 24-5 E1 | ✅ ⚠ `usecases.md` 1.2 在同一标题下**只给一个签名**，故重试 = 再调一次，**不另开路由** |
| `askFollowUp` | 24-2 R2 / A1 | ✅ |
| `promoteConclusionToInsight` | 24-4 R3 | ✅ |
| `resolveConflict` | 24-5 R3.6 | ✅ |
| `archiveResearch` | 24-3 R3.B.4 | ✅ |
| `pinResearch` | 24-3 A2 | ⚠ 与「标为关键问题」是否同一动作 **Q-13 未裁** ⇒ 两者**不合并**（合并了再拆比现在多一条迁移） |
| `listResearch` | 24-3 R3.A/B/C | ✅ |
| `getResearchPlan` | 24-3 R3.D | ✅ |
| `getResearchDetail` | 24-2 R3 | ✅ |
| `listLiveResearchTasks` | 24-5 R3.2–3.3 | ✅ |
| `listConflicts` | 24-5 R3.4–3.6 | ✅ |

**无多余操作。**

**反方向还查出两件 UC 侧的东西**（这才是这个方向的价值所在）：

1. **`copyResearch` 有 UC 要它，契约里却没有。** `uc-24-3` A3 的 `copyDrItem` 提示逐字
   「已复制为新的深度研究」`[原型 @16,906,921B]`，而「只复制七项配置」是 `[设计]` 不是原型出处
   ⇒ `usecases.md` 1.6 逐字「Q-4 未裁前不实现」。**这是一条 UC 有、API 没有的边**，
   但它**不在 R12 的 41 条里**（`uc-24-3` 的 R12 没有为复制写线索），
   所以它不会让上面任何一行悬空。登记为 ⚠ **缺口 12**。
2. **`usecases.md` 第三节那 5 个「随裁决增删」的端口不参与本方向判定**——
   它们现在还不是端口，是**登记在案的未定项**（已落成 `research.ts` 的 `PENDING_PORTS`，
   连同 `CopyResearch` 共 6 条）。

---

## 七、缺口清单（**每一条都有名字，会在每次 `doctor` 里出现**）

| # | 缺口 | 卡在哪 | 影响的行 |
|---|---|---|---|
| **缺口 1** | **全部 41 行的「前端消费点」填不出来** | **Q-2 未裁**：`/studio/research` 被 UC-0.2 Context Pack 占用（`navigation.ts:75` 的 `ucRefs` 逐字 `["00-core/uc-0-2"]`），本束的屏落在哪条路由上还没定 ⇒ `data-testid` 无处锚定 | **全部 41 行** |
| **缺口 2** | 来源类别全称 ↔ 简称映射未定 | **Q-7** | 24-2 / V8 |
| **缺口 3** | 研究状态枚举未收敛（四屏至少八个词） | **Q-10** | 24-3 / V1 · 24-5 / V1 · 24-5 / V2 |
| **缺口 4** | 证据「去向」的值域**与归属**双未裁 | **Q-12**（与 phase-03 `14-brain` 同概念） | 24-3 / V7 |
| **缺口 5** | 实体分一层还是两层 | **Q-8** | 24-3 / V6（三计数里「研究问题」的归属） |
| **缺口 6** | 决策节点实体属 phase-02 `09-kg` | 范围（非待裁） | 24-4 / V5 —— 本 phase **只留出口不实现下游** |
| **缺口 7** | 「综合 Studio」在任何 phase 都不存在 | **Q-11 / X-D**，且 `interview`（**已签核**）里已有这个出口 | 24-4 / V9 |
| **缺口 8** | 组长能否执行现场冲突判定 | **Q-14** | 24-5 / V8 |
| **缺口 9** | 深度档位两串文案哪串权威 | **Q-1** | 24-1 / V3 |
| **缺口 10** | `VALIDATION_FAILED` 在 `usecases.md` 1.1 有、零节无 | 文档内部不一致 | 24-1 / V7（`KNOWN_CONTRACT_GAPS.R6`） |
| **缺口 11** | 🔴 **零节「复用（不新建）」五条里四条出处不成立** | `FORBIDDEN_ROLE` / `AGENT_RUN_FAILED` / `QUOTE_REVOKED` / `SOURCE_OUT_OF_SCOPE` 全仓零命中；`MODEL_UNAVAILABLE` 在 `skills` 不在 `agent-runtime` | 24-1 / V8 · 24-4 / V8 · 24-5 / V7（`KNOWN_CONTRACT_GAPS.R1`） |
| **缺口 12** | `copyResearch` 有 UC 要、契约无 | **Q-4** | 不影响 R12 任何一行（见第六节） |
| **缺口 13** | 🔴 **X-E 与 `files`（已签核）对不齐** | 已签核的 `artifact.ArtifactSource` 用 `research-run`，界面侧与本束 X-E 用 `research` | 不影响 R12 任何一行，但**它是本束优先被解锁的原因**（`KNOWN_CONTRACT_GAPS.R3`） |

---

## 八、这份覆盖证明现在**不够**的地方（签核时请读这一节）

1. **41 行的「前端消费点」全是「未建」。** 这不是悲观陈述，是真实状态：
   `apps/web/components/research/` 服务的是 UC-0.2 Context Pack，与本表任何一行都不对应
   （机械核实：`grep -c "研究场景\|时间盒\|桌面研究" apps/web/lib/mock/research.ts` → **0**）。
2. **5 条线索现在写不成机械判据**（24-2/V8 · 24-3/V1 · 24-3/V7 · 24-5/V1 · 24-5/V2），
   卡在 Q-7 / Q-10 / Q-12 三个枚举上。**它们在表里逐行具名，没有一条被填成假落点。**
3. **「有端口落点」≠「已实现」。** 本束端口 **0 条已实现**——
   F144…F148 全部 `not_started`，且开工前置（`status: confirmed` ∧ 阶段一致性复核）都还没有。
4. ⚠ **不要为了让这张表看起来完整而先填一个猜测的路由或 `data-testid`。**
   `skills` 束栽过一次同形的坑：`ui.md` 按约定写了 14 个**设想的**文件名，14 条全是死链
   （留痕在 `contracts/skills/ui.md` 顶部）。**同样的错不在这里犯第二次。**

## 九、解除这些红的路径（顺序不可颠倒）

1. 人类裁 `OPEN-QUESTIONS.md`（**至少 Q-2 / Q-8**，建议连 Q-10 / Q-12 / Q-7 一起）。
2. 按裁决回改 `domain.md` / `usecases.md` / `research.ts`。
3. **ui-prototyper** 产出 `ui-preview/research/`，回填 `ui.md` 与真实 `data-testid`。
4. 回到本文，把「前端消费点」列的 **未建** 逐个换成真实消费点（缺口 1 随之关闭）。
5. **然后**本文才成为覆盖**证明**，而不只是一张标注了缺口的映射表。
