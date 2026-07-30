# 契约束 `recording` — 支撑材料 · 领域模型与不变量

> **这一件回答的问题**：这个束里，**什么东西在任何时刻都必须为真**？
> 违反即数据损坏 —— 不是「应该」「建议」，而是能写成断言的性质。
>
> 依据 UC：`05-rec/uc-5-1` · `uc-5-2` · `uc-5-3` · `uc-5-4`（四份全读）
> 覆盖 feature 的**权威**在 `design-signoff.md` frontmatter 的 `covers:`（ADR-023 决策三）。

## 一、实体与值对象

### 1.1 采集层

| 实体 | 关键字段 | 说明 |
|---|---|---|
| `RecordingSession` 录制场次 | `id` `orgId` `projectId` `sourceType` `sourceRefId` `startedAt` `endedAt` `retentionResolutionId` | `sourceType` 是本束最关键的一个枚举：**转写不是访谈独有**，三种载体共用同一套模型（uc-5-1 R1） |
| `Track` 录音轨（一路） | `id` `sessionId` `participantId?` `micState` `consentState` `gapRanges[]` | 「每组一路，互不混用」；拒绝/关闭麦克风的 track 显式为 `not-recorded`，**不是静默不采集** |
| `TranscriptSegment` 转写段 | `id` `sessionId` `trackId` `anchor` `speakerChannelId?` `status` `lowConfidence` `text`(遮盖后) `piiFindings[]` | 即架构的 `segments`；`anchor` 即 `anchors` |
| `Anchor` 值对象 | 音频：`{ startMs, endMs }`；对话线程：`{ messageId }` | **没有可定位 anchor 的 Segment 不得入库**（uc-5-1 R7） |

### 1.2 说话人层

| 实体 | 关键字段 | 说明 |
|---|---|---|
| `SpeakerChannel` 匿名声道 | `id` `sessionId` `label`(A/B/C) `durationRatio` `firstSeenMs` `sampleSegmentIds[]` | 只有「有三个不同的人在说话」，**不知道他们是谁** |
| `SpeakerAssignment` 声道↔人映射记录 | `id` `sessionId` `channelId` `personId` `assignedBy` `assignedAt` `revokedAt?` | **独立实体**（uc-5-2 R11）。真名**不冗余**进每条 Segment，否则撤销与撤回都无法一次到位 |
| `SegmentSpeakerOverride` 单段例外 | `id` `segmentId` `personId` `reason` | 整声道指派之外的单段修正 |
| `VoiceprintEmbedding` 本场声纹特征 | `id` `sessionId` `channelId` `vector` `expiresAt` `destroyedAt?` | 属架构的 `derived_representations`。**本场内聚类允许、跨场次身份库禁止**（O-14） |

### 1.3 标注层

| 实体 | 关键字段 | 说明 |
|---|---|---|
| `Quote` 引述 | `id` `segmentId` `anchor` `rqId?` `evidenceNature` `createdBy` | 是**指向 `transcript.jsonl` 某个 anchor 的引用**，不复制正文（uc-5-3 R7） |
| `Annotation` 打点 | `id` `segmentId?` `anchorAt` `kind` `origin` `state` `agentName?` `contextPackId?` `rationaleSegmentIds[]` | `origin: ai \| human`；AI 打点默认 `candidate` |
| `AnnotationDecision` 确认/忽略留痕 | `id` `annotationId` `decision` `decidedBy` `decidedAt` | 忽略也要留痕，供 agent 改进 |

### 1.4 隐私与留存层

| 实体 | 关键字段 | 说明 |
|---|---|---|
| `PiiFinding` | `id` `segmentId` `type` `span` `maskedText` | `type` 五类（O-39） |
| `PiiOriginal` 原文密文 | `id` `findingId` `ciphertext` `keyRef` | 默认读接口**不返回**；查看原文是独立授权动作并写审计 |
| `RetentionResolution` 保留期解析结果 | `id` `materialId` `resolvedDays` `resolvedFrom`(`project`\|`org`) `resolvedAt` `expiresAt` | **解析结果与解析依据一起写进材料元数据**（uc-5-4 R3-2） |
| `ConsentRenderInstance` 同意书渲染快照 | `id` `consentId` `templateId` `variables` `renderedText` `contentHash` `submittedAt` | 「当时告知了什么」的证据 |
| `DeletionCertificate` 删除证明 | `id` `materialId` `deletedAt` `scope[]` `issuedBy` | 格式 **[待定]**，见 §四 |

### 1.5 枚举（封闭，新增必须走 ADR）

| 枚举 | 成员 | 依据 |
|---|---|---|
| `SourceType` | `workshop` `interview` `thread` | uc-5-1 R1（三载体） |
| `MicState` | `granted` `denied` `paused` | uc-5-1 R3-1 / A2 |
| `SegmentStatus` | `final` `partial` `pending-manual` `disputed` | uc-5-1 R8 + uc-5-2 R5；与 `apps/web/lib/mock/interview.ts:105` 现有四值一致 |
| `PiiType` | `email` `phone` `id-card` `bank-card` `address` | **O-39**（可执行最小集五类，合规后续只增不减） |
| `AnnotationOrigin` | `ai` `human` | uc-5-3 R3-4 |
| `AnnotationState` | `candidate` `confirmed` `ignored` | uc-5-3 R3-5 |
| `EvidenceNature` | `个人经历` `二手转述` `观点` | uc-5-3 R3-3（**封闭性未裁决**，见 §四） |
| `RetentionSource` | `project` `org` | uc-5-4 R3-2（取值顺序：项目级覆盖 → 组织默认） |

⚠ **枚举要守的性质是封闭性，不是成员数**（`contract-design.md` §五-7）。
断言写成 `toHaveLength(5)` 会把一个经 ADR 评审的正当新增被自己的测试拦下。
要断言的是：**成员集合与契约一致，且未声明的值不能通过**。

---

## 二、不变量

> 判据：**任何时刻都为真，违反即数据损坏**，且**能写成断言**。

### anchor 与转写完整性

**I-1** 任一 `TranscriptSegment` 必有可解析 anchor。
　怎么断言：`count(segments where anchor is null or (sourceType≠thread and (startMs is null or endMs is null)) or (sourceType=thread and messageId is null)) === 0`。

**I-2** anchor 单调有界：`0 ≤ startMs < endMs ≤ session.durationMs`。
　怎么断言：遍历本场 segments，逐条比较；越界记录数为 0。

**I-3** 无 anchor 的内容不得进入检索索引、不得被 AI 引用。
　怎么断言：`indexedSegmentIds ⊆ segmentsWithAnchorIds`，差集为空；且 Context Pack 的 `items[]` 每条都能解出 `segmentId + anchor`。

**I-4** 未取得麦克风授权的 track 不产生任何 Segment。
　怎么断言：`count(segments join tracks on trackId where tracks.micState='denied') === 0`；`paused` 期间的时间区间与任何 segment 的 anchor 不相交。

**I-5** `paused` 在时间轴上留缺口，不拼接成连续假象。
　怎么断言：`track.gapRanges` 非空时，相邻 segment 的 `endMs`/`startMs` 跨越该区间且 UI 渲染出 gap 标记；不存在 anchor 跨过 gap 的单条 segment。

**I-6** 跨路不串台：任一 Segment 的文本只来自其 `trackId` 对应的音源。
　怎么断言：四路各注入互不相交的已知词表，断言 `∀ seg: tokens(seg.text) ∩ vocab(otherTracks) === ∅`。

### 说话人与门禁

**I-7** `status='pending-manual'` 的 Segment，`speakerChannelId` 恒为 `null`。
　怎么断言：`count(segments where status='pending-manual' and speakerChannelId is not null) === 0`。
　⚠ 这是 O-13 的数据层表述：**系统不得静默把重叠段归给单一说话人**。

**I-8** `partial` / `pending-manual` / `disputed` / `lowConfidence=true` 四种段落不可被引述。
　怎么断言：`count(quotes join segments where seg.status in ('partial','pending-manual','disputed') or seg.lowConfidence) === 0`。

**I-9** 声道候选人只来自本场在场名单。
　怎么断言：`candidates(sessionId) ⊆ roster(sessionId)`，差集为空；且候选查询的输入参数中不含任何跨场次标识。

**I-10** 真名不冗余进 Segment 行 —— Segment 表**没有** `personId` / `personName` 列，真名只经 `SpeakerAssignment` 解析。
　怎么断言：schema 内省断言 `segments` 表列集合不含这两列；撤销一次指派后，全部消费点（引述出处 / 洞察来源 / 报告 / 图谱）读到的都是「出处待补」。

**I-11** 指派与撤销可逆且无脏数据：撤销后不存在任何仍持有旧真名的回填副本。
　怎么断言：`revokeAssignment` 后全量扫描下游消费点，`count(refs where displayName ≠ '出处待补') === 0`。

**I-12** 没有跨场次声纹身份库：任一 `VoiceprintEmbedding` 必绑定唯一 `sessionId`，且不存在以 `personId` 为键的声纹索引。
　怎么断言：schema 内省 —— `voiceprint_embeddings.sessionId NOT NULL`，无 `personId` 列、无以 person 为键的向量索引；代码静态检查无跨场次比对调用点。

### 声纹销毁与级联（O-14，本束最硬的一条）

**I-13** 一场次的说话人指派完成后，该场次的 `VoiceprintEmbedding` 记录数为 **0**（物理删除，非软删）。
　怎么断言：`assignmentCompleted(sessionId) ⟹ count(embeddings where sessionId=…) === 0`，且行不可通过任何 `includeDeleted` 参数读回。

**I-14** 任一 `VoiceprintEmbedding` 的 `expiresAt ≤ session.endedAt + 7d`；`now > expiresAt` 时记录数为 0。
　怎么断言：`count(embeddings where expiresAt > endedAt + 7d) === 0`；时钟推进到第 8 天跑兜底任务后 `count(...) === 0` 且存在一条销毁审计事件。

**I-15** 销毁是**物理删除 + 审计事件**，不是打标记。
　怎么断言：销毁后对象存储/PG 双侧均无该向量；`provenance_events` 中存在 `voiceprint-destroyed` 一条，带 `sessionId` `reason`(`assigned`\|`fallback-d7`) `actor`。

**I-16** 级联失效：不存在以已销毁 embedding 为输入、且仍标记为「有效」的派生物或缓存。
　怎么断言：`count(derived_representations where inputRef in destroyedEmbeddingIds and invalidatedAt is null) === 0`。

**I-17** 销毁后重跑 diarization 只产生**新的派生版本**，旧特征不复活。
　怎么断言：重跑后 `embedding.id` 与销毁前的 id 集合交集为空，且 `derivedVersion` 严格递增。

**I-18** 声纹 embedding **不适用材料保留期**。
　怎么断言：到期删除任务的作用域表清单**不含** `voiceprint_embeddings`（静态断言）；且 `embedding.expiresAt < material.expiresAt` 恒成立。

### PII（O-39）

**I-19** 默认读接口返回的文本不含五类 PII 明文。
　怎么断言：对 `listTranscript` / `getSegment` / Context Pack 三处响应体逐条跑五类正则，命中数为 0。

**I-20** 手机号等联系方式在库中为密文。
　怎么断言：扫描存储层全部文本列，手机号正则命中数为 0；`pii_originals.ciphertext` 与明文不等且不可逆读取。

**I-21** 遮盖发生在**入库前**：不存在含明文 PII 的 Segment 历史版本。
　怎么断言：写路径断言 —— 落库前后对比，`segments.text` 从未在任何时刻包含明文 PII；写审计只记录 findings 的 `type + span`，不记录明文。

**I-22** 遮盖不丢句：被遮盖的 Segment 仍参与检索、引述与 AI 归纳。
　怎么断言：`maskedSegmentIds ⊆ indexedSegmentIds`；对含 PII 的段落调用 `markQuote` 成功（前提是它满足 I-8）。

**I-23** 查看原文必留痕：任一 `revealPiiOriginal` 成功或被拒都产生一条审计事件。
　怎么断言：调用 N 次（含越权 N′ 次），`count(audit where action='pii-reveal') === N + N′`。

### AI 打点闸门

**I-24** `origin='ai'` 且 `state='candidate'` 的打点不在证据库、不可被报告与决策链引用。
　怎么断言：`evidenceQuery()` 结果集与 candidate 集合交集为空；报告/决策链引用它返回 `AI_ANNOTATION_NOT_CONFIRMED`。

**I-25** AI 打点不混入人工打点计数。
　怎么断言：`counts.human === count(annotations where origin='human')`，AI 候选变化时该数不变。

**I-26** 每个 AI 打点必带可追溯依据：`contextPackId` + `rationaleSegmentIds[]` 非空且可重放。
　怎么断言：`count(annotations where origin='ai' and (contextPackId is null or rationaleSegmentIds = [])) === 0`；按 `contextPackId` 可重放当时的 Context Pack。

**I-27** 依据片段被撤回或被校对改写时，未确认候选自动失效并移出候选列表；**已确认**的按撤回流程标「证据已撤回」，**不静默删除**。
　怎么断言：撤回一条依据 segment 后，`count(candidates referencing it) === 0` 且 `confirmed` 的那条仍在、`withdrawnAt` 非空。

### 引述与原件不可变

**I-28** 引述是引用不是副本：标注动作**永不改写**原件文件。
　怎么断言：标注前后 `transcript.jsonl` 与音频原件的 `artifact_version.contentHash` 逐字节相等。

**I-29** 每条引述携带可解析的 `segmentId + anchor`。
　怎么断言：`count(quotes where segmentId is null or anchor is null) === 0`。

### 保留期（D-14 / O-01）

**I-30** 每份落库材料的 `expiresAt` 在落库时刻已固化且非空，元数据同时记录 `resolvedFrom` 与 `resolvedDays`。
　怎么断言：`count(materials where expiresAt is null or resolvedFrom is null or resolvedDays is null) === 0`。

**I-31** 参数变更不追溯已落库材料。
　怎么断言：改动项目覆盖值前后对同一批材料快照 `expiresAt`，两次结果完全相等。

**I-32** 本束代码中不存在写死的保留天数常量。
　怎么断言：静态检查 —— 本束源文件中不出现 `180` / `30` / `1095` 等天数字面量参与保留期计算；全部走 `resolveRetention()` 参数读取接口。
　⚠ O-01 给出默认值**不放松这一条**：默认值是**留存策略内核的配置项初值**，不是本模块的常量。

**I-33** 组织默认值缺失时**拒绝开始录制**，不用隐含常量兜底。
　怎么断言：清空组织默认值后 `startRecording` 返回 `RETENTION_POLICY_MISSING`，且 `count(sessions created) === 0`。

**I-34** 删除证明只在物理删除成功后产生。
　怎么断言：不存在「有 `DeletionCertificate` 而对象存储仍能 HEAD 到该对象」的组合；删除任务失败时材料保持**不可读**且**无证明**。

**I-35** 到期删除删到文件层：物理删除后该场次在 22-files 中的音频 / `transcript.jsonl` / `notes.md` / 白板照片均不可见、不可下载。
　怎么断言：删除后对文件浏览器目录树与下载接口各断言一次 404 / 不可见。**跨束**（见 §三）。

**I-36** 不可删对象豁免：到期删除任务不触及 `artifact_versions` 快照、绑定关系、审计留痕。
　怎么断言：删除后这三类行数不变。

**I-37** 「禁止用于训练」在整个生命周期恒成立，是与保留期**并列的独立开关**。
　怎么断言：`∀t: material.trainingProhibited === true`；不存在任何以保留期未到为由放宽它的路径。

### 同意书

**I-38** 已提交的 `ConsentRenderInstance` 的 `contentHash` 永不改变。
　怎么断言：改动项目参数后重读该快照，hash 与提交时相等。

**I-39** 渲染变量缺失时不得发出授权链接。
　怎么断言：删掉 `合规邮箱` 变量后 `issueConsentLink` 返回 `CONSENT_TEMPLATE_VARIABLE_MISSING`，且 `count(invites created) === 0`。

**I-40** 保留期的三处呈现同源：研究计划参数面板 / 材料库「保留至」/ 授权页告知文案，读同一个解析结果。
　怎么断言：三处渲染值与 `resolveRetention()` 的返回逐一相等；任一处不等即失败。
　⚠ 这正是本仓最高发缺陷（同一事实声明在多处）的第 N 次候选点。

---

## 三、跨束交叉约束（留给阶段一致性复核）

| # | 事实 | 本束 | 另一侧 | 风险 |
|---|---|---|---|---|
| X-1 | **录制产物物化为文件**（I-28 / I-35 / F73） | 产生音频 + `transcript.jsonl` + `notes.md` | **`files` 束**（22-files）+ phase-00 `artifact` 束（F04 六表 / `derived_from`） | 本束**不得**另建索引表。目录结构与命名对外可见即契约 |
| X-2 | **Segment / anchor 的统一上下文模型** | 产出 `segments` + `anchors` | **`context-pack`**（phase-00 F09–F13）与全部下游（06-itv / 07-canvas / 08-chat / 09-kg / 10-report） | 下游**一律经 Context API**，不得直查本束的表。若各自直连，PII 策略与权限判定会有 N 份 |
| X-3 | **PII 脱敏内核** | 转写侧的**接入点** | **17-gov**（D-16 两级脱敏） | 本束**不得再造一套遮盖规则**。五类枚举必须单源 |
| X-4 | **留存策略五参数** | 只消费 `材料保留期` | **00-core / 17-gov 留存策略内核** | 本束是消费方；UC-6.3 的同意书渲染消费**同一个接口**，两处必须取同一个值 |
| X-5 | **声纹 embedding 纳入撤回删除范围** | I-13～I-18 | **17-gov UC-17.2** | 销毁时点与材料保留期**不同**（7 天 vs 180 天）。到期删除任务若把它当普通材料处理，就是把一条 7 天约束松成 180 天 |
| X-6 | **撤回链两级 SLA** | 撤回联动引述与打点（I-27） | **`consent` / 17-gov**（D-15：逻辑失效 ≤5 分钟 / 物理删除 ≤30 天） | ⚠ 本仓已因 SLA 两处声明漂移过一次。本束**只引用不重复定义** |
| X-7 | **受访者授权 3/4 的四项拆法** | 决定哪一路能录、能转写、能引述 | **`consent` 束**（S-09：录音✓/转写✓/引述✓/内部复用✗） | 本束的 `Track.consentState` 必须读同一份授权项定义，不得自己拆 |
| X-8 | **引述↔RQ 绑定** | 产出绑定 | **06-itv**（UC-6.4 覆盖度 / UC-6.5 证据矩阵） | 绑定的消费方在别束；`rqId` 的生命周期归谁需裁定 |
| X-9 | **provenance / 审计查询面** | 指派、撤销、PII 查看、销毁、删除证明各写审计 | phase-00 `artifact` 束缺口①同一件事 | 若各束各造查询面，就是同一事实第 N 次两处声明 |
| X-10 | **观察者可见度** | 访谈现场转录只读 + 说话人掩码到角色标签（S-11） | **`identity`** | 三处判断（对话/访谈/研究）目前不一致，需统一 |

---

## 四、[待定 —— 需人类裁决]

| # | 缺什么 | 性质 | 影响 |
|---|---|---|---|
| **D-1** | **说话人混淆率（DER）/ 重叠漏检率 / 低置信触发阈值**三个数值 | 缺数值（O-13 已降级为非阻断） | 不阻断：I-7 / I-8 是结构性断言，可立即验收。数值定稿前实现方**不得**自选一个当验收线 |
| **D-2** | **加密密钥策略**（I-20 的 `keyRef` 怎么管） | 缺合规输入（O-38/O-39 ④） | 阻断 F72 的**生产就绪**，不阻断契约与结构断言 |
| **D-3** | **删除证明格式**（`DeletionCertificate` 的字段与签名形态） | 缺合规输入 | 阻断 F78 的证明产出形态；I-34 的「有无」断言不受影响 |
| **D-4** | **法定留存清单**（O-39，不可删对象的存续依据） | 缺合规输入 | 影响 I-36 的豁免边界 |
| **D-5** | **保留期允许区间**（O-01 只给了默认值 180 天，区间待合规收窄） | 缺数值 | 不阻断；但参数校验的上下界现在写不出来 |
| **D-6** | **数据驻留地区枚举**（O-38 ①，明确留空、取值从配置读） | 枚举封闭性未定 | 按「受控枚举字段、取值从配置读取」实现，不阻塞 |
| **D-7** | **`EvidenceNature` 枚举是否封闭** | 枚举封闭性未裁决 | 原型只举了三例（个人经历/二手转述/观点），UC 未声明它是全集。若不封闭，UC-6.5 证据矩阵的列就是开放的 |
| **D-8** | **`AnnotationKind` 枚举**（决策点 / 痛点 / 机会 / 研究笔记）是否封闭 | 枚举封闭性未裁决 | 行内操作条给了四个按钮，但没说这就是全集 |
| **D-9** | **`disputed`（争议·多人认领）是否是正式状态** | 需裁决 | uc-5-2 E1 要求「保留争议标记」，但原型档案 **0 命中**；`apps/web/lib/mock/interview.ts` 的实现**已经造了这个状态**（`seg-17`）。**这正是「实现者替 UC 做了决定」**，见 ui-preview S-16 |
| **D-10** | **人工文本修正出口**（`识别置信度低 · 待校对` 的处理按钮） | 原型确认缺失 | uc-5-2 R5 明写行内操作条五个按钮**没有文本编辑入口**，早期稿本的 `[编辑文本]` 是伪造按钮已删除。**需补一个出口**，否则该状态无解除路径 |
| **D-11** | **逐份转写的保留期/删除时间呈现** | 界面缺口 | uc-5-4 AC1b：档案只有项目级一个数值，**没有逐份呈现**。属 Backlog 要求，需补画原型 |
| **D-12** | **议程环节归档维度** | 原型确认缺失 | uc-5-4 R3-1：材料准备子标签只写实了「9 份」计数，**未见按议程环节分组的视图**，归档维度为推断 |
