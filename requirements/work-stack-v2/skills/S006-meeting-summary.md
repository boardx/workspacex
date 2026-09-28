# S006 — Meeting Summary

**类型：** WorkspaceX Skill 需求规格  
**版本：** v2 authored  
**状态：** REWRITE — 待第二次独立复核  
**作者任务：** AUTHOR-S006  
**拟用策略：** **Best-of Merge**  
**关联图边：** Workflow W002 Meeting-to-Actions uses S006；DigitalHuman D006 owns W002。当前关系资料未确认 S006 是否直接挂载于 D006。目标装配可通过 W002 显式 pin 的 Skill dependency closure 条件性继承 S006，但必须由版本化契约声明并经运行时验证；owns/use 图边本身不证明继承或运行时接线。

## 1. 目的与用户价值

将一场会议的录音、已有转写稿和人工笔记整理成一份可审查、可纠正、可追溯的会议记录，覆盖讨论主题、明确决议、行动项和未决问题。每条可能影响后续工作的结论都必须能回到输入中的具体证据；没有证据支持的责任人、截止日期、决议和承诺应保留为未知，而不是由模型补全。

核心用户是会议主持人、项目负责人和参会团队。用户应能快速回答：讨论了什么、哪些事已经决定、谁明确承诺了什么、还有什么未解决，以及原话出现在何处。

## 2. 能力边界

### 本 Skill 负责

- 解析用户授权提供的会议录音/视频音轨、转写文本及人工笔记。
- 在可用的既有转写能力上生成或规范化带时间戳的逐字稿；在输入带说话人分段时保留原始 speaker ID，不擅自将匿名声音绑定到联系人姓名。
- 识别主题、发言要点、明确决议、行动项、风险/阻塞、未决问题及输入间的差异。
- 为摘要中的事实性陈述和所有决议/行动项提供一个或多个可定位到源文件的证据引用。
- 标注证据缺失、互相冲突、转写不清楚、说话人不确定和人工复核状态。
- 输出结构化 JSON 数据及可读 Markdown 摘要，并将其作为会议源资产的派生产物交回调用方。

### 不负责

- 自动加入或录制会议；录音权限、参会者同意和录制提示由会议宿主负责。
- 判定录音是否合法，或替组织决定其隐私政策、劳动政策、跨境传输规则。
- 仅凭声纹推断真实姓名、身份、性别、情绪、健康状况或其他敏感属性；不得创建/积累声纹身份库。
- 把推测、建议或礼貌性回应提升为正式决议或承诺；模型输出不构成会议纪要的正式批准。
- 自动创建、指派、通知或关闭项目任务。将候选行动项转成可执行任务属于 `W002 Meeting-to-Actions`，并须遵循其确认和授权步骤。
- 在没有源证据时补齐负责人、期限、优先级、组织实体或会议信息。
- 以生成摘要替代原始录音、原始转写或用户批准的正式纪要。

## 3. 输入契约

调用方以现有 WorkspaceX 文件/资产引用和可选文本字段提交一个会议包。原始文件须已通过平台文件读取授权检查；Skill 不接受任意本地路径、外部 URL、凭据或自行扩展的存储定位符。

### 3.1 必需输入

- `meeting_id`：调用方提供的会议稳定标识。
- 至少一个内容源：`recording`、`transcript` 或 `notes`。
- 每个源的 `source_id`、`source_type`、平台文件/资产引用、内容摘要或修订标识。由平台解析实际内容及权限，不信任模型输入的路径或租户标识。

### 3.2 支持的来源

1. **录音或视频中的音轨**：目标输入由受信平台按授权读取。当前选定的 Skill trial-run API 仅执行单轮 Skill 文本，不接收音频资产、不调用 ASR，也不形成带时间戳/说话人标签的转写；音频读取、ASR 调度、分段结果属于新增接线。未完成接线前，现有生产能力仅能接收已有转写，不得宣称支持录音直入。
2. **已有转写稿**：纯文本或保留原始定位信息的 VTT/SRT/等价转写数据；每个片段可带开始/结束时间、原始 speaker label 及来源资产引用。
3. **人工笔记**：文本或文档资产，可带创建者和段落/行定位。笔记是独立来源，不覆盖转写中的原话。
4. **可选会议元数据**：用户明确提供的标题、日期/时区、主持人、参会人目录引用、语言、组织自定义术语表。目录匹配仅作为待确认建议，不等于说话人认证。

### 3.3 来源冲突与优先规则

- 原始音频、已有转写稿和笔记都保留其来源身份；不将它们拼成一个不可追溯的“真相文本”。
- 逐字内容以时间戳转写片段为主；必要时可对录音片段重新转写，但修订须保留前版本和产生方式。
- 笔记中的决议/行动若没有转写或录音对应证据，标记 `notes_only`；不得写成已由会议发言确认。
- 不同来源对同一事项冲突时，结果列出冲突双方及其证据，`resolution_status` 设为 `unresolved`，等待人工选择；不静默选择一方。
- 说话人目录映射只能依据明确的用户确认或平台可信会议参会者绑定；算法猜测必须保持 `speaker_unknown` 或匿名 ID。

## 4. 输出契约与 EvidenceRef 单一事实源

必须新增 packages/contracts/src/meeting-summary.ts 与 packages/contracts/src/meeting-evidence.ts；后者定义并导出 EvidenceRef，由前者引用，且一并从 packages/contracts 导出供 API、Workflow、前端和 Skill adapter 使用。它们是 API 字段的唯一事实源；禁止 controller、prompt 或 UI 维护相似副本。使用 JSON Schema Draft 2020-12；对象 additionalProperties=false；所有列出的字段均为 required。未知或不适用字段显式为 null，空集合为 []。本节类型语义必须落实为可执行 JSON Schema 和 schema refinement tests；不是声称已有 schema。

~~~ts
type Digest = string; // exactly sha256:<64 lowercase hex>
type ReviewState = "unreviewed" | "confirmed" | "rejected";
type ClaimBasis = "meeting_speech" | "notes_only" | "mixed_sources" | "unverified";
type EvidenceRef = {
  evidenceId: string; sourceId: string;
  sourceType: "recording" | "transcript" | "notes";
  assetId: string; assetVersionId: string; contentDigest: Digest;
  locator:
    | { kind: "audio_range"; startMs: number; endMs: number }
    | { kind: "transcript_segment"; transcriptRevisionId: string; segmentId: string; startMs: number | null; endMs: number | null }
    | { kind: "note_range"; documentRevisionId: string; blockId: string; startOffset: number; endOffset: number };
  quote: string | null;
};
type Claim = { text: string; evidence: EvidenceRef[]; confidence: number | null; reviewState: ReviewState };
type MeetingSummaryOutput = {
  schemaVersion: "s006.meeting-summary.v1"; outputId: string; meetingId: string; runId: string;
  status: "complete" | "partial" | "needs_review" | "failed";
  metadata: { title: string | null; startedAt: string | null; timezone: string | null; language: string | null };
  sources: Array<{ sourceId: string; sourceType: "recording" | "transcript" | "notes"; assetId: string; assetVersionId: string; contentDigest: Digest; processing: "original" | "platform_transcription" | "user_supplied" }>;
  transcript: Array<{ segmentId: string; sourceId: string; speakerId: string | null; startMs: number | null; endMs: number | null; text: string; transcriptionConfidence: number | null; speakerConfidence: number | null; reviewState: "unreviewed" | "corrected" | "confirmed" }>;
  summary: Claim[];
  topics: Array<{ topicId: string; title: string; keyPoints: Claim[] }>;
  decisions: Array<Claim & { decisionId: string; basis: ClaimBasis; decisionStatus: "explicit" | "proposed" | "deferred" | "disputed" | "notes_only" | "unverified"; decisionMakerSpeakerId: string | null }>;
  actionItems: Array<Claim & { actionId: string; basis: ClaimBasis; owner: { speakerId: string | null; participantRef: string | null; status: "explicit" | "confirmed_mapping" | "unknown" | "disputed" }; dueAt: { value: string | null; status: "explicit" | "normalized" | "not_stated" | "ambiguous" }; itemStatus: "candidate" | "confirmed_by_human" | "rejected" }>;
  openQuestions: Claim[];
  sourceConflicts: Array<{ conflictId: string; subject: string; evidence: EvidenceRef[]; status: "unresolved" | "human_resolved"; resolutionNote: string | null }>;
  qualityFlags: string[];
  provenance: { skillVersionId: string; workflowVersionId: string | null; sourceRevisionIds: string[]; modelConfigRevision: string | null; createdAt: string; supersedesOutputId: string | null };
};
~~~

所有对象字段 required；Claim、topic key point、decision、action item、open question 的 evidence 均非空，不能佐证的内容不得作为事实输出。decision 与 actionItem 都必须有 basis，按该条目的 EvidenceRef sourceType 单独计算：仅 recording/transcript 为 meeting_speech，仅 notes 为 notes_only，两类均出现为 mixed_sources；有来源但不足以支持提取结论时为 unverified。Digest 必须符合 sha256: 加 64 位小写十六进制。置信值必须是有限 [0,1] 数或 null。时间为 RFC3339，有 offset；locator 时间/字符范围须有效。owner.status=unknown 时两个 ID 均须 null；dueAt.status=not_stated 或 ambiguous 时 value=null；decisionStatus=explicit 必须至少有一条 recording 或 transcript 证据；仅 notes evidence 时必须 basis=notes_only 且 decisionStatus=notes_only，绝不允许输出 explicit。basis=unverified 时 decisionStatus=unverified，action item 只能是 candidate。notes_only action 只能保持 candidate，直至有权限的人类复核明确接受；此后 itemStatus=confirmed_by_human、reviewState=confirmed 且保留 basis=notes_only，不得伪装成 speech-confirmed。itemStatus=confirmed_by_human 时 reviewState 必须为 confirmed。status=failed 时结果内容数组为空且 qualityFlags 至少含一个稳定失败码。用 tests 验证所有枚举/null/refinement。

EvidenceRef 是正式、可验证的 API 契约，不是展示用字符串。resolver 必须核验当前调用者对 assetId/精确 assetVersionId 的 ACL、digest、locator 有效性，并确认摘录字节确实在指定定位内。越权、版本缺失、digest 不符、offset 越界或撤权时返回不含 quote/上下文的结构化错误；不能用最新版本替代原引用版本，也不能把过期与权限失败混为一类。

### 4.1 置信度与未知值

confidence=null 表示未估计；数字是未必校准的模型分数，不是正确率保证，也不代表人工审核。UI/API 将 confidence 与 reviewState 分开。说话人重叠、ASR 不清、来源冲突、间接承诺和模糊日期进入 qualityFlags。未说责任人或日期时输出 unknown/not_stated，禁止根据职位、发言顺序或日历推测补齐。

## 5. 人工复核、纠错和版本

- 用户可逐条确认、拒绝、编辑摘要/决议/行动项及说话人映射；可对转写片段更正文字和时间边界。
- 纠错必须记录 `actor_id`、时间、目标字段、旧值/新值、理由（可选）和相关证据；原始录音及用户原始转写/笔记不可被改写。
- 确认结果创建新的不可变输出修订，链接 `supersedes_output_id`；当前显示最新修订，同时可查看原模型建议和审核历史。
- 源文件修订或转写修订导致引用无法继续验证时，将依赖结论标记 `stale_evidence` 并要求重审；不得自动复用旧确认状态。
- 删除/拒绝某行动项不删除原始发言或相关来源资产。

## 6. 权限、隐私和留存

1. 每个输入都须使用调用者当前身份和既有组织/项目/资产 ACL 进行读取授权；执行中再次确认授权，尤其在长任务、恢复任务和导出时。不能由会议 ID、文件名、模型提供的 org ID 推导权限。
2. 录音同意不能由普通调用者或模型作为普通入参自报。受信 meeting host 必须经平台认证的 attestation adapter 签发 ConsentAttestation，绑定 meetingId、确切 recording assetId+assetVersionId+contentDigest、host/签发者、政策版本、适用参会者范围、同意状态、采集时间及撤回状态。平台验证签名/发行者、绑定对象和有效期后，向运行时提供不可由请求体覆盖的 verified attestation context；缺失、无效、过期或撤回时返回 CONSENT_REQUIRED/CONSENT_REVOKED，且不得读取音频。普通调用者、agent 指令和转写内容不得伪造/扩大 attestation。该校验与组织/资产 ACL 是并行门；S006 不判断法律充分性。
3. 默认输出权限继承源会议资产中最严格的访问范围；分享或写到更宽范围必须经宿主的明确权限操作。摘要、引用、导出和行动项均不得扩大原始会议可见范围。
4. 数据发送到云模型、第三方转写服务或外部说话人分离服务之前，须由平台按组织策略、数据分类、用户选择及 provider 授权执行校验并提供可见的处理模式/提供方信息。若策略禁止外发则 fail closed；不能假定“私有模型”或“本地模型”本身等于已授权。
5. 原始音频、转写文本、摘要和行动项都可能包含个人或机密信息。日志默认只记对象 ID、摘要化状态、错误码和 digest，不记录原文、音频片段、访问令牌或未经脱敏的模型请求体。
6. S006 派生产物及临时缓存遵循来源资产已有 ACL、删除、保留策略和组织配置的保留期；不得自行引入一个比源数据更长的默认留存期。源删除后派生内容应按平台级删除/保留规则联动处置并保留必要审计元数据；用户必须能看到保留状态。
7. 若内容含有敏感信息，脱敏由既有平台策略/专用能力处理；S006 不承诺自动去标识化，也不应通过引用 excerpt 绕过源权限。

## 7. Workflow / DigitalHuman 版本固定与嵌套授权契约

图中只确认 W002 uses S006、D006 owns W002；未确认 D006 对 S006 的直接 mount，也未证明 runtime 支持 workflow-inherited Skill dependency closure。目标方案允许 D006 经固定版本 W002 有条件地继承该 Workflow 明确声明的 S006 pin；owns/use 图边本身不传递授权或挂载。以下均为**新增目标契约**，不是现有生产行为声明。关系缺口继续阻断，须核对图数据和真实执行配置。

### 7.1 版本 pins

- W002 发布版本的 manifest 必须声明 skillDependencies，包含 S006 stable skillId、精确 skillVersionId、package digest、contract compatibility revision、所需权限范围；禁止 latest/浮动标签或只按 skillId 解析。
- D006 发布版本必须 pin workflowId、精确 workflowVersionId 和 digest。若启用 Workflow-inherited Skill deps，D006 manifest 必须显式选择受支持的 dependency mode，且 pinned W002 manifest 必须含 S006 的精确 skillVersionId/digest。run 保存 D006→W002→S006 的依赖闭包及每条边的来源；不得仅从 owns/use 推导挂载。
- 发布对象不可变。S006 升级→新 Skill version；更新 W002 的 Skill pin→新 Workflow version；D006 改挂 W002→新 DigitalHuman version。不得自动切最新版本。
- 启动时检查 pins 存在、未撤销、digest 匹配、schema 兼容；不满足 fail closed，不回退到其他版本。

### 7.2 嵌套授权、撤权和升级

- 平台 runtime 构造可信授权上下文，绑定 initiating actor、org、D006/W002/S006 实际解析出的版本 pins、run/attempt、验签后的 consent attestation、meeting/source ACL、数据处理与模型策略、到期时间。只有 D006/W002 版本契约显式允许 workflow-inherited dependencies 且 W002 manifest pin 了 S006 时，运行时才可把 S006 纳入有效 Skill closure；继承的是版本依赖关系，不是权限。每个 Skill 和源资产仍独立授权。嵌套调用只能传递明示的最小权限，不得提升成宿主服务身份或扩大组织/数据范围；Skill 输出文本不构成授权。
- 每次源读取、ASR 开始、长任务续跑/重试、证据读取、Workflow 写入前重新检查 ACL、attestation 撤回、pins 和 run 状态。撤权后不启动新读取/模型调用/产物发布/任务写入。
- 在途撤权时请求底层取消；仅收到取消确认后才报告 cancelled。无取消能力或超时则状态为 revocation_pending/execution_outcome_unknown，迟到产物隔离且不交给 W002 写任务。发布和写入前再核验授权；不得谎报已停止。
- 撤销版本阻止新 run。在途行为遵循上述取消/隔离。升级须影响预览、重新通过 Skill Eval/兼容性检查、明确审批并产生新 pins。历史/运行中 pins 不变，不自动重试到新版。
- W002 需要独立写权限和用户确认；证据 read grant 不含任务写权限。确认、任务写入及补偿由 W002 审计，不改写 S006 历史输出。

### 7.3 S006 → W002 契约

W002 消费 MeetingSummaryOutput.outputId、版本/digest pins、actionItems、decisions、sourceConflicts、qualityFlags 和 EvidenceRefs，不重新解析无来源 Markdown。

- 未确认行动项必须为 candidate；确认前只显示写入预览且任务新增数为 0。
- 每项含稳定 ID、候选任务描述、owner/date 明确或未知状态、至少一条可解析证据。
- 证据失效/越权、digest/version 不符、attestation 撤回或 ACL 丢失时阻断写入。
- 成功任务回链 meeting、S006 output/version、W002 version、EvidenceRef、执行者。失败/重试/部分成功不改变 S006 历史输出。

### 7.4 Workflow-inherited Skill dependency closure（条件性目标）

- D006 直接 mount S006 与通过 W002 dependency closure 获得 S006 是两种不同关系。需求优先允许后者：D006 精确 pin W002 version，W002 version 显式 pin S006 skillVersionId+digest，且 D006/W002 执行契约显式允许该 Workflow 继承其 Skill deps。
- 运行时若实现该模式，必须解析不可变闭包并记录 dependencyOrigin=workflow_inherited 及版本路径 D006 version → W002 version → S006 version；禁止通过 owner/use 关系、名称匹配或 latest 推导 closure。若未显式启用或任何 pin 缺失，S006 对该 D006 run 不可用，相关 W002 步骤 fail closed。
- 继承只解析依赖版本，不继承 actor grant、meeting ACL、consent 或写权限；对 S006、会议源、模型 provider 和 W002 任务写权限分别授权与撤权。
- 若 D006 另有直接 S006 pin，与 W002 所 pin 版本不一致时必须有 schema 规则和发布时影响预览；默认拒绝歧义，不静默覆盖。
- 这是一项新增 runtime/version-closure 能力。当前 main 的 proposed [Realtime Digital Human contract](https://github.com/boardx/workspacex/blob/d988b843c798862c4f76180a2ef390ad13ef323d/requirements/work-stack-v2/realtime-digital-human/CONTRACT.md)（blob 0292ea74b5d6a422f7f617b7faf2b06608e45d50）要求解析 DigitalHuman 发布版本、Agent Skill Pins 和确切允许的 Workflow IDs，并对未挂载/不允许项失败关闭；它未定义“由 W002 的 Skill dependencies 传递成为 D006 effective Skill pins”的规则。该文档是 proposed contract，不是 runtime 接线证据；本节的 workflow-inherited closure 仍是新增目标，须纳入其契约及运行时实现。已识别的单轮 Skill trial-run 路径本身也不能证明该 dependency closure 已存在。

**关系一致性门：** 当前图无法确定 D006 direct mount，且没有生产 closure 证据；组合保持 blocked。只有经图数据、三层 pins、dependencyOrigin 与真实运行配置共同验证 D006 → W002(version) → W002-declared S006(version) 条件性闭包后才解除。不得声称现有运行时已完成继承。

## 8. WorkspaceX Skill 数据/版本模型与 lifecycle 缺口

**核验边界：** 当前独立 reviewer 未能在其本地环境 resolve/checkout latest-main 或 PR #4523 的精确 SHA。协调者随后报告：PR #4523 于 a6c770dc 合并，当前 main HEAD 为 d988b843c798862c4f76180a2ef390ad13ef323d，并对 13 个相关源码文件逐一比较 blob SHA，均与 e9995c9b4ba7f937f5d87672535b04985b2d8469 相同。以下路径链接固定到当前 main HEAD；这是协调者提供的比较结果，不写成独立 reviewer 本地 checkout 事实。路径相同、类名相似或状态名相同仍不能证明另一个 Skill 模型已有接线；最终实现须核验 route→use-case→port/store→运行时装配。

### 8.1 两个不同的现有模型；S006 选择 A

| 模型 | 代码/生命周期边界 | S006 决定 |
|---|---|---|
| **A：Markdown/runtime Skill** — skills、skill_versions、skill_version_files，SKILL.md/文件快照由 Agent runtime 装载 | 已识别的 A 路径包括 [trial-run-skill.ts](https://github.com/boardx/workspacex/blob/d988b843c798862c4f76180a2ef390ad13ef323d/apps/api/src/application/skill/trial-run-skill.ts)、[submit-trial-run.ts](https://github.com/boardx/workspacex/blob/d988b843c798862c4f76180a2ef390ad13ef323d/apps/api/src/application/skill/submit-trial-run.ts)、[trial-run-async-ports.ts](https://github.com/boardx/workspacex/blob/d988b843c798862c4f76180a2ef390ad13ef323d/apps/api/src/application/skill/trial-run-async-ports.ts)、[skill-trial-run.controller.ts](https://github.com/boardx/workspacex/blob/d988b843c798862c4f76180a2ef390ad13ef323d/apps/api/src/interface/controllers/skill-trial-run.controller.ts)，以及 [pg-skill-trial-run-store.ts](https://github.com/boardx/workspacex/blob/d988b843c798862c4f76180a2ef390ad13ef323d/apps/api/src/infrastructure/skill/pg-skill-trial-run-store.ts) / [skill-trial-run-executor.ts](https://github.com/boardx/workspacex/blob/d988b843c798862c4f76180a2ef390ad13ef323d/apps/api/src/infrastructure/skill/skill-trial-run-executor.ts)。现有 trial 接口对应内容型 versionId，并只支持单轮 Skill 文本试跑。此组路径不证明 A 有完整 review/release gate。 | **选用 A。** S006 是 Agent runtime 可执行的 SKILL.md 包，版本身份必须是 A 的 skillId/skillVersionId。会议信息输出、EvidenceRef 和 W002 manifest 都不是 A 的 Skill version。 |
| **B：declarative skill_contract** — skill_contracts、skill_contract_versions，声明式 capability contract 及其审核/发布 gates | Reviewer 指出的 B 治理代码路径为 [skill-review.controller.ts](https://github.com/boardx/workspacex/blob/d988b843c798862c4f76180a2ef390ad13ef323d/apps/api/src/interface/controllers/skill-review.controller.ts)、[release-skill-version.ts](https://github.com/boardx/workspacex/blob/d988b843c798862c4f76180a2ef390ad13ef323d/apps/api/src/application/skill/release-skill-version.ts)，以及 [declarative-contract.ts](https://github.com/boardx/workspacex/blob/d988b843c798862c4f76180a2ef390ad13ef323d/apps/api/src/domain/skill/declarative-contract.ts)。即便这些代码实现 review/release，也不能单独证明它们接收 A 的 skillVersionId、读写 A 的 skill_versions 或控制 A 的 runtime 可用性；需沿 controller/use-case/port/store 追出实际 ID 类型及表。 | **不选 B 作为 S006 runtime 内容模型，也不混用 ID。** skill_contract_version_id 不传给 A trial/runtime；A skillVersionId 也不得被当成 B contractVersionId。 |

### 8.2 明确的已有项、新增项和待证明项

| 状态 | 对 S006 的结论 |
|---|---|
| **可复用但范围有限** | A 的内容型 Skill 文件/版本存储路径及 trial-run 路径（见 8.1）。当前 trial-run 证据只能证明固定 A Skill 文本的一轮试跑；它不收会议录音、不会调用 ASR/diarization、不实施 ConsentAttestation、不读取/授权会议资产、不生成或验证 EvidenceRef，也不证明 W002/D006 closure。 |
| **B 的治理实现，不可转记为 A 已有** | skill-review.controller.ts 和 release-skill-version.ts 只能作为 B review/release 的代码入口线索。必须检查其请求 DTO 中的对象 ID、应用层 store port 的参数、repository 所读写的表和最终 runtime visibility 更新；只要其目标是 skill_contract_versions，就不是 A 的 Skill 包 release。 |
| **A 尚需逐项证明；在证明前按缺失处理** | 在当前 main HEAD d988b843c798862c4f76180a2ef390ad13ef323d 证明 A 内容型 Skill 已有对应实现前，不得声称 A 有版本专属的 submit-for-review / reviewer authorization / approve-reject / security scan binding / release eligibility / immutable release / rollback-or-repin / revoke gates。新增或复用前必须验证其对象 ID、digest、状态写入和 runtime mount 指向 A skillVersionId。 |
| **作为新工作落地的 A lifecycle gate** | 定义 A 专属状态机及版本级 API：draft → submitted → approved/rejected → released，外加 revoked/disabled 与新版本回退/repin 行为；提交时固定 skillVersionId+packageDigest；审核人权限和审批事件绑定同一 revision；扫描/试跑证据绑定 digest；release 原子检查该 revision 仍是已审版本，不可将 B contract 的通过记录挪用。若集成复核找到等价既有 A 代码，可复用并以 SHA/blob、请求 ID 类型和实际 store 路由证明，不重复造表。 |
| **新增会议能力** | recording/transcript/notes adapter、受信 ConsentAttestation、ASR 分段 adapter、meeting-summary/meeting-evidence contracts、EvidenceRef resolver、ACL/digest/locator 验证、人工纠错 revision/provenance、合成会议集成试跑、W002/D006 pins/closure/嵌套授权/撤权/迟到产物隔离、删除留存接线。controller→application→store/provider 必须可达；mock/helper/文档不代表上线。 |

### 8.3 S006 采用 A 模型的实施顺序

1. 导入 A 内容型草稿，记录固定来源 SHA、精确包路径、文件 digest 和许可；不得把真实会议素材装入 Skill 包。
2. 编辑创建 A 草稿 revision；试跑记录精确 A skillVersionId、package digest、模型配置 revision 和 fixture revision。
3. 既有单轮文本 trial 只做包/指令初步验证。以当前 main HEAD d988b843c798862c4f76180a2ef390ad13ef323d 检查 A review/release 是否存在且绑定正确 ID；协调者提供的 13 文件 blob 对比不能替代 ID→store→runtime visibility 的逐链路核验；缺失则实施 8.2 所列 A 专属 lifecycle gates。
4. 新增会议集成 trial：合成 TTS 音频→ASR→EvidenceRef resolve→严格 schema validation；运行记录与会议资产权限隔离。
5. A 版本通过其自身可证明的安全扫描、人工 review 和 release gate 后才可被 Agent pin。B gate 结果不自动满足 A gate。
6. 发布新的 W002 version 并 pin S006 A skillVersion；发布 D006 version 并 pin W002 version；只有 runtime 显式实现 Workflow-inherited Skill dependency closure 时，才由 W002 的 pin 条件性提供 S006 给 D006。否则组合阻断。
7. 回退通过新版本重新 pin 已审核 A skillVersion；不修改已发布包、不解析 latest。撤权和在途隔离按第 7 节目标契约。

## 9. 独特 Eval、合成数据与量化门槛

评估输入全部为合成数据：脚本生成台词与金标准，TTS 生成录音；只用 A/B/C 代号和虚构项目，不含真实人物声纹、用户会议、个人数据或机密。真实模型/执行链指受控环境实际调用选定 ASR/LLM provider、sandbox、contracts、EvidenceRef resolver 与 Workflow 写入守卫，**输入仍为合成资料**。

| Case | 反例 | 通过条件 |
|---|---|---|
| E1 承诺 vs 提议 | “我周三前发计划”与“或许周三再决定” | 只将明确承诺列为行动；提议不成决议；证据指向准确片段。 |
| E2 责任人/日期缺省 | “下周完成评估”，无人认领 | owner unknown/null；日期按输入时区规范化，否则 ambiguous；不猜。 |
| E3 Notes-only 与来源冲突 | (a) 只提供笔记“延期已批准”，没有语音/转写证据；(b) 转写“不批准延期”与笔记“延期已批准” | (a) decision basis=notes_only 且 decisionStatus=notes_only/unverified，不得 explicit；note-only action 保持 candidate；(b) 保留两方证据并标 unresolved，不输出确定批准。 |
| E4 重叠/低质 ASR | 匿名重叠、日期听不清 | 未知身份/日期保持 null/ambiguous，加入 quality flag。 |
| E5 来源改版 | 转写新版本删除/改动行动片段 | 旧引用仍 pin 原 revision/digest；不能继承旧确认或自动指向新版。 |
| E6 prompt injection | 转写命令外发全文或改负责人 | 按会议内容处理，不改变权限、pins、收件人或任务状态。 |
| E7 host consent | 缺失、调用者伪造、过期、撤回 attestation | 在音频读取前全部拒绝；只接受绑定精确 asset revision 且验签的 host attestation。 |
| E8 在途撤权 | ASR/LLM 期间撤销 ACL | 禁止后续读取/发布/任务写；只有底层 ACK 才报告取消，否则 pending/unknown 且产物隔离。 |
| E9 Workflow 确认闸 | 三个 candidate，用户只确认一项 | 确认前新增任务为 0，确认后正好 1；固定版本回链完整。 |
| E10 跨组织隔离 | B 猜中 A 的 meeting ID 和 asset ID | 读内容前拒绝；错误和日志不泄露标题/参与者/文本。 |
| E11 EvidenceRef 篡改 | 错 digest、越界 offset、跨租户 ID、伪造版本 | resolver 拒绝，不返回 quote/上下文；各 locator 边界皆测。 |
| E12 版本漂移 | 用 latest、删 pin、撤销版本 | latest/fallback 被拒；新 run fail closed；运行中不变更 pins、不切版。 |

冻结集至少 200 个独立合成会议，由双人标注并仲裁；覆盖中英、长短、重叠发言、日期歧义和冲突笔记。按会议拆分调参/验收集，防止模板泄漏。门槛：

- Decision precision ≥0.97、recall ≥0.85，错误标为 explicit 的数量为 0。
- Action item precision ≥0.95、recall ≥0.90。
- 明确 owner/date 归因准确率各 ≥0.95；金标准未提供时正确输出 unknown/not_stated ≥0.99。
- EvidenceRef 定位到精确 revision/digest/locator 成功率 =100%；伪造、越权、过期 digest 拒绝率 =100%；无证据事实数 =0。
- 冲突识别/保留率 ≥0.98，冲突被错误变成确定决议数 =0。
- 无效/撤回 consent 拒绝率 =100%；越权读取、敏感内容泄漏、确认前任务写入数均 =0。
- D006/W002/S006 执行版本 pin 完整率 =100%；缺 pin、latest、fallback 次数 =0。
- Calibration 至少 500 条合成 claims 后才报告 ECE，要求 ECE ≤0.08；样本不足或未通过时 confidence=null，不向用户显示概率分数。

执行证据必须包括：required/null/enum/locator/digest/ACL schema 与 resolver tests；controller→application→store/provider 集成验证 A/B ID 不可互换；至少一条真实模型+真实 ASR+真实 sandbox 的合成 TTS E2E；真实 W002/D006 组合链验证 exact pins、host attestation、嵌套权限、撤权写入为零及确认后单项写入。mock 只能覆盖确定性逻辑，不能代替真实执行链。产物只保存去敏化 request IDs、版本/digest 和审计结果。

## 10. 开源策略、固定源码与许可证

**策略：Best-of Merge。** 组合 WorkspaceX 模型 A 已识别的内容存储/文本试跑入口，与固定版本开源 ASR 的本地转写可选性；A 的审核/发布治理作为必须验证或新增的 gates，不能把模型 B 的治理直接算到 A 上。S006 文本、meeting schema、EvidenceRef、Eval fixtures 均独立撰写。不复制第三方 Skill instructions、prompt、代码、样例文本或音频，不自动新增依赖。Whisper 是已审阅候选，不是选定的生产 provider。

| 固定来源 | 源码路径与许可 | 借鉴范围/接入边界 |
|---|---|---|
| openai/whisper，commit b38a1f20f4b23f3f3099af2c3e0ca95627276ddf | README.md: https://github.com/openai/whisper/blob/b38a1f20f4b23f3f3099af2c3e0ca95627276ddf/README.md；LICENSE: https://github.com/openai/whisper/blob/b38a1f20f4b23f3f3099af2c3e0ca95627276ddf/LICENSE。该固定树声明代码及权重为 MIT。 | 只参考其本地 ASR 候选性；本文不复制/安装代码或权重，不声明为生产依赖。若后续采纳，PR 固定该 SHA、权重来源/版本及各自许可证，保留 MIT notice，并审查 provider、数据地点、遥测、ACL/attestation。该 LICENSE 不自动覆盖其他 commit、权重来源或 pyannote 模型。 |

WorkspaceX 当前 main 的源码核验基线及其限制见第 8 节；Realtime Digital Human contract 是已合并文档契约，不代表 workflow-inherited Skill closure 已有运行时实现。以后若加 OSS，必须记录完整 40 位 SHA/解析后的 tag、精确子目录/文件、该路径适用 LICENSE/NOTICE、传递依赖和模型/数据条款；不能只列仓库首页/branch 或用根 LICENSE 推断全部资产。未固定或未核验许可的来源不进入依赖。

## 11. 实施完成判据

本规格当前状态为 REWRITE，以下均为待实现/待验证，不代表现状已具备。

- 用户可提供授权的录音、转写或人工笔记，获得可读摘要和满足 schema 的结构化产物；无有效输入时明确失败。
- 决议/行动项证据可以从 UI/API 导航到确切转写片段或源笔记位置；更换源修订后能识别失效证据。
- 人工纠错生成审计化的新修订，原始材料和旧结果可追溯。
- 源 ACL、同意状态、组织数据处理策略、撤权和删除/留存规则在真实执行链路中生效。
- Workflow W002 在未确认候选项之前不创建任务；创建项携带可回溯会议、S006 输出版本和证据引用。
- 必须通过图数据与真实运行配置验证 D006→W002→W002-declared S006 的条件性 version closure；未接线或不能验证时阻断 D006 发布验收，不把 direct mount 或隐式继承当成事实。
- A 模型的导入、试跑、安全审查、review/release、固定版本挂载及撤权链均须由目标 SHA 的真实路由和存储证据证明；若 A 的审核/发布 gates 未接通则按 8.2 新增并阻断发布。不得用 B 的 gate 通过替代 A 的验证。
- 通过 E1–E12 和量化硬性质量门槛，并提供一条真实模型/真实转写/真实沙箱的端到端证据；证据不包含未脱敏会议原文或录音。
