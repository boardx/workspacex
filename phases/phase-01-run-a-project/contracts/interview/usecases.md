# 契约束 `interview` — ② 用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 S3、不知道 PostgreSQL。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。
> 覆盖 feature 见 `design-signoff.md` frontmatter 的 `covers:`（权威）。

⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
已建成的 `/studio/interview` 原型有七态壳，但**授权、撤回、洞察三条链的异常态基本没有对手方**
（mock 对自己永远自洽）。别继承这个缺陷。

---

## 统一失败枚举 `InterviewError`

| 码 | 场景 | 前端应显示 | 备注 |
|---|---|---|---|
| `NO_INTERVIEW_ACCESS` | 非协作者读无项目访谈 / 越权读他项目访谈 | 找不到该访谈 | ⚠ **对「不存在」与「无权」必须不可区分**，否则可用切换器枚举探测项目存在性（uc-6-0/E3、V2） |
| `SCOPE_NOT_VISIBLE` | 切换器里出现了无权范围 | 该档位不显示（不是显示后报错） | 服务端过滤，不返回全量再前端过滤 |
| `STEP_CLOSED_OR_ARCHIVED` | 挂载目标环节已删除/归档 | 挂载关系已失效，请重新选择；**产出未丢失** | uc-6-0/E1，不静默丢弃 |
| `REQUIRES_PINNED` | 正式引用指向非固定快照 | 需先定版为固定快照 | 🔗 与 artifact 束同码同义（D-30） |
| `TEMPLATE_STAT_READONLY` | 试图写 `用过 N 次` | 该字段是统计值，不可编辑 | I-8 |
| `TEMPLATE_VERSION_CHANGED` | 并发改同一模板 | 版本已变化，可刷新/对比/重新提交 | uc-6-1/E3 |
| `TEMPLATE_DRAFT_NOT_CONFIRMED` | 抽取草案未确认即被引用 | 该模板还是草案，确认后才入库 | uc-6-1/V3 |
| `OUTLINE_INCOMPLETE` | 段落缺目标或问法 < 2 | N 段还需你改问法 | I-11。⚠ **是否阻断进现场＝[待定 D-6]** |
| `OUTLINE_NOT_CONFIRMED` | 以 `pending_confirm` 进现场 | 大纲还是 AI 草案，请先逐段确认 | I-10，**服务端拒绝**，不只是前端标记 |
| `OUTLINE_OVERWRITE_NEEDS_CONFIRM` | 重新生成会覆盖已手改段落 | 这几段你改过，重新生成会覆盖 | uc-6-2/A3，取消则修改保留 |
| `DURATION_EXCEEDS_PLAN` | 合计时长超研究计划参数 | 超出 `<参数值>` 分，建议压缩 | ⚠ 提示文案必须引用**参数值**，不得写死 60（I-12） |
| `RETENTION_PARAMS_MISSING` | 保留期/控制方/联系人/合规邮箱任一缺失 | 无法发出授权链接，请先补齐配置 | uc-6-3/E2。**发一份告知不完整的同意书比不发更糟** |
| `TOKEN_INVALID` | 令牌不存在 / 过期 / 已撤销 / 已使用 | 链接已失效，请联系 `<合规邮箱>` 重新获取 | ⚠ **不泄露任何访谈内容**，也不提示「这个链接以前是有效的」 |
| `TOKEN_SCOPE_VIOLATION` | 令牌越出本人数据切片 | 无权访问 | I-14，同时写安全审计 |
| `CONSENT_STAFF_READONLY` | 员工试图写他人同意位 | （此接口不存在） | I-1。⚠ 这一条是**不应存在的接口**，写在这里是为了让门控能断言「调用它必被拒」 |
| `CONSENT_REQUIRED` | 必需受访者未提交即开始 | 尚未收到授权，`[开始访谈]` 不可用 → `[去授权]` | I-3 硬门禁，**前端禁用而后端放行不算实现** |
| `CONSENT_WRITE_FAILED` | 受访者提交后写库失败 | 提交失败，你的选择已保留，请重试 | E3。**绝不能显示成功**——最严重的失败模式是「系统认为已授权但本人没提交」 |
| `CONSENT_VERSION_CONFLICT` | 受访者改选择与研究员刷新镜像并发 | 以受访者最后一次提交为准 | uc-6-3/V14，不静默覆盖 |
| `AI_WRITE_FORBIDDEN` | `origin: ai` 写提纲完成态 / RQ 覆盖态 | （拒绝） | I-6，「勾选权在你」 |
| `SUGGESTION_NO_SOURCE` | 建议无来源时间码 | （生成端拒绝落库） | I-5 |
| `SUGGESTION_NOT_FOR_SUBJECT` | 受访者端请求建议字段 | （响应体中不含该字段） | I-34，服务端不下发 |
| `VIRTUAL_SOURCE_FORBIDDEN` | 虚拟来源标强洞察 / 进决策依据 | 虚拟推演不能作为强证据 | I-28，**接口层拒绝，不是按钮置灰** |
| `INSIGHT_NO_EVIDENCE` | 确认无来源的候选 | 这条候选没有来源，不能确认 | I-29 |
| `COUNTEREXAMPLE_WOULD_VANISH` | 合并/调权会抹掉唯一反例 | 该操作会抹掉唯一反例，已阻断 | I-26 / uc-6-5/E4 |
| `GENERALIZATION_UNSUPPORTED` | 普遍性断言但独立受访者 < 5 | 只有 `<N>` 位独立受访者，建议写「部分受访者提到」 | I-27 / O-16，错误 detail 带实际人数 |
| `SPLIT_SESSION_REQUIRED` | 上下级被排进同场 | 已默认拆场；强行同场需二次确认 | I-25 |
| `SAME_ORG_LIMIT` | 同组织人数超研究计划参数 | 同组织不超过 `<N>` 人 | uc-6-7/E5 |
| `CONTACT_PLAINTEXT_DENIED` | 无权限或 agent 请求明文联系方式 | 无权查看联系方式 | I-21，被拒**也写审计** |
| `CONTACT_REQUIRED` | 无联系方式即发授权链接 | 缺联系方式，状态停在「待确认」 | uc-6-7/E1 |
| `OUTBOUND_REQUIRES_HUMAN` | agent 试图直接外发预约 | （拒绝，只生成草稿） | I-24 / D-28 外发邮件恒 R3 |
| `SUBJECT_NOT_GROUPED` | 未归组对象的转写回流 | 该对象尚未归组，回流目标缺失 | uc-6-7/A1 |
| `WITHDRAWAL_IN_PROGRESS` | 撤回处理中又发起写操作 | 该记录正在撤回处理中 | **撤回中**是独立状态，不是 404 也不是成功 |
| `ERASURE_NOT_COMPLETE` | 物理删除失败仍要出回执 | （拒绝出回执） | uc-6-6/E3，材料保持不可读 + 告警重试 |
| `COPY_GENERATION_FAILED` | 文字稿副本生成失败 | 生成失败，可重试 | uc-6-6/E5，不静默失败 |
| `TRANSCRIPTION_FAILED` | 转写失败 | 转写处理 N 失败，可重试；逐字稿留可见缺口 | uc-6-4/E8，**不静默丢段** |
| `COPILOT_UNAVAILABLE` | 副驾驶服务不可用 | 建议暂不可用（**现场记录继续可用**） | uc-6-4/E9，副驾驶是增强不是依赖 |
| `AI_GENERATION_UNAVAILABLE` | 大纲/抽取/建议人选的 AI 不可用 | 保留上一版，可手工继续 | uc-6-1/E2 · uc-6-2/V10 · uc-6-7/V12 |
| `CONCURRENT_MODIFICATION` | 并发改同一对象/段落/主题 | 版本已变化，可刷新/对比/重新提交 | 各 UC 的并发态统一码 |
| `DEPENDENCY_UNAVAILABLE` | 存储/网络/依赖不可用 | 已保留当前输入与最后成功数据，可安全重试 | 各 UC 通用 |
| `PERMISSION_REVOKED_MIDWAY` | 操作过程中权限被撤回 | 已终止后续写操作，请重新授权 | 各 UC 通用 |

⚠ **拒绝响应不得泄露资源是否存在**：`NO_INTERVIEW_ACCESS` 用于「无权」与「不存在」两种情形，
响应体必须逐字节不可区分（uc-6-0/E3 的枚举探测面）。

---

## 用例

### A 组 · 范围与列表（uc-6-0）

#### `listInterviews` —— 跨项目列表 + 范围过滤（V1 V7 V8）

```
in:  { scope: { kind: "project", projectId } | { kind: "research", researchProjectId } | { kind: "none" },
       filters?: { tags?, archived? }, cursor?, limit? }
out: { items: InterviewRow[], nextCursor?, counts: { human: number, virtual: number } }
pre: 调用者在该 scope 有读权限（服务端过滤，不返回全量）
err: SCOPE_NOT_VISIBLE | DEPENDENCY_UNAVAILABLE
```

⚠ 空态必须区分「本范围无访谈」与「无权查看本范围」两种（**文案不同**，V7），且**不生成示例访谈**。
⚠ `counts` **必须是真人/虚拟两个独立字段**，不得合并（D-25 / V5）。

#### `getInterview` —— 按 ID 直读（V2 V6）

```
in:  { interviewId }
out: InterviewDetail
pre: 创建者 或 显式协作者 或（projectId 非空时）该项目成员
err: NO_INTERVIEW_ACCESS
```

⚠ **项目负责人不因职位自动获得跨项目/无项目访谈的读权**（R5）。管理员的项目层读取**写审计且对项目负责人可见**（D-18）。

#### `attachToProjectStep` / `detachFromProjectStep` —— 挂载与解除（V4 V9）

```
in:  { interviewId, projectId, stepId, pinnedVersionId }   // detach: { attachmentId }
out: StepAttachment
pre: 调用者对该项目该环节有写权限；pinnedVersionId 必须指向 pinned 版本
err: NO_INTERVIEW_ACCESS | STEP_CLOSED_OR_ARCHIVED | REQUIRES_PINNED | DEPENDENCY_UNAVAILABLE
```

⚠ 解除挂载**产出仍在**（回到「不属于任何项目」）；挂载/解除**都写审计**，范围切换（读操作）不写。

### B 组 · 模板（uc-6-1）

#### `listTemplates` / `getTemplate`

```
in:  { filters?: { tag? }, cursor? }
out: { items: TemplateRow[] }          // 名称/用过N次/一句话/题数/时长区间 五要素
err: DEPENDENCY_UNAVAILABLE
```

⚠ 空模板库给**两个出口**（新建 / 从已有访谈抽取），**不预置示例模板**（V7）。

#### `createTemplate` / `updateTemplate`

```
in:  { name, goal, sections: {name, minutes, order}[], dataFields: Field[], tags: string[] }
out: { templateId, versionId, versionNumber }
pre: 调用者在该组织可建模板（模板可见范围三档＝[待定 D-16]，见下）
err: TEMPLATE_STAT_READONLY | TEMPLATE_VERSION_CHANGED | CONCURRENT_MODIFICATION
   | AI_GENERATION_UNAVAILABLE | DEPENDENCY_UNAVAILABLE
```

⚠ `updateTemplate` **产生新版本**，已建访谈不受影响（A2 / I-9）。
⚠ **不接受 `usedCount` 入参**——契约里根本没有这个字段（I-8）。

#### `applyTemplate` —— 套用（V1 V2 V4）

```
in:  { templateId, versionId?, targetInterviewId? }
out: { interviewId, appliedTemplateVersionId, sections, dataFields }
pre: —
err: TEMPLATE_DRAFT_NOT_CONFIRMED | NO_INTERVIEW_ACCESS | DEPENDENCY_UNAVAILABLE
```

⚠ 一次性带入**三样**：分段 + 每段时长 + 要收集的数据字段。第三样最常被漏——它是 UC-6.5 证据矩阵能成列的前提。

#### `extractTemplateDraft` / `confirmTemplateDraft` —— 反向抽取（V3）

```
in:  { sourceInterviewIds: InterviewId[] }        // confirm: { draftId, edits? }
out: { draftId, sections, dataFields, sourceInterviewIds }
pre: 调用者对全部来源访谈有读权
err: AI_GENERATION_UNAVAILABLE | NO_INTERVIEW_ACCESS | TEMPLATE_DRAFT_NOT_CONFIRMED
```

⚠ 结果是**草案**，确认后才入库；入库后模板详情可列出来源访谈。
⚠ 输入受 O-05 约束：拒绝 AI 分析者的片段**不进抽取输入**（I-4）。
⚠ **口径降级**：整个反向抽取建立在标签页括注「来自 3 场项目」一个语义未定的字符串上（uc-6-1/A3 自标 [设计]）。

#### `checkQuestionQuality` —— 诱导性/照抄体检（V5）

```
in:  { text, kind: "template" | "outline" }
out: { findings: { span, issue, suggestion }[] }
err: AI_GENERATION_UNAVAILABLE
```

⚠ **是提示不是阻断**。⚠ 「诱导」二字在原型档案里只命中**问卷**侧，访谈侧只有 `2 段还需你改问法`——
这是跨模块借证（uc-6-1/E1 自标 [设计]），需人类确认。

### C 组 · 研究设计（uc-6-2）

#### `createInterviewFromWizard` —— 三步向导（V2 V9）

```
in:  { scope, templateId?: TemplateId | null, subjectIds: SubjectId[], context: {who, situation, decision} }
out: { interviewId, outlineId, outlineStatus: "pending_confirm" }
pre: 模板与对象均对调用者可见；scope 默认继承切换器取值且可改
err: SPLIT_SESSION_REQUIRED | SAME_ORG_LIMIT | AI_GENERATION_UNAVAILABLE | DEPENDENCY_UNAVAILABLE
```

⚠ 第一步可选「从空白开始」（A2）；⚠ 无模板/无对象时各步显示**真实空态与创建入口**，不生成示例大纲。

#### `generateOutline` / `regenerateOutline` —— AI 生成（V5 V10）

```
in:  { interviewId, force?: boolean }
out: { outlineId, sections, status: "pending_confirm" }
pre: 上下文三要素齐备
err: OUTLINE_OVERWRITE_NEEDS_CONFIRM | AI_GENERATION_UNAVAILABLE | DEPENDENCY_UNAVAILABLE
```

⚠ 生成失败**保留上一版大纲，不清空**。⚠ 输入只经 Context API（I-33），并受 O-05 过滤（I-4）。

#### `updateOutlineSection` / `confirmOutline`

```
in:  { sectionId, objective?, openers?, minutes? }   // confirm: { outlineId }
out: Outline
err: OUTLINE_INCOMPLETE | DURATION_EXCEEDS_PLAN | CONCURRENT_MODIFICATION | DEPENDENCY_UNAVAILABLE
```

⚠ 序列化结构中 `objective` **必须在 `openers` 之前**（I-11，顺序是契约的一部分，不是排版）。

#### `readResearchPlanParams` / `updateResearchPlanParams`（V4 V7 V12）

```
in:  { interviewId }                                  // update: { …params }
out: ResearchPlanParams                               // retentionDays 读项目参数
err: RETENTION_PARAMS_MISSING | CONCURRENT_MODIFICATION | DEPENDENCY_UNAVAILABLE
```

⚠ `trainingProhibited` 的状态**必须能被下游转写与 AI 管线读取**（V4），否则这个开关只是装饰。
⚠ `retentionDays` **只读投影**，改它要去改项目的 `材料保留期`（单源，I-12）。

### D 组 · 受访者授权（uc-6-3）

#### `issueSigningToken` —— 发授权链接（V5 V8）

```
in:  { interviewId, subjectId }
out: { tokenId, url, expiresAt }                      // 7 天、一次性
pre: 该项目的 保留期/数据控制方/联系人/合规邮箱 四个渲染变量齐备；对象有联系方式
err: RETENTION_PARAMS_MISSING | CONTACT_REQUIRED | NO_INTERVIEW_ACCESS | DEPENDENCY_UNAVAILABLE
```

#### `getConsentPage` —— 受访者打开授权页（V3 V5 V12）

```
in:  { token }
out: { session: {subjectAlias, whenAt, durationMinutes}, items: ConsentItemCopy[4],
       controller: {org, contactName, complianceEmail}, snapshotId }
pre: 令牌有效、未撤销、未使用
err: TOKEN_INVALID
```

⚠ 四项措辞与降级语义**逐字**属契约（AC3）：取消「交给 AI 做分析」当场显示
「你的话只会以原文引述出现，不参与任何自动归纳」；取消署名当场显示「一律写成『某物流园区运营总监』」。

#### `submitConsent` —— 提交（含 `[全部拒绝]`）（V1 V13 V14）

```
in:  { token, bits: { record, transcript, ai_analysis, attribution } }
out: { submissionId, submittedAt, snapshotId, portalToken: { tokenId, url, expiresAt } }
pre: 令牌有效且未使用
err: TOKEN_INVALID | CONSENT_WRITE_FAILED | CONSENT_VERSION_CONFLICT | DEPENDENCY_UNAVAILABLE
```

⚠ `[全部拒绝]`（四位全 false）是**合法完整结果**，不是失败态，访谈照常可进行。
⚠ 写失败必须**显式对受访者可见**且保留选择（`CONSENT_WRITE_FAILED`）——不得显示成功。
⚠ 提交同时：签署令牌作废（一次性）+ 签发门户长效令牌（I-13）。

#### `getConsentMirror` —— 研究员侧只读镜像（V4 V9）

```
in:  { interviewId }
out: { rows: { subjectId, bits, submittedAt, consentStatus }[], grantedOfFour: "N/4" }
pre: 调用者是本场研究员/联合主持/项目负责人
err: NO_INTERVIEW_ACCESS
```

⚠ **本束不提供任何写他人同意位的用例**。`CONSENT_STAFF_READONLY` 存在的唯一目的，
是让门控能对「构造出来的写请求」断言被拒（I-1 / V4）。

#### `configureSessionRolesAndSwitches` —— 本场角色 + 七开关（V10）

```
in:  { interviewId, roles: {subjectId, role}[], switches: SevenSwitches }
out: { roles, switches }
pre: 调用者是本场主持人
err: NO_INTERVIEW_ACCESS | CONCURRENT_MODIFICATION
```

⚠ 七开关前六默认开、第七 `showAiSuggestionsToSubjects` **默认关**；关闭时服务端**不下发**（I-34）。

#### `startSession` —— 开始访谈的硬门禁（V2）

```
in:  { interviewId }
out: { startedAt }
pre: 必需受访者（＝主访对象，O-15）全部已提交；大纲已确认
err: CONSENT_REQUIRED | OUTLINE_NOT_CONFIRMED | NO_INTERVIEW_ACCESS | DEPENDENCY_UNAVAILABLE
```

⚠ **前端禁用 + 服务端拒绝两侧都要验收**。界面出口是 `[去授权]`，**不存在「仍要开始」的绕过按钮**。
⚠ 多人场部分人未授权：其余人可正常进行，未授权者标「授权未完成，不会被录音或转写」（E5）。

#### `requestWithdrawal` —— 五步撤回编排（V7 V7b · 与 uc-6-6 共用底座）

```
in:  { subjectId, scope: ConsentKey[], reason?, origin: "portal" | "staff-assisted" }
out: { withdrawalId, steps: {no, state, dueAt}[5] }
pre: 请求者是本人（门户令牌）或代其发起并留痕
err: TOKEN_SCOPE_VIOLATION | WITHDRAWAL_IN_PROGRESS | DEPENDENCY_UNAVAILABLE
```

⚠ **部分撤回**只对被撤项执行，其余同意位不受影响。
⚠ 第 03 步**标失效不删除**；对外已发布内容走 **人工确认后替换**（D-19，两个方向都禁止静默）。
⚠ 第 04 步**只能产生一条给拍板人的复核任务**，禁止自动改写结论；超时的后果是催办，不是自动化（uc-6-6/E4）。
⚠ 访谈进行中收紧某项：**即时生效**，正在跑的 AI 归纳任务**中止**（E4），不等到访谈结束。

#### `getWithdrawalStatus` / `issueDeletionReceipt`

```
in:  { withdrawalId }
out: { steps, receipt?: { scope, completedAt, verifiableId } }
err: ERASURE_NOT_COMPLETE | DEPENDENCY_UNAVAILABLE
```

⚠ **物理删除未真正完成前不得发出回执**（uc-6-6/E3）。

### E 组 · 现场（uc-6-4）

#### `getStageState` —— 顶部状态条 + 三栏（V6 V10）

```
in:  { interviewId }
out: { elapsed, remaining, transcriptionFailed: n, proofreadPending: n,
       recording: bool, translating?: string, auth: { grantedOfFour, aiOptOutNames: string[] },
       roster: RosterRow[], outlineProgress: "3/6", sections, rq: RqCoverage[] }
err: NO_INTERVIEW_ACCESS | DEPENDENCY_UNAVAILABLE
```

⚠ `授权 N/4` 与「X 不参与 AI 分析」**常驻**——让研究员任何时刻知道这个人的话能不能给 AI。
⚠ 空态：新开一场无发言时三栏各显示**真实空态**，不生成示例建议或假逐字稿。

#### `setOutlineSectionStatus` / `setRqCoverage` —— 只有人能写（V2 V13）

```
in:  { sectionId, status: "done" | "deferred" }        // rq: { rqId, value: RqCoverageValue }
out: { …, writerOrigin: "human" }
pre: 调用者是主持人（联合主持可改，最终确认权归主持人）
err: AI_WRITE_FORBIDDEN | CONCURRENT_MODIFICATION | NO_INTERVIEW_ACCESS
```

⚠ 记录 agent（Echo）**只能写转写**，不写任何状态字段（R5）。

#### `evaluateSpeakingBalance` / `inviteSpeaker` —— 私下提醒（V5）

```
in:  { interviewId }                                   // invite: { interviewId, subjectId }
out: { alert?: { continuousSeconds, pendingSpeakerId, text } }
pre: 触发需**同时**满足「连续发言 ≥ 阈值（默认 240 秒，可配）」与「他人举手/未答」
err: NO_INTERVIEW_ACCESS
```

⚠ **私下**＝只在研究员这一栏出现，**不广播、不对受访者可见**（V5 第 ③ 条）。
⚠ 只满足时长而无人举手时**不触发**——否则会在正常长叙述时反复打断研究员
（后台反馈「打断时机过早 👎9」的教训，O-36）。

#### `listCopilotSuggestions` / `actOnSuggestion`（V3 V4 V8 V11）

```
in:  { interviewId, since? }                           // act: { suggestionId, outcome, editedText? }
out: { items: CopilotSuggestion[] }                    // 生成频率上限 2 条/分钟（O-36）
pre: 调用者不是受访者；`showAiSuggestionsToSubjects` 关闭时受访者端响应体不含该字段
err: SUGGESTION_NO_SOURCE | SUGGESTION_NOT_FOR_SUBJECT | COPILOT_UNAVAILABLE
```

⚠ 副驾驶不可用时**现场记录必须继续可用**（转录、提纲勾选、标引述、覆盖度全部照常，E9）。
⚠ 观察员的人类私密建议走同一栏但 `origin: human_observer`，**不经 AI 加工原样呈现**并标出提出人。

#### `endAndTranscribe` —— 结束并转写（V1 V12）

```
in:  { interviewId }
out: { coverageSummary: RqCoverage[5], pending: { transcriptionFailed, proofread } }
err: TRANSCRIPTION_FAILED | DEPENDENCY_UNAVAILABLE
```

⚠ 结束页**立刻**返回 5 个 RQ 的覆盖态（AC1）；转写失败条目单列可重试，**不静默丢段**（E8）。

### F 组 · 回流成洞察（uc-6-5）

#### `buildInterviewContextPack` —— per-speaker 前置过滤（F93，本束合规核心）

```
in:  { interviewId, purpose: "copilot" | "insight" | "outline" | "template-extract" }
out: { contextPackId, items: PackItem[], omissions: { reason, count }[] }
pre: —
err: DEPENDENCY_UNAVAILABLE
```

⚠ **过滤发生在这里，不在出口**：`ai_analysis = false` 的受访者片段**根本不进 `items`**（I-4 / O-05）。
⚠ `omissions` 只记**类别与条数**，不泄露被排除者的内容。
⚠ 🔗 `omissions[].reason` 的枚举是 **context-pack 束**的单源（phase-00 已收敛为 7 类），
本束**不得再造一份**——这正是本仓「同一事实两处声明」的高发点。

#### `extractQuotes` —— 人工抽引述（V2 ①）

```
in:  { interviewId, segmentIds: SegmentId[], rqBinding? }
out: { quotes: Quote[] }
pre: —
err: NO_INTERVIEW_ACCESS
```

⚠ **对 `ai_analysis = false` 的受访者，这个用例照样返回原文**——限制的是经模型的处理，不是研究员的判断。

#### `generateCandidateInsights`（V2 V11 V14）

```
in:  { interviewId | themeScope, contextPackId }
out: { candidates: Insight[], excludedSubjectIds: SubjectId[] }
err: INSIGHT_NO_EVIDENCE | AI_GENERATION_UNAVAILABLE | DEPENDENCY_UNAVAILABLE
```

⚠ 候选**不直接入库**；本次归纳的**排除名单写入留痕**（V2 ⑤）。
⚠ 失败时已抽引述保留，**不产出半截洞察**（E11 / V11）。
⚠ 全员拒绝 AI 分析时退化为「只出引述、不出候选洞察」并**显式说明**（E8）。

#### `confirmInsight` / `getEvidenceMatrix` / `mergeThemes` / `splitThemes` / `adjustEvidenceWeight`

```
in:  { candidateId, edits? }                           // matrix: { scope }
out: Insight | EvidenceMatrix                          // 头部含 sessionCount 与 subjectCount 两个数
pre: 每条洞察至少挂 1 条证据；入库时固化来源快照
err: INSIGHT_NO_EVIDENCE | COUNTEREXAMPLE_WOULD_VANISH | CONCURRENT_MODIFICATION | REQUIRES_PINNED
```

⚠ **AI 不得自动合并主题**——合并/拆分/调权重都是人的显式动作，留痕且**可回滚**（A3 / V12）。
⚠ `[合并主题]` 前应预览「合并会让哪些格子消失」，尤其提示是否会抹掉唯一 `反例`。

#### `markStrongInsight` / `referenceForDecision` —— 虚拟隔离（V3）

```
in:  { insightId }                                     // ref: { insightId, decisionId }
out: { ok: true }
err: VIRTUAL_SOURCE_FORBIDDEN | REQUIRES_PINNED
```

⚠ **接口层拒绝**，不是按钮置灰（AC3）。

#### `checkGeneralizationClaim` —— 写作约束（V7 V7b）

```
in:  { themeId, draftText }
out: { blocked: boolean, independentSubjects: number, suggestion?: string }
err: —
```

⚠ 阈值 **5**（普遍性断言）与 **8**（跨组织不可逆聚合）是**全仓单一门槛**（O-16 / D-16），
本束**只引用不重新声明**。提示文案必须给出实际的独立受访者数。

### G 组 · 受访者自助门户（uc-6-6）

#### `getPortalView`（V1 V3 V5 V6 V9 V9b）

```
in:  { portalToken }
out: { bits, submittedAt, snapshot, requests: SubjectRequest[], controller }
pre: 门户长效令牌有效、未撤销、在有效期内（＝材料保留期）
err: TOKEN_INVALID | TOKEN_SCOPE_VIOLATION
```

⚠ 默认是**只读展示 + 三个显式动作入口**，不把编辑态作为默认态（A3）。
⚠ 令牌失效时**响应体不含任何访谈内容**（V9）。

#### `updateConsentFromPortal`（V1）

```
in:  { portalToken, bits }
out: { submissionId, submittedAt, triggeredWithdrawalId? }
err: TOKEN_INVALID | CONSENT_WRITE_FAILED | WITHDRAWAL_IN_PROGRESS
```

⚠ **收紧**即时生效并触发撤回流；**放宽不追溯**——不得为「补齐」去重新转写已删除的音频（R7）。
⚠ 每次变更**追加一条历史版本**，不覆盖（I-16）；研究员侧只读镜像同步更新。

#### `requestTranscriptCopy`（V4）

```
in:  { portalToken }
out: { requestId, status, downloadUrl?, expiresAt? }    // 短时效、一次性链接
err: COPY_GENERATION_FAILED | TOKEN_SCOPE_VIOLATION | DEPENDENCY_UNAVAILABLE
```

⚠ 副本**只含本人发言**：不含他人发言、研究员笔记、AI 建议、主题与洞察；他人 PII 保持遮盖。
⚠ **[待定 D-8]**：本人 PII 是否对本人解遮盖；交付方式与时限。

#### `requestErasure` / `listSubjectRequests`（V1 V2 V6 V10）

```
in:  { portalToken, acknowledged: true }               // list: { portalToken }
out: { requestId, willDelete: string[], willNotDelete: string[], slaText, irreversible: true }
err: TOKEN_SCOPE_VIOLATION | DEPENDENCY_UNAVAILABLE
```

⚠ 删除确认页返回体**必须含四段说明**：会删 / 不会删 / 时限 / 不可逆——缺任一段视为失败（V10）。
⚠ 「不会删」的清单依赖 **[待定 D-9] 法定留存清单**（合规外部输入）。**不得承诺「全部消失」而实际做不到。**
⚠ 每条请求返回**状态与预计完成时间**，且随流水线推进更新——**不能只给一句「已提交」就没有下文**（V6）。

### H 组 · 访谈对象表（uc-6-7）

#### `listSubjects` / `createSubject` / `updateSubject`（V1 V11 V13）

```
in:  { groupId? | interviewId? , filters?, cursor? }
out: { items: Subject[] }                              // contact 恒为 mask
pre: 引导师/项目负责人（全项目）· 组长（本组）· 组员（读，无联系方式）· 研究员（本场）
err: NO_INTERVIEW_ACCESS | CONCURRENT_MODIFICATION | DEPENDENCY_UNAVAILABLE
```

⚠ **观察者不可读对象表**（它含联系方式与未发布的研究意图）。
⚠ 空表给 `[AI 建议人选]` 与 `[＋ 加对象]` 两个出口，**不预置示例对象**。

#### `revealContact` / `exportSubjects`（V7）

```
in:  { subjectId, purpose }                            // export: { scope, includeContact: false }
out: { plaintext } | { fileId }
pre: 有权限的人类主体；**agent 主体一律拒绝**
err: CONTACT_PLAINTEXT_DENIED | DEPENDENCY_UNAVAILABLE
```

⚠ **取到明文也写审计**（不只是被拒时写）；导出默认**不含**联系方式，含联系方式的导出是**独立授权动作**。

#### `suggestCandidates` / `acceptCandidate`（V3 V12）

```
in:  { groupId }                                       // accept: { candidateId, edits? }
out: { candidates: { name?, roleTitle, reason, sources, origin: "ai" }[] }
err: AI_GENERATION_UNAVAILABLE | DEPENDENCY_UNAVAILABLE
```

⚠ **不在表中直接生成行**（候选态）；**候选中不含联系方式明文**；经人确认后才写入（I-23）。
⚠ AI 服务不可用时**手工加对象仍可用**（V12）。
⚠ 重复人选**合并提示**而不是产生重复行；合并需人工确认且保留两条来源记录（E2）。

#### `draftBookingInvite` / `sendBookingInvite`（V4）

```
in:  { subjectId, slots }                              // send: { draftId }
out: { draftId, text, slots } | { sentAt, auditEventId }
pre: send 只能由人类主体触发
err: OUTBOUND_REQUIRES_HUMAN | DEPENDENCY_UNAVAILABLE
```

⚠ **draft 阶段零外发调用**（I-24 / D-28 外发邮件恒 R3）。

#### `routeTranscriptToGroup`（V2 V8 V9）

```
in:  { interviewId, subjectId }
out: { groupId, artifactRefs: { artifactId, versionId }[] }
pre: 对象已归组
err: SUBJECT_NOT_GROUPED | REQUIRES_PINNED | DEPENDENCY_UNAVAILABLE
```

⚠ 回流携带**来源资源、版本、触发者、时间与可见范围**；正式引用绑**固定快照**（I-30）。
⚠ `ai_analysis = false` 的对象：回流内容**不参与本组推演模板的自动填充**，只能以原文引述出现（V8）。
⚠ 撤回后表上**保留该行**但状态为「已撤回」，内容已退出检索，界面明确提示数据已失效（V9 / E7）——
**不得因为表上还有这一行就以为数据还在**。

---

## 端口（`infrastructure` 实现这些）

| 端口 | 职责 | 实现 |
|---|---|---|
| `InterviewRepository` | 场次 / 挂载 / 提纲 / RQ 覆盖 | PostgreSQL（RLS 强制） |
| `TemplateRepository` | 模板与不可变版本、`usedCount` 统计投影 | PostgreSQL |
| `SubjectRepository` | 对象表（两处投影同一条记录，I-20） | PostgreSQL |
| `ConsentStore` | 同意位 append-only + 渲染快照不可变 | PostgreSQL（触发器拒 UPDATE/DELETE） |
| `TokenIssuer` | 两种令牌的签发/校验/撤销/自助重发；高熵、可撤销、限速 | 服务端 + Redis |
| `ContextApiClient` | **唯一**的 AI 输入通道（I-33） | context-pack 束的 Context API |
| `WithdrawalOrchestrator` | 五步编排 + 两级 SLA 的可观测指标与告警 | 持久任务系统（**不用 LangGraph**） |
| `TranscriptSource` | Segment / 引述 / 说话人指派 | 05-rec 束（UC-5.1~5.3） |
| `ObjectStore` | 音频 / `transcript.jsonl` / `notes.md` / 副本导出 | S3（artifact 束的 file-first 约定） |
| `PiiVault` | 联系方式加密存储 + 掩码投影 | KMS + PostgreSQL |
| `OutboundGateway` | 预约外发（**只接受人类触发**） | provider 抽象（O-40，不绑厂商） |
| `AuditWriter` | 审计事件（含越权尝试） | 17-gov 的统一 provenance 面 |
| `Notifier` | 研究员 / 拍板人 / 合规负责人通知 | O-33 单点定义的通知规范 |

⚠ **编排边界（O-35 / Context Engine）**：多阶段生成与人工确认（三步向导生成提纲、批量归纳）可用 LangGraph；
**实时副驾驶建议、转写摄取与索引一律不用**，走服务端 run/event 与持久任务系统。
