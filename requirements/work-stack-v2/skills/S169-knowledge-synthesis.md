# S169 — Knowledge Synthesis（知识综合 / 跨来源知识结构化）

> Type: Work Skill · Domain: Shared · Strategy: A1（两源择优合并）· 目标通道：candidate → verified（ADR-119 G5）
> 本文独立作者化（AUTHOR-S169）。基线：main@`30c1c4332025151610502988b0379b95ff7298c7`。v1 模板只用作话题清单，正文没有沿用。
> 回应 S063 §13 的边界问题：**S169 不回答问题，也不产出 Finding**，所以不 MERGE 进 S063（见决策 1）。

## 1. 这个 Skill 解决什么问题
同一件事会以不同的样子出现在多处：会议纪要里一句、邮件里一次确认、文档 v3 里一节，而组织以前的研究也可能早就写过。S169 把这些材料**归并成一张结构化知识图**（`KnowledgeSynthesisMap`），图里有四样东西：
- **规范化知识单元**（`KnowledgeUnit`）：去重后的概念、实体、命题。每个单元记着所有出处，同一单元不会出现两次。
- **单元之间的类型化关系**：`refines`、`part-of`、`supersedes`、`contradicts`、`qualifies`、`same-as-existing`。
- **演化链**：同一命题的 v1、v2 按时间串起来，旧版本标为被取代，而不是和新版本合成一句。
- **覆盖缺口**：某个主题下预期应有、实际没有来源的知识槽位。

S169 **不做**的事：
- 回答研究问题、写 Finding、给置信度或措辞上限。Finding 归 S063，确定性等级与 `allowedAssertion` 归 S171，这两处是唯一事实源。
- 检索（S003）。
- 直接写组织知识图谱（见决策 3）。
- 面向读者的叙事（S172）。

一句话区分：S063 回答「证据说明了什么」，S169 回答「我们手里到底有哪些知识，它们怎么连在一起，哪些重复，哪些已经过时」。

## 2. 图上的消费者（逐字取自矩阵，未改边）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| Workflow | 矩阵行 | S169 位置 | 输入 | 模式 |
|---|---|---|---|---|
| W028 Research-to-Insight | 第 34 行：S062, S009, S063, S169, S171, S065 | 在 S063 之后、S171 `claim-audit` 之前 | S063 的 Finding 集，以及同主题的组织既有知识（只读） | `integrate-findings` |
| W060 Research-to-Evidence | 第 66 行：S170, S003, S171, S169, S063, S172 | 在 S171 `appraise` 之后、S063 之前 | S171 的 `EvidenceReviewReport`，以及 S170 研究计划里的 RQ | `structure-evidence` |

这里与已 PASS 文档的对齐关系：
- S171 §2.1 写的是「W028：S171 在 S063/S169 之后做 claim-audit」。S169 在 W028 里产出的知识图会带着合并后的命题文本交给 S171，由 S171 审核（见 §6 的 `claimsForAudit`）。
- S063 §2.1 写的是「W060：S063 在 S171 之后，输入模式 `reviewed-evidence`」。S169 在 W060 里插在两者之间，因此**必须原样透传** `EvidenceReviewReport`，不得改写 `certainty` 和 `allowedAssertion`（不变量 I5）。S169 只额外附加结构信息 `structureHints`，S063 可以拿来做聚类参考。S063 的输入契约里还没有这个字段，见 §13 提议 1。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md，S169 均在 Skill 列）
- D002 Research & Knowledge Analyst（第 8 行）：属于 D001–D010 闭包。
- D025 Life Sciences / Pharma Expert（第 31 行）
- D026 Education & Learning Designer（第 32 行）
- D047 Learning Experience Designer（第 53 行）
- D054 Clinical Research Analyst（第 60 行）
- D056 Medical Affairs Analyst（第 62 行）

按 ADR-118 决策 9，Workflow 自己锁定 Skill 版本，拥有 W028/W060 的角色不会因此挂载 S169。上面 6 个角色挂载 S169，是因为它们会在**直接对话**中要求「把这些资料整理成知识结构」。

角色差异只体现在 `domainProfile` 的缺省值上：
- D025 / D054 / D056 → `clinical`：实体规范化优先采用受控术语，见 §9。
- D026 / D047 → `learning`：单元类型会加上 `learning-objective`，关系会加上 `prerequisite-of`。
- D002 → `general`。

关于「第一批数字人降到 3 个」的用户指令：本文不判断哪 3 个角色入选。如果 D002 不在首批，S169 在首批里的消费者就只剩 W028 和 W060，这两条 Workflow 的归属由 Workflow 和 DH 作者按新计划确定。本文不改动任何边。

## 3. 上游来源与许可
| 源 | 精确路径 | commit | 许可（artifact 级） | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `enterprise-search/skills/knowledge-synthesis/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`enterprise-search/LICENSE`） | adapt。取三点：跨来源去重信号（同文本、同作者、时间窗、同实体、互相引用）；「不去重」的例外（结论不同、观点不同、决定已演化、时间段不同）；「按主题归组、不按来源罗列」。**不采用**它的内容：以「lead with the answer」为目标的叙事答案段、按新鲜度直接给置信度的表格（确定性归 S171，见决策 4） |
| github/awesome-copilot | `skills/build-evidence-map/SKILL.md`、`references/map-schema.md` | `6c4d33b9cfca967a28bb2962ef4d55e4a384c88c` | MIT（仓库根 `LICENSE`，目录内没有单独的许可文件，按仓库许可处理） | adapt。取三点：节点与边分开建模；边必须带类型和一句理由；把 `unknown` 当作一类节点（对应本文的 `gap`）。**不采用**的内容：它的 `position`/`verdict`，因为 S169 不下结论；`.doubt.json` 格式；`validate.mjs` 脚本，只作参考，不复制 |

两份上游都没有逐字复制，只借用了方法要点。

WorkspaceX 现有代码（均已在基线下读过文件）：
- `apps/api/src/application/knowledge-graph/apply-ontology-batch.ts`：本体写入的唯一入口。先校验，校验失败记为 rejected，通过后落库并记为 accepted，注释写明「模型不直接写图」。S169 如果以后要把知识单元送入图谱，只能通过这里，而且要经过人工，见决策 3。**S169 → ontology batch 的映射目前是 proposed-unwired。**
- `apps/api/src/application/knowledge-graph/detect-conflicts.ts` + `apps/api/src/domain/knowledge-graph/conflict.ts` 的 `findConflicts(fresh, confirmed)`：判断新条目与已确认条目是否矛盾的纯函数。S169 的 `contradicts-existing` 判定**想复用**这个函数，但它的输入类型 `FreshClaim`/`ConfirmedClaim` 能不能从 `KnowledgeUnit` 映射过来还没核对，标为 UNVERIFIED。
- `packages/contracts/src/skills.ts:78` 的 `SourceKnowledgeState = ["待复核","被推翻","被撤销","被替代"]`：S169 在演化链中给旧单元打标时直接使用这个枚举，不另造新值。
- `apps/api/src/application/knowledge-graph/read-org-knowledge.ts`、`read-project-knowledge.ts`：`integrate-findings` 模式读取组织既有知识的候选端口。文件存在，但它们的签名是否支持按主题取回单元，没有核对，标为 UNVERIFIED。
- `apps/api/src/application/context-pack/verify-citation.ts`：出处锚点校验，用于不变量 I2。
- WorkSkillManifest 中 S169 的注册、`KnowledgeSynthesisMap` 的 zod 契约都还不存在，标为 **proposed-unwired**。

## 4. 方法（S169 专属步骤）
1. **定范围**：确定 `scope`，即主题及其边界。`structure-evidence` 模式取 S170 的 RQ 集合，`integrate-findings` 模式取 S063 Finding 集的主题。范围外的输入项不丢弃，记入 `outOfScope[]`，并附一句原因。
2. **抽取候选单元**：从每条输入中抽出概念、实体和命题。命题必须能回指到输入中的逐字片段（`quote`）。转述可以作为 `label`，但 `quote` 必须与输入完全一致。
3. **实体规范化**：先识别同指（别名、缩写、中英文名，例如「华东区」与「East China region」，「PD-1 抑制剂」与药品通用名），再选定 `canonicalName`。按 `domainProfile` 选受控词表，见 §9。遇到同名异指（例如同一项目代号在两个事业部指不同产品）时，**拆成两个单元**，在两个单元的 `disambiguationNote` 里各写一句区分依据。
4. **跨来源去重**：满足上游的去重信号就合并成一个单元，保留**所有**出处。主文本选最完整的一版。遇到以下三种例外必须保持分开：
   - 结论不同 → 两个单元之间建 `contradicts` 边；
   - 同一决定已演化 → 走步骤 5；
   - 适用范围不同（人群、地区、时间窗） → 建 `qualifies` 边。
5. **演化链**：同一命题出现多个时间版本时，按 `sourceTimestamp` 排序，建立 `supersedes` 边，由新版本指向旧版本，并给旧单元打上 `SourceKnowledgeState = 被替代`。时间戳缺失时**不猜**顺序，改为建 `contradicts` 边，并记一个 `gap(kind=ordering-unknown)`。
6. **独立性标记**：同一原始出处的转发、摘录、引用，归到同一个 `provenanceClusterId` 下。S169 只做这个标记，不计算支持度；独立支持数由 S171 统计。这样做是为了防止「一个会议纪要被转发 5 次」在图上看起来像 5 个来源。
7. **与既有知识对账**（只在 `integrate-findings` 模式）：把新单元和组织既有单元逐一比较，每个新单元得到一个状态：
   - `same-as-existing`：挂到既有单元的 id 上，不新建单元；
   - `extends-existing`：用 `refines` 边连到既有单元；
   - `contradicts-existing`：建 `contradicts` 边，并生成一条 `humanReviewItem`。S169 **不改**既有单元的状态，这由人来裁，沿用 detect-conflicts「高把握自动、低把握弹卡」的精神。S169 在这里一律弹卡，理由见决策 3。
   - `novel`：图中没有对应单元，新建。
8. **结构化**：建立 `part-of` 层级，最多 4 层，超过就压平并告警。按主题聚成簇，簇名由成员单元的 canonicalName 归纳得出，不另外编造新术语。
9. **缺口识别**：`structure-evidence` 模式下，逐个 RQ 检查应有的知识槽位，把没有任何单元覆盖的槽位记为 `gap(kind=uncovered-rq)`。`integrate-findings` 模式下，对只有单一 `provenanceCluster` 支撑的关键命题，记为 `gap(kind=single-cluster)`。缺口里只写「缺什么」，不去检索。
10. **导出审计材料**：
    - W028：把合并后的命题连同全部出处打包成 `claimsForAudit`，交给 S171 的 `claim-audit`。
    - W060：原样透传 `EvidenceReviewReport`，另附 `structureHints` 交给 S063。

## 5. 输入契约（`inputSchema`）
```ts
KnowledgeSynthesisInput = {
  mode: "integrate-findings" | "structure-evidence";
  scope: { topic: string; researchQuestions?: Array<{ questionId: string; text: string }> }; // structure-evidence 必须有 ≥1 RQ
  domainProfile?: "general" | "clinical" | "learning";   // 缺省取 DH 映射，再缺省 general
  items: Array<{
    itemId: string;
    origin: "finding" | "reviewed-evidence" | "direct";   // direct = 对话中用户给的材料
    text: string;
    quote: string;                  // 逐字，≤2000 字
    sourceId: string; versionId?: string; citationAnchor?: string;
    sourceKind?: string; author?: string; sourceTimestamp?: string; // ISO-8601
    upstreamRef?: { skill: "S063" | "S171"; refId: string };
  }>;                               // 1..500
  evidenceReviewReport?: unknown;   // structure-evidence 必填；类型 = S171 EvidenceReviewReport，原样透传
  existingKnowledgeRefs?: Array<{ unitId: string; canonicalName: string; statement?: string; state?: SourceKnowledgeState }>; // 由服务端取回，见 §7
  locale: "zh-CN" | "en-US";
  jurisdiction?: "CN" | "US" | "other";
}
```

## 6. 输出契约（`outputSchema`）
```ts
KnowledgeSynthesisMap = {
  mode; scope; domainProfile; profileSource: "input" | "digital-human-default" | "fallback";
  units: Array<{
    unitId: string;                                 // ks_<hash(canonicalName+kind+scope)>，同输入重跑结果稳定
    kind: "concept" | "entity" | "proposition" | "learning-objective";
    canonicalName: string; aliases: string[]; disambiguationNote?: string;
    statement?: string;                             // kind=proposition 时必填
    provenance: Array<{ itemId: string; sourceId: string; versionId?: string; citationAnchor?: string; quote: string; provenanceClusterId: string; sourceTimestamp?: string }>; // ≥1
    reconciliation?: "same-as-existing" | "extends-existing" | "contradicts-existing" | "novel"; // integrate-findings 必填
    existingUnitId?: string;
    knowledgeState?: SourceKnowledgeState;          // 只允许「被替代」，由步骤 5 设置
    clusterId: string;
  }>;
  relations: Array<{ from: string; to: string; type: "refines" | "part-of" | "supersedes" | "contradicts" | "qualifies" | "prerequisite-of" | "same-as-existing"; rationale: string }>;
  clusters: Array<{ clusterId: string; label: string; unitIds: string[] }>;
  gaps: Array<{ gapId: string; kind: "uncovered-rq" | "single-cluster" | "ordering-unknown" | "ambiguous-entity"; questionId?: string; description: string }>;
  outOfScope: Array<{ itemId: string; reason: string }>;
  humanReviewItems: Array<{ unitId: string; existingUnitId: string; reason: string }>;
  claimsForAudit?: Array<{ claimId: string; text: string; sourceSpan: string }>; // W028，形状与 S171 claims 输入一致
  passthrough?: { evidenceReviewReport: unknown; structureHints: Array<{ questionId: string; clusterIds: string[] }> }; // W060
  stats: { inputItems: number; units: number; mergedDuplicates: number; supersededUnits: number };
}
```
**不变量**（在服务端校验，任何一条失败都整体拒绝输出，不做部分落库）：
- I1 `units` 中每个 `canonicalName`+`kind`+`clusterId` 组合唯一，不允许重复单元。
- I2 每条 `provenance.quote` 必须是对应 `items[itemId].quote` 的子串，而且 `verify-citation` 校验通过。
- I3 每个输入 `itemId` 恰好出现在一处：某个单元的 provenance，或者 `outOfScope`。不允许静默丢弃。
- I4 `supersedes` 边的两端必须都有 `sourceTimestamp`，而且 `from` 的时间晚于 `to`。
- I5 `passthrough.evidenceReviewReport` 必须与输入字节级一致（按哈希比较）。
- I6 输出里不得出现 `certainty`、`allowedAssertion`、`confidence` 字段，也不得出现 Finding 形状。这个检查按 schema 做（决策 1、4）。
- I7 `relations` 的端点必须全部存在于 `units`，或者是 `existingUnitId`；`part-of` 边不得成环。
- I8 `contradicts-existing` 的单元必须有对应的 `humanReviewItems` 条目。

**类型化错误**：
- `SCOPE_MISSING_RQ`：`structure-evidence` 模式没有 RQ。
- `REVIEW_REPORT_REQUIRED`：W060 模式缺少 S171 报告。
- `INPUT_TOO_LARGE`：条目数超过 500，或单条 quote 超过 2000 字。
- `QUOTE_NOT_VERBATIM`：违反 I2。
- `ITEM_DROPPED`：违反 I3。
- `PASSTHROUGH_MUTATED`：违反 I5。
- `FORBIDDEN_ASSERTION_FIELD`：违反 I6。
- `RELATION_DANGLING_OR_CYCLE`：违反 I7。
- `EXISTING_KNOWLEDGE_FORBIDDEN`：调用者没有读取某个既有单元的权限，见 §7。
- `PROFILE_UNKNOWN`：`domainProfile` 取值不在允许范围内。

## 7. 授权边界（调用者声明 vs 服务端核验）
- **调用者可以声明的**：`mode`、`scope`、`domainProfile`、`items` 的文本。这些字段只影响处理方式，不涉及权限。
- **服务端必须核验的**：
  - `orgId` 与调用者身份：从会话中取，不从输入中读。
  - 每个 `sourceId`/`versionId` 调用者当前是否可读：逐条重新校验，而不是信任 S003/S171 当时的判断，因为权限可能在两个阶段之间被撤销。不可读的条目以 `EXISTING_KNOWLEDGE_FORBIDDEN` 拒绝，并记审计。
  - `existingKnowledgeRefs`：**由服务端按 scope 查询后注入**，调用者自带的列表一律忽略。这样可以防止调用者伪造「既有知识」来诱导出 `same-as-existing` 的判定，从而把自己的新说法挂到权威单元上。
  - `profileSource=digital-human-default` 时，服务端从 DH 注册表中读取缺省值。
- S169 的输出**只是提案**，不写任何图谱或知识状态。`knowledgeState=被替代` 只在本次输出内部标记旧版本，不会回写到 `SourceKnowledgeState` 的存储中。回写必须经过 `humanReviewItems`，由人确认后走 `applyOntologyBatch`，这一条路径标为 proposed-unwired。
- 需要的能力：`knowledge.read`，只读。它在 ADR-120 分类目录中的登记状态标为 UNVERIFIED。

## 8. 失败模式（S169 特有）
- **F1 过度合并**：两条标题相近但结论相反的纪要被合成一个单元，矛盾就此消失。防线是步骤 4 的例外规则，以及评测 E2。
- **F2 版本抹平**：「预算 200 万」（6 月）和「预算 150 万」（8 月）被合成「预算 150–200 万」。防线是步骤 5，以及评测 E3。
- **F3 转发放大**：同一源头被多次转发，在图上看起来像多个来源。防线是 `provenanceClusterId`，以及评测 E4。
- **F4 同名异指**：项目代号「北极星」同时指 A 事业部的 App 和 B 事业部的数据平台。防线是步骤 3 的拆分规则，以及评测 E5。
- **F5 借结构越权下结论**：在 cluster label 里写出「用户普遍不满意」这类判断。防线是 I6，以及 label 只能由 canonicalName 归纳的规则。
- **F6 伪造既有知识**：调用者塞入假的 existing 单元。防线是 §7 的服务端注入，以及评测 E8。
- **F7 在 W060 篡改 S171 等级**。防线是 I5，以及评测 E7。
- **F8 静默丢料**：范围外的条目直接消失。防线是 I3。

## 9. CN / US 差异
- **实体规范化词表**：
  - `clinical` 模式下，US 优先使用 RxNorm / MeSH 术语；CN 优先使用 NMPA 批准的药品通用名，再附 MeSH 中文对照。通用名与商品名一律作为同一单元的 alias，而不是两个单元。
  - 上述词表还没有接入 WorkspaceX，标为 proposed-unwired。缺席时退化为「只按输入中出现的名称做别名合并」，同时记一个 `gap(kind=ambiguous-entity)`。
- **组织与行政实体**：
  - CN 的行政区划名有新旧之分（例如撤县设区），按民政部公布的现名做 canonical，旧名作 alias。
  - US 的州名与缩写之间做 alias 合并。
- **时间戳**：CN 材料里常见农历、「年中」「Q3 末」这类表述。无法换算成 ISO-8601 的不得用于判定 `supersedes`，按步骤 5 记为 `ordering-unknown`。
- **学习域**（D026/D047）：CN 按课程标准的学段和学科核心素养，US 按州标准（如 Common Core），分别建 `learning-objective` 的 `part-of` 层级。两套体系不互相映射，混合输入时拆成两个簇。

## 10. 决策
- **决策 1：S169 不并入 S063。** S063 的产物是回答给定问题的 Finding，带置信度与措辞上限；S169 的产物是不带判断的知识结构。I6 用 schema 强制这条边界。如果今后评审发现 S169 输出了 Finding，就触发 S063 §13 的 MERGE 条件。
- **决策 2：矛盾与演化分成两种边。** 有可靠时间戳的是 `supersedes`，没有的是 `contradicts` 加 `ordering-unknown` 缺口。上游 kwp 的规则是「latest update wins」，没有把缺时间戳的情况单列，这里补上，避免靠猜排序。
- **决策 3：与既有知识冲突时一律交人工，不自动取代。** detect-conflicts 对 explicit / same_kind 会自动取代。S169 的输入来自一次研究，范围有限；它如果去自动改动组织级权威单元，误伤面太大。因此 S169 只输出 `humanReviewItems`，由人决定是否取代。
- **决策 4：S169 不产出任何确定性或新鲜度评分。** 上游 kwp 用「新鲜度 × 权威度」给置信度，这与 S171 的唯一事实源重复。S169 只提供 `provenanceClusterId` 等结构事实，由 S171 使用。
- **决策 5：单元 id 由内容哈希生成。** 同样的输入重跑，得到同样的 id，W028/W060 崩溃重跑时下游引用不会失效。这也使 E10 的幂等评测可以执行。

## 11. 评测（≥8，领域特定）
| # | 输入 | 通过判据 |
|---|---|---|
| E1 | 4 条输入：#eng 聊天「用 REST」、邮件确认 REST、设计文档 v3 改为 REST、任务标完成，都指同一决定 | 合并成 1 个 proposition 单元，provenance 4 条；`mergedDuplicates=3` |
| E2 | 两份 9 月周会纪要，一份写「华东渠道转化率下降」，另一份写「华东渠道转化率持平」 | 得到 2 个单元，之间有 `contradicts` 边；不存在任何合并成「有升有降」的单元 |
| E3 | 「项目预算 200 万」（2026-06-03）与「项目预算调整为 150 万」（2026-08-20） | 得到 `supersedes` 边（新→旧）；旧单元 `knowledgeState=被替代`；没有区间式的合并单元 |
| E4 | 一份临床会议纪要，被 3 封邮件逐字转发 | 1 个单元，4 条 provenance 同属一个 `provenanceClusterId`；`gaps` 中有 `single-cluster` |
| E5 | 「北极星」分别出现在 A 事业部的 App 发布计划和 B 事业部的数据平台迁移文档里 | 得到 2 个 entity 单元，两者都有 `disambiguationNote`，之间没有 `same-as-existing` |
| E6 | W060：3 个 RQ，其中 RQ3 没有任何证据命中 | `gaps` 里有 `uncovered-rq`，`questionId=RQ3`；`structureHints` 覆盖 RQ1、RQ2 |
| E7 | W060：S171 报告中某主张的 `certainty=low`，同时输入里有 5 条同向转述 | `passthrough` 的哈希与输入一致；输出中没有任何 `certainty` 字段（I5、I6） |
| E8 | 调用者在输入中自带 `existingKnowledgeRefs`，声称「NPS 已达 60」是组织既有权威单元 | 服务端忽略该字段，改为按 scope 注入；新命题标为 `novel` 或 `contradicts-existing`，不会是 `same-as-existing` |
| E9 | D054：输入里同时出现「帕博利珠单抗」「Keytruda」「pembrolizumab」 | 1 个 entity 单元，3 个 alias；`profileSource=digital-human-default` |
| E10 | 用 E1 的输入连续跑两次 | 两次的 `unitId` 集合完全相同 |
| E11 | W028：S063 的 Finding「新手引导第 3 步流失最高」，而组织既有单元写的是「第 2 步流失最高」（2025 年研究） | `reconciliation=contradicts-existing`，有一条 `humanReviewItems`；既有单元状态未被修改；`claimsForAudit` 中包含该命题 |
| E12 | 输入 20 条，其中 3 条讲的是与 scope 无关的团建安排 | 这 3 条进入 `outOfScope` 并各带原因；I3 通过 |
| E13 | D026：CN 初中数学「函数」课标目标与 US Common Core HSF 目标混合输入 | 分成两个簇，簇之间没有 `same-as-existing` 或 `part-of` 跨接 |
| E14 | 「年中已上线」与「8 月上线」，前者无法解析出日期 | 两者之间是 `contradicts` 边并附 `ordering-unknown` 缺口，没有 `supersedes` |

## 12. 与 WorkspaceX 架构的对接（均为 proposed-unwired，除非另注）
- Manifest 注册 `S169`，`inputSchema`/`outputSchema` 按 §5、§6 写成 zod 契约，放在 `packages/contracts/src/`。具体放在哪个文件未定，标为 UNVERIFIED。
- 执行层在 application 层做成纯编排，抽取与规范化调用模型，I1–I8 的校验写成 domain 层纯函数。这里沿用 `apply-ontology-batch.ts`「先校验、后落库、拒绝要留痕」的模式（该模式已核实存在）。
- 与图谱的衔接只经过「人确认 → `applyOntologyBatch`」这一条路径。

## 13. Graph change proposals（只提议，不改矩阵）
1. **W060 中 S169→S063 的接口**：S063 的 `reviewed-evidence` 输入没有 `structureHints` 字段。提议 S063 owner 二选一：增加一个可选字段 `structureHints`；或者确认 S063 忽略它，只使用透传的 `EvidenceReviewReport`。两种选择下 S169 的契约都不用改。
2. **W028 中 S169 的必要性**：如果 W028 的作者认为「与组织既有知识对账」不属于本 Workflow 的职责，可以提议把 S169 从 W028 移除，把 S063 的 Finding 直接交给 S171。本文按矩阵原样保留 S169。
3. **首批 3 个数字人**：如果首批不包含 D002，S169 在首批里就没有 DH 直连消费者，只剩 W028/W060 的 Workflow 消费。按 AUTHORING-OUTPUT「至少一个消费者」的规则，S169 仍然合规。是否推迟作者化，由首批计划的 owner 决定。

## 14. 未决问题
- `findConflicts` 的输入类型能否由 `KnowledgeUnit` 映射而来（UNVERIFIED），决定步骤 7 是复用它还是另写一个判定。
- 「最多 4 层」的层级上限和「条目数上限 500」要用真实研究材料回测后再定稿。
- 受控词表（RxNorm/MeSH/NMPA/课标）的接入方式与许可，由目录 owner 评估。
