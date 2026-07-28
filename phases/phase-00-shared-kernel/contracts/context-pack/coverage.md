# 契约束 `context-pack` — ④ UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，如果有一条 UC 的验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature：F09 F10 F11 F12 F13（`00-core/uc-0-2`），合计 **21 点**
> 验收线索来源：`uc-0-2` 的 R12 共 **13 条**（V1–V13）

## 怎么读这张表

**两个方向都要查，缺一个方向就是白查**：

- **UC → API**：某条 R12 找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**里的真实 `data-testid`（已 `grep` 确认存在）。
填不出来的标 `—（API 层验收）`，但**不能空着**：空着意味着没人想过它怎么被人看见。

---

## 一、`uc-0-2` R12 逐条映射（13 条）

| R12 | 一句话 | API 操作 | 前端消费点（真实 testid） | 状态 |
|---|---|---|---|---|
| V1 | AC1 引用包外证据被拒并记录，引用包内则通过 | `verifyCitation` → `CITATION_OUT_OF_PACK` | `brain-system-prompt` · `research-context-pack` | ✅ |
| V2 | AC2 每条条目八字段六元组无一为空 | `assembleContextPack`（`ContextItem` schema） | `brain-retrieval-segments` · `research-read-list` | ✅ |
| V3 | AC3 被丢弃条目可列出，返回数量与阈值 | `listOmissions` → `droppedCount` / `thresholdUsed` | `brain-omissions` · `research-omission-list` · `research-dropped-count` | ✅ |
| V4 | 管理员/观察者装配**不含个人层私有笔记/原始转写** | `assembleContextPack`（I-8） | `brain-private-closed-notice` · `brain-private-layer` | ⚠ **缺口 2** |
| V5 | 空态返回真实空态，且以该包发起的 AI 调用被阻断 | `gateAiCall` → `EMPTY_CANDIDATE_SET` | `research-context-pack`（`empty` 态） | ⚠ **缺口 1**（Studio 栏未建） |
| V6 | 检索不可用时 AI 入口被阻断，不「无上下文直接生成」 | `gateAiCall` → `RETRIEVAL_UNAVAILABLE` | `dep-failed`（七态保留名） | ✅ |
| V7 | 装配中证据被撤回，上下文栏实时标「证据已撤回」，定版被阻断 | `assembleContextPack` → `EVIDENCE_WITHDRAWN_MIDWAY`；`omissions`(reason=`withdrawn`) | `brain-omissions`（withdrawn 合规可见） | ⚠ **缺口 1**（实时标注在 Studio 栏） |
| V8 | 任取一条已定版结论，还原其定版时完整引用清单 | `replayContextPack` + `pinContextPack` | —（API 层验收，跨 `17-gov` 审计屏） | ⚠ **缺口 5**（留存期未定） |
| V9 | 含机密条目时模型选择只返回自托管模型 | `resolvePackModelConstraint` → `localOnly, source` | `topbar-local-banner` · `topbar-selfhosted-policy` | ⚠ **缺口 6**（本地模型可用性跨束） |
| V10 | ContextPack JSON 通过 schema 校验 | `assembleContextPack` 的 `out = ContextPack` | —（API/纯 schema 层验收） | ✅ |
| V11 | 精确原话 query 命中且 `retrievalReasons`/`channels` 含 FTS——**FTS 是一等通道** | `assembleContextPack`（`items[].channels` 含 `fts`） | `brain-filter-actions` · `brain-retrieval-segments` | ✅ |
| V12 | pgvector 叠加权限过滤后 recall 不低于**约定基线** | `assembleContextPack`（带权限过滤 recall 测试集） | —（API 层验收） | ⚠ **缺口 3**（基线数值未定） |
| V13 | 每条未进 `items[]` 的内容都能在 `omissions[]` 找到丢弃原因 | `listOmissions`（I-2） | `brain-omissions` · `research-omission-list` | ✅ |

---

## 二、缺口清单（这一件的真正价值所在）

> 这 9 条是**这一轮设计的产出**，不是失败。四件套的意义就是把它们在写代码之前找出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | **Studio 右侧「上下文包与证据」栏在原型缺失**。大脑「AI 读到了什么」屏完整存在且已逐段抽取，但研究/问卷/原型三个 Studio 的运行态外壳**已完整探明、其中没有这一栏**（`原型确认缺失`，不是未探明）。V5 空态、V7 实时「证据已撤回」标注都落在这一栏 | 界面缺口 | F11 已标 `needs_ui_signoff: true`。需**补画原型**并由产品/设计确认它与大脑屏的关系，随 phase-01 交付。⚠ 本束的 `omissions`/`retrievalReasons` 契约用 API 断言**可先行开工**，不被这一栏阻塞 |
| **2** | **权限沿数据链路传播的「同一判定」没有统一入口**。V4/I-8/I-9/I-11 要求可见性传播到 Segment/embedding/图节点/缓存/Context Pack，堵死「原文看不到、但摘要/向量召回把内容洗白后送出」的越权路径 | **跨束**（identity/artifact/context-pack） | 提到**阶段一致性复核**：**六条路径（原文/Segment/embedding/图节点/缓存/Context Pack）必须共用 `identity` 的同一个 `authorize` 判定，不能各查各的**。这与 `identity` 束缺口 2 是**同一件事**，两束都指向它——不要各写一套权限传播 |
| **3** | **pgvector 带权限过滤 recall 测试集的基线数值未定**。V12 要求「不低于约定基线」，但基线是多少没人裁决——**它是上线门槛却没有门槛值** | 需裁决 | 建立带权限过滤 recall 测试集后，由人确认基线（如 filtered recall ≥ 0.9×unfiltered）。⚠ 该测试集**是交付物**（估点变更说明明确列出），不阻塞契约但阻塞 F10 上线 |
| **4** | **token 预算的各路配额未定**（O-36 只裁决了总预算「随模型窗口推导」+ 阈值「按任务类型可配」，**五路之间怎么分**没定） | 待确认 | 不阻塞实现（先按假设：FTS/vector 主，graph/metadata/claim 加成）。评测后固化进 `retrievalPlan` 的默认权重表 |
| **5** | **Context Pack 装配快照的留存期未定**。固化快照是审计依据（V8），但体量可能很大 | 需裁决 | 与 `17-gov` 的 retention policy **统一裁决**，别在本束单独定。影响 `replayContextPack` 的可用窗口——留存期外的定版结论能否还原引用清单，需明确降级语义 |
| **6** | **机密本地路由依赖「本地模型可用性」，跨到 `20-model` 模块**。`resolvePackModelConstraint` 判 `localOnly=true` 后，若无可用本地模型 → `CONFIDENTIAL_REQUIRES_LOCAL_MODEL` 阻断；但「有哪些本地模型可用」属模型管理（phase-01） | **跨阶段** | phase-00 契约定义失败态，真实模型清单跨阶段衔接。一致性复核须确认**这个失败态有人接**，否则含机密的项目在没有本地模型时会卡死无解释 |
| **7** | **`claims[]` 的真实数据源跨阶段**。`ClaimRef` 结构在此定义，但 claims 的产生（五态机/审核工作台）属 `14-brain`（phase-01 P3）。phase-00 的 `claims[]` 只能空或占位，`research-claims` 屏消费它但数据未就绪 | **跨阶段** | phase-00 只交付结构契约与「反对证据强制保留」（I-12）的断言；claims 数据接入排到 phase-01 P3，不在本束验收面内 |
| **8** | **「出网为零」（机密）是部署形态约束，契约管不到**。同 `identity` 缺口 3 的 `NetworkEgressGuard` | **契约管不到** | 落成部署形态约束（容器网络策略），写进 `architecture.md`，一致性复核确认有人负责。⚠ 应用层断言只能证明「我没主动出网」，证明不了「没有任何出网」——只有网络层可断言 |
| **9** | **既有手写 mock 是 pre-existing 第二份**：`apps/web/lib/mock/research.ts` 与 `brain.ts` 的 `interface Omission`、`chat.ts` 的 `interface Citation`。`lint-contract-source` 只抓 `export const/type`，**漏过 `interface`**，故机械门控没拦住 | 收敛建议 | 这些应逐步替换为 `apps/web/lib/generated/context-pack.mock.ts`。本轮已生成契约 mock；替换现有手写 mock 属界面接线，随 F11/Studio 栏一并做，避免第七次「同一事实声明在两处」 |

---

## 三、反向检查：有没有多余的 API

| API 操作 | 被哪条要求 | 结论 |
|---|---|---|
| `assembleContextPack` | V2 V4 V10 V11 V12（+ R3 主流程） | ✅ |
| `replayContextPack` | V8（+ 首批门槛 ⑥ 可重放） | ✅ |
| `listOmissions` | V3 V13 | ✅ |
| `gateAiCall` | V5 V6 | ✅ |
| `verifyCitation` | V1 | ✅ |
| `pinContextPack` | V8（+ R3 第 8 步固化） | ✅ |
| `resolvePackModelConstraint` | V9 | ✅ |
| `addManualItem` | **R4 备选 A4**（人工增补，不受阈值裁剪） | ✅ 由备选流程要求，非孤儿 |
| `adjustRetrievalWeights` | **R4 备选 A3 / R3 第 6 步**（调权留痕） | ✅ 由备选流程要求，非孤儿 |

**9 个操作全部有 UC 要求，无孤儿接口。** `addManualItem`/`adjustRetrievalWeights` 依据的是
R4 备选流程而非 R12——R12 只列了主验收面，备选流程同样是契约的一部分。

---

## 四、签核时请重点看这四处

1. **缺口 2 是跨束的核心** —— 权限沿数据链路传播的「六条路径共用同一判定」，与 `identity` 缺口 2
   指向**同一件事**。若两束各写一套权限传播，就是第七次「同一事实声明在多处」。**这条必须在
   阶段一致性复核里由一个束统一设计**（建议归 identity，本束消费）。
2. **缺口 3 是门槛却没门槛值** —— pgvector 的 recall 基线不定，F10「上线」就没有客观判据。
   请确认基线由谁在什么时候定，别让它悬空。
3. **缺口 6/7 跨阶段** —— 机密本地模型可用性（20-model）与 claims 数据源（14-brain）都在 phase-01。
   phase-00 只定失败态/结构，请确认衔接点有人接，否则含机密项目会卡死、claims 屏空转。
4. **`OmissionReasonSchema` 是引用不是副本** —— 契约从 `apps/web/lib/omission-reason.ts`
   import 七个键构造 zod enum，`lint-omission-reason` 与 `lint-contract-source` 均已通过。
   请确认这个「跨包 import 单一事实源」的方向可接受（shared 包引用了 app 内的单源文件）——
   或在一致性复核里决定是否把该单源迁进 `packages/contracts`（那是更彻底的收敛，但改动面更大）。
