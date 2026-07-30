# 契约束 `recording` — 签核② 用例接口与失败模式

> **这一件回答的问题**：application 层的**端口**长什么样，以及**失败长什么样**。
> 「失败长什么样」是契约的一半 —— 界面的异常态全靠它渲染。
> **只写 happy path 的契约是不完整的契约。**
>
> 依据 UC：`05-rec/uc-5-1` · `uc-5-2` · `uc-5-3` · `uc-5-4`
> 不变量编号引用 `domain.md` 的 `I-n`。

## 读这一件的约定

- `pre` 里的「两层交集」= 组织层 ∧ 项目层，判定在服务端（R5 通条：隐藏入口不构成安全控制）。
- 每个用例都**默认**带这四个失败模式，下文只在有特殊语义时才重复写：
  `UNAUTHENTICATED` · `NO_ORG_ROLE` · `NO_PROJECT_ROLE` · `RESOURCE_NOT_FOUND`。
- 幂等：所有写操作接受 `idempotencyKey`；重放返回**首次结果**，不产生第二条记录。
  重放冲突（同 key 不同 body）返回 `IDEMPOTENCY_KEY_CONFLICT`。

---

## 一、采集与实时转写（uc-5-1）

```
UC: 开始录制
  in:  { sourceType: "workshop"|"interview"|"thread", sourceRefId, projectId, trackPlan: [{ participantId? }] }
  out: { sessionId, tracks: [{ trackId, micState }], retention: { resolvedDays, resolvedFrom, expiresAt } }
  pre: 调用者在该项目有引导师或组长角色；该场次的授权项已生效；
       组织级 `材料保留期` 默认值存在（I-33）
  err: RETENTION_POLICY_MISSING        // 组织默认值缺失 ⇒ 拒绝开始，不用隐含常量兜底（E5）
     | SESSION_ALREADY_RECORDING       // 同一 sourceRefId 已有进行中场次（并发）
     | CONSENT_NOT_COMPLETED           // 在场者授权未完成 ⇒ 该路不采集（原型 P-12）
     | SOURCE_REF_NOT_FOUND
     | NO_PROJECT_ROLE
     | IDEMPOTENCY_KEY_CONFLICT
```

```
UC: 设置本路麦克风状态
  in:  { trackId, micState: "granted"|"denied"|"paused", reason? }
  out: { trackId, micState, gapRanges: [{ fromMs, toMs }] }
  pre: 调用者是该 track 的参与者本人，或该场次的引导师
  err: TRACK_NOT_FOUND
     | MIC_STATE_TRANSITION_INVALID    // 例：从未 granted 直接 paused
     | NOT_TRACK_OWNER                 // 越权替别人关麦
```
> 语义硬点：`denied` 之后**不得产生任何 Segment**（I-4）；`paused` 在时间轴上**留缺口**，
> 已产生的转写段**不回收**，重开后续接同一条转写（A2 / I-5）。
> ⚠ **不得静默继续采集**，也不得因此阻断该人参与其它协作动作。

```
UC: 摄取一条转写段
  in:  { sessionId, trackId, anchor: { startMs, endMs } | { messageId },
         rawText, asrConfidence, diarization: { channelId? , overlap: boolean } }
  out: { segmentId, status, speakerChannelId?, text(遮盖后), piiFindings: [{ type, span }] }
  pre: 该 track 的 micState = granted；session 未结束
  err: ANCHOR_MISSING                  // 无可定位 anchor ⇒ 拒绝入库（I-1，硬约束）
     | ANCHOR_OUT_OF_RANGE             // I-2
     | SESSION_ENDED
     | MIC_NOT_GRANTED                 // I-4
     | PII_MASKING_UNAVAILABLE         // 脱敏内核不可用 ⇒ 拒绝入库，不得明文落库（I-21）
     | TRACK_NOT_FOUND
```
> 语义硬点：
> - `overlap = true` ⇒ `status='pending-manual'` 且 `speakerChannelId = null`（I-7，O-13）。
>   **不得**在此处静默归给某个声道。
> - `asrConfidence` 低于内核阈值 ⇒ `lowConfidence = true`（阈值本身 **[待定 D-1]**，
>   但「命中即挂标记」是结构性断言，可立即验收）。
> - 尚未定稿的最后一段 `status='partial'`（「正在识别」）。
> - **遮盖在入库前完成**；原文单独加密存储（I-20 / I-21）。

```
UC: 读取转写流 / 全文检索
  in:  { sessionId, cursor?, limit?, q?, includeMasked: true }
  out: { segments: [{ id, anchor, speakerChannelId?, resolvedSpeaker?, status, lowConfidence,
                      text(遮盖后), piiFindings: [{ type, span }] }], nextCursor, latencyMs }
  pre: 两层交集；观察者 ⇒ 只读且说话人掩码到角色标签（S-11）
  err: NO_PROJECT_ROLE
     | SESSION_NOT_FOUND
     | CURSOR_INVALID
```
> `resolvedSpeaker` 是**由 `SpeakerAssignment` 解析出来的**，不是 Segment 上的字段（I-10）。
> 未指派时返回 `null`，界面渲染「出处待补」。
> 响应体**也**受契约校验（`contract-design.md` §五-6）。

```
UC: 结束录制
  in:  { sessionId }
  out: { sessionId, endedAt, durationMs, materializeJobId }
  pre: 调用者是该场次引导师
  err: SESSION_ALREADY_ENDED
     | SESSION_NOT_FOUND
     | NO_PROJECT_ROLE
```

```
UC: 查看 PII 原文（独立授权动作）
  in:  { findingId, justification }
  out: { type, plaintext, auditEventId }
  pre: 调用者持有该项目的 PII 解遮盖授权（**不是**管理员天然拥有，对齐 D-18）
  err: PII_REVEAL_FORBIDDEN            // 无权 ⇒ 拒绝，且**同样写审计**（I-23）
     | PII_ORIGINAL_DESTROYED          // 材料已过期删除
     | DECRYPTION_KEY_UNAVAILABLE      // 密钥策略 [待定 D-2]
     | FINDING_NOT_FOUND
```

---

## 二、录制产物物化（uc-5-1 R10 · **跨束**）

```
UC: 物化录制产物并登记到文件平面
  in:  { sessionId }
  out: { artifacts: [{ kind: "audio"|"transcript"|"notes"|"whiteboard-photo",
                       artifactId, versionId, contentHash, derivedFrom? }] }
  pre: session 已结束
  err: SESSION_NOT_ENDED
     | MATERIALIZE_PARTIAL_FAILURE     // 部分成功：已登记的保留，未登记的可重试，**不得**报成功
     | OBJECT_STORE_UNAVAILABLE
     | ARTIFACT_REGISTRY_UNAVAILABLE
     | SNAPSHOT_IMMUTABLE              // 试图覆盖原音频版本（跨束：artifact 束 I-1）
```
> ⚠ **跨束（`files` / phase-00 `artifact`）**：本束**不得**另建索引表，
> 登记走 `artifacts` + `artifact_versions`；转写稿是派生物，带 `derivedFrom` 指回原音频版本，
> **不覆盖原件**（I-28）。可见性沿用同一套 `acl_bindings`——文件浏览器**不是权限旁路**。

---

## 三、说话人指派（uc-5-2）

```
UC: 列出本场匿名声道与候选人
  in:  { sessionId }
  out: { channels: [{ channelId, label, durationRatio, firstSeenMs, sampleSegmentIds }],
         candidates: [{ personId, displayName, source: "roster" }],
         pending: { unassignedChannels, overlapSegments, lowConfidenceSegments } }
  pre: 两层交集；session 已结束或转写完成
  err: SESSION_NOT_FOUND
     | ROSTER_UNAVAILABLE              // 在场名单取不到 ⇒ 拒绝给候选，**不得**回落到任何跨场次来源
```
> 语义硬点：`candidates ⊆ roster(sessionId)`（I-9）。**不存在**任何跨场次声纹比对调用（I-12）。

```
UC: 指派声道给某人（整声道，一次覆盖全部段落）
  in:  { sessionId, channelId, personId, expectedChannelVersion }
  out: { assignmentId, affectedSegmentCount, backfilledRefs: [{ kind, count }] }
  pre: 调用者是该场次引导师；channel 存在且未被指派
  err: CHANNEL_ALREADY_ASSIGNED
     | CHANNEL_VERSION_CHANGED         // 并发：两人同时指派同一声道 ⇒ 一方收到版本已变化，**不静默覆盖**（E3）
     | PERSON_NOT_IN_ROSTER            // I-9
     | OVERLAP_SEGMENT_REQUIRES_SPLIT  // 重叠段未拆分不可指派（I-7 / O-13）
     | PERMISSION_REVOKED_MIDWAY       // 过程中权限被撤回 ⇒ 立即终止写，已完成步骤按审计保留（E4）
     | IDEMPOTENCY_KEY_CONFLICT
```
> **回填是指向同一条映射记录的引用，不是复制副本**（I-10 / I-11）。

```
UC: 单段例外修正说话人
  in:  { segmentId, personId, reason }
  out: { overrideId, segmentId, resolvedSpeaker }
  pre: 该 segment 不处于 pending-manual（未拆分）
  err: OVERLAP_SEGMENT_REQUIRES_SPLIT
     | PERSON_NOT_IN_ROSTER
     | SEGMENT_NOT_FOUND
```

```
UC: 拆分重叠段
  in:  { segmentId, splits: [{ startMs, endMs, personId? }] }
  out: { segmentIds: [...], parentSegmentId }
  pre: 原 segment.status = 'pending-manual'；splits 的时间区间不重叠且落在原区间内
  err: SPLIT_RANGES_INVALID
     | SEGMENT_NOT_OVERLAP             // 只有 pending-manual 才需要拆
     | SEGMENT_NOT_FOUND
```
> **本 UC 是 `pending-manual` 状态的唯一解除出口**，解除动作必须由人完成并留痕（uc-5-2 R7）。

```
UC: 人工修正段落文本（[设计] 补 —— 原型缺这个出口，见 domain D-10）
  in:  { segmentId, correctedText, reason }
  out: { segmentId, status: "final", lowConfidence: false, revisionId }
  pre: 该 segment.lowConfidence = true
  err: SEGMENT_NOT_LOW_CONFIDENCE
     | PII_MASKING_UNAVAILABLE         // 修正文本同样要过遮盖（I-21）
     | SEGMENT_VERSION_CHANGED         // 并发编辑不静默覆盖
```

```
UC: 撤销指派
  in:  { assignmentId, reason }
  out: { assignmentId, revokedAt, revertedRefs: [{ kind, count }] }
  pre: 调用者是该场次引导师
  err: ASSIGNMENT_ALREADY_REVOKED
     | ASSIGNMENT_NOT_FOUND
     | BACKFILL_REVERT_PARTIAL_FAILURE // 部分回退失败 ⇒ 不得报成功，进重试队列（I-11）
```
> 撤销后所有回填处**同步退回「出处待补」**，不留脏数据。

```
UC: 标记争议（同一段被多人认领）
  in:  { segmentId, claims: [personId, ...] }
  out: { segmentId, status: "disputed", claims }
  pre: —
  err: SEGMENT_NOT_FOUND
     | DISPUTE_CLAIMS_TOO_FEW          // 少于两人不构成争议
```
> ⚠ **[待定 D-9]**：`disputed` 在原型档案里 **0 命中**，是实现者替 UC 做的决定（ui-preview S-16）。
> 签核时必须裁定它是不是正式状态。

---

## 四、声纹销毁（uc-5-2 R7 · O-14 · 本束最硬的一条）

```
UC: 销毁本场声纹 embedding（指派完成时触发）
  in:  { sessionId, trigger: "assignment-completed" }
  out: { destroyedCount, auditEventId }
  pre: 该场次全部声道已完成指派
  err: ASSIGNMENT_NOT_COMPLETE
     | DESTROY_PARTIAL_FAILURE         // 部分删除失败 ⇒ 不得报成功；重试直至 count=0（I-13）
     | CASCADE_INVALIDATION_FAILED     // 级联失效失败 ⇒ 整体判失败（I-16）
```

```
UC: 兜底销毁任务（本场结束后第 7 天，无条件）
  in:  { asOf }
  out: { sessions: [{ sessionId, destroyedCount, auditEventId }] }
  pre: —（定时任务，不依赖指派是否完成）
  err: DESTROY_PARTIAL_FAILURE
     | CASCADE_INVALIDATION_FAILED
```
> 语义硬点（全部可断言）：
> - 销毁是**物理删除 + 审计事件**，不是打标记（I-15）。
> - 级联失效任何以它为输入的派生物与缓存（I-16）。
> - 销毁后重跑 diarization 只产生**新的派生版本**，旧特征不复活（I-17）。
> - 到期删除任务的作用域**不含** embedding —— 它的存活期远短于材料保留期（I-18）。

---

## 五、引述与打点（uc-5-3）

```
UC: 标为引述
  in:  { segmentId, selectionSpan?, rqId?, evidenceNature: "个人经历"|"二手转述"|"观点" }
  out: { quoteId, segmentId, anchor, rqId?, evidenceNature }
  pre: 该 segment.status = 'final' 且 lowConfidence = false
  err: SEGMENT_PARTIAL_NOT_CITABLE         // 「正在识别」中间态
     | SEGMENT_LOW_CONFIDENCE_NOT_CITABLE  // 「识别置信度低 · 待校对」
     | SEGMENT_PENDING_MANUAL_NOT_CITABLE  // 「两人同时说话 · 待人工指派」
     | SEGMENT_DISPUTED_NOT_CITABLE        // 「争议 · 多人认领」（待 D-9 裁定）
     | ANCHOR_MISSING                      // I-29
     | RQ_NOT_FOUND
     | EVIDENCE_NATURE_INVALID
```
> 四个拒绝码**必须可区分**，因为界面要给出**不同的「去校对」出口**（uc-5-3 E5）。
> **不得先入库再说。** 未指派说话人的引述**可以**入库，出处显示「出处待补」（E1）。

```
UC: 绑定引述到研究问题（RQ）
  in:  { quoteId, rqId }
  out: { quoteId, rqId, coverageDelta }
  pre: RQ 属于同一项目
  err: RQ_NOT_IN_PROJECT
     | QUOTE_WITHDRAWN                 // 依据已被撤回
     | QUOTE_NOT_FOUND
```

```
UC: 人工打点
  in:  { sessionId, anchorAt | segmentId, kind, note? }
  out: { annotationId, origin: "human", state: "confirmed" }
  pre: 两层交集
  err: ANCHOR_MISSING
     | ANNOTATION_KIND_INVALID         // 枚举封闭性 [待定 D-8]
```

```
UC: AI 产生打点候选
  in:  { sessionId, contextPackId, agentName }
  out: { annotationId, origin: "ai", state: "candidate", agentName,
         rationale: { contextPackId, segmentIds, retrievalReasons } }
  pre: 上下文**只能**来自 Context API 取的 Context Pack（不得直查 segments / 向量库）
  err: CONTEXT_PACK_REQUIRED           // 缺 contextPackId ⇒ 拒绝（I-26）
     | CONTEXT_PACK_NOT_REPLAYABLE
     | DIRECT_SEGMENT_ACCESS_FORBIDDEN // 静态检查 + 运行时双重（V16）
```

```
UC: 确认 / 编辑后确认 / 忽略 AI 打点
  in:  { annotationId, decision: "confirm"|"edit-confirm"|"ignore", edits?, reason? }
  out: { annotationId, state, decisionId }
  pre: 调用者有该项目的证据写权限
  err: ANNOTATION_ALREADY_DECIDED      // 幂等重放返回首次结果，重复决策报冲突
     | ANNOTATION_RATIONALE_WITHDRAWN  // 依据片段已被撤回 ⇒ 候选自动失效，不可再确认（I-27）
     | ANNOTATION_NOT_FOUND
```
> 语义硬点：候选态**不进证据库、不进报告、不进决策链**（I-24）；
> **不混入人工打点计数**（I-25）；**忽略也留痕**（I-27）。

```
UC: 下游引用一条打点 / 引述
  in:  { annotationId | quoteId, consumer: "report"|"canvas"|"kg"|"decision" }
  out: { ok: true, ref }
  pre: —
  err: AI_ANNOTATION_NOT_CONFIRMED     // I-24 的门
     | EVIDENCE_WITHDRAWN              // 已撤回 ⇒ 标「证据已撤回」，**不静默删除**
```

---

## 六、保留期与到期删除（uc-5-4）

```
UC: 解析生效的材料保留期
  in:  { projectId, orgId }
  out: { resolvedDays, resolvedFrom: "project"|"org", resolvedAt }
  pre: —
  err: RETENTION_POLICY_MISSING        // 组织默认值缺失 ⇒ 拒绝，**不用隐含常量兜底**（E5 / I-33）
     | RETENTION_VALUE_OUT_OF_RANGE    // 允许区间 [待定 D-5]
```
> ⚠ **本用例一律读参数，不写常量**（I-32）。O-01 给出默认值**不放松**这一条。

```
UC: 材料落库并固化到期时间
  in:  { materialId, storedAt, retentionResolution }
  out: { materialId, expiresAt, resolvedFrom, resolvedDays, trainingProhibited: true }
  pre: 保留期解析成功
  err: EXPIRY_ALREADY_FROZEN           // 已固化不可重算（I-31）
     | RETENTION_POLICY_MISSING
```
> 到期时间 = 落库时间 + 生效保留期，**在材料上固化**；事后改参数**不追溯**（I-31）。
> 确需追溯调整走**显式变更审批**并通知受访者 —— 该审批流的归属 **[待人类裁决]**（不在本束）。

```
UC: 到期删除
  in:  { asOf }
  out: { logicallyDisabled: [...], physicallyDeleted: [...], certificates: [{ materialId, certificateId }] }
  pre: —（定时任务）
  err: DELETION_TASK_FAILED            // 材料**保持不可读**，告警重试，**不产出删除证明**（I-34 / E7）
     | OBJECT_STORE_UNAVAILABLE
     | CASCADE_INVALIDATION_FAILED     // embedding / 图边 / 摘要 / 缓存未失效 ⇒ 整体判失败
```
> 语义硬点：
> - 先**逻辑失效**（退出检索、报告段落标「证据已撤回」）再**物理删除**。
> - 删到**文件层**：22-files 中的音频 / `transcript.jsonl` / `notes.md` / 白板照片必须**真的消失**（I-35，**跨束**）。
> - **不可删对象豁免**：快照、绑定关系、审计留痕不受触及（I-36）。
> - **不得**把声纹 embedding 当普通材料按材料保留期处理（I-18）。

```
UC: 查询某份转写的保留期与删除时间
  in:  { materialId }
  out: { expiresAt, resolvedDays, resolvedFrom, trainingProhibited, deletionCertificateId? }
  pre: 两层交集
  err: MATERIAL_NOT_FOUND
     | NO_PROJECT_ROLE
```
> ⚠ **界面缺口 [待定 D-11]**：逐份呈现在原型里不存在，只有项目级一个数值。

---

## 七、同意书渲染（uc-5-4 R3-3 · 消费方在 `consent` 束）

```
UC: 渲染同意书文案
  in:  { projectId, templateId }
  out: { renderedText, variables: { 材料保留期, 数据控制方, 联系人, 合规邮箱 } }
  pre: 全部模板变量已配置
  err: CONSENT_TEMPLATE_VARIABLE_MISSING  // ⇒ **不得发出授权链接**（I-39 / E6）
     | RETENTION_POLICY_MISSING
     | TEMPLATE_NOT_FOUND
```
> **禁止硬编码任何天数**。发一份告知不完整的同意书**比不发更糟**。

```
UC: 固化已提交同意书的渲染快照
  in:  { consentId, renderedText, variables }
  out: { instanceId, contentHash, submittedAt }
  pre: 受访者已提交
  err: CONSENT_SNAPSHOT_IMMUTABLE      // 试图回溯改写已提交快照（I-38）
     | CONSENT_NOT_SUBMITTED
```

---

## 八、失败模式穷举检查表

> 契约完整性的自查项。**每一列都必须有落点，否则界面的那个异常态没人能渲染。**

| 失败类别 | 本束的落点 |
|---|---|
| **并发** | `CHANNEL_VERSION_CHANGED`（两人同时指派同一声道）· `SEGMENT_VERSION_CHANGED`（并发修正文本）· `SESSION_ALREADY_RECORDING` |
| **越权** | `NO_ORG_ROLE` / `NO_PROJECT_ROLE` / `NOT_TRACK_OWNER` / `PII_REVEAL_FORBIDDEN`（**拒绝也写审计**） |
| **依赖失败** | `PII_MASKING_UNAVAILABLE`（脱敏内核）· `ROSTER_UNAVAILABLE`（在场名单）· `OBJECT_STORE_UNAVAILABLE` · `ARTIFACT_REGISTRY_UNAVAILABLE` · `DECRYPTION_KEY_UNAVAILABLE` · `CONTEXT_PACK_NOT_REPLAYABLE` |
| **幂等重放** | 全部写操作接 `idempotencyKey`；冲突 `IDEMPOTENCY_KEY_CONFLICT`；`ANNOTATION_ALREADY_DECIDED` |
| **部分成功** | `MATERIALIZE_PARTIAL_FAILURE` · `BACKFILL_REVERT_PARTIAL_FAILURE` · `DESTROY_PARTIAL_FAILURE` · `CASCADE_INVALIDATION_FAILED`（**一律不得报成功**） |
| **超时 / 断网** | 摄取走**持久任务系统**（PG outbox + job table，**不得用 LangGraph**）；断网本地缓存、恢复补传，转写流上**显式标出缺口**而不是拼接成连续假象（I-5 / E2） |
| **撤回中** | `EVIDENCE_WITHDRAWN` · `ANNOTATION_RATIONALE_WITHDRAWN` · `QUOTE_WITHDRAWN`（撤回链 SLA 在 `consent`/17-gov 单点定义，本束只引用） |
| **权限中途被撤回** | `PERMISSION_REVOKED_MIDWAY` —— 立即终止后续写，已完成步骤按审计保留，未提交输入留本地草稿（E4/E6） |
| **空态** | 全部列表型用例返回真实空集合，**不生成伪数据**（A1）；`pending` 计数为 0 时显示真实空态，不隐藏入口 |

## 九、[待人类裁决] 契约层面表达不了的

1. **数值阈值三项**（DER 混淆率 / 重叠漏检率 / 低置信触发阈值）—— 契约只能表达「命中即挂标记」，
   表达不了「多少算命中」。O-13 已裁为非阻断，实现方**不得**自选一个数当验收线。
2. **加密密钥策略**（`keyRef` 的轮换、托管、权限）—— 是部署与密管形态，不是 API 形状。
3. **删除证明格式与签名** —— 缺合规输入；契约现在只能断言「有/无」，断言不了「格式对不对」。
4. **「显式变更审批 + 通知受访者」流程的归属** —— uc-5-4 R3-2 提到但没说它落在哪个模块。
5. **`disputed` / `EvidenceNature` / `AnnotationKind` 三个枚举的封闭性** —— zod 能写 `enum(n)`，
   写不了「这个枚举是封闭的，新增必须走 ADR」。见 `domain.md` D-7/D-8/D-9。
