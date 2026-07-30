# 契约束 `recording` — 支撑材料 · UC 覆盖证明

> **这一件回答的问题**：前面几件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，只要有一条 UC 的验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature：F69 F70 F71 F72 F73 F74 F75 F76 F77 F78 F79（11 件，合计 **31 点**）
> ⚠ **上面这一行是派生视图，不是权威。** 束↔feature 映射的权威是
> `design-signoff.md` frontmatter 的 `covers:`（ADR-023 决策三）。改覆盖范围改那里。
>
> 依据 UC 与其 R12 条数：`uc-5-1`（17 条）· `uc-5-2`（10 条）· `uc-5-3`（10 条）· `uc-5-4`（11 条）

## 怎么读这张表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**里的真实 `data-testid`（来自
`apps/web/components/interview/` · `apps/web/components/entry/` · `apps/web/components/chat/`）；
填不出来的标 `—（API 层验收）`，**但不能空着**。

---

## 一、`uc-5-1` R12（17 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：4 路同时录不串台——各路注入已知音频，断言互不含 | `startRecording`（trackPlan 多路）+ `ingestSegment` → I-6 断言 | `/studio/interview` `itv-tracks` + `itv-track-{id}` | ✅ |
| V2 | AC2：每句都能点时间码跳回音频 | `listTranscript` → `anchor{startMs,endMs}`；I-1/I-2 | `/studio/interview` `itv-tc-{segId}` + `itv-audio-scrubber` + `itv-audio-reset` | ✅ |
| V3 | AC3（O-13）：重叠段 speaker 不是任何单一标识、不可引述、低置信挂待校对并计数 | `ingestSegment`(overlap) → `pending-manual`；`markQuote` → `SEGMENT_PENDING_MANUAL_NOT_CITABLE` | `itv-overlap-{segId}` + `itv-overlap-pick-{segId}`（无默认选中）+ `itv-overlap-keep-{segId}` | ✅ 见 I-7/I-8 |
| V4 | AC4：右栏五标签带计数；搜索逐字稿命中高亮；自动跟随生效；正在识别不可引述；每句带时间码 | `listTranscript`（`q` 检索 + `status`）；`markQuote` → `SEGMENT_PARTIAL_NOT_CITABLE` | `/chat` `chat-right-panel` + `chat-tab-{key}`（五标签）+ `chat-transcript-search` + 自动跟随开关（现为 `id="chat-follow"`，**尚无 data-testid**）+ `chat-transcript-identifying` + `chat-transcript-timer` | ✅ |
| V5 | AC5：对话线程开录后线程卡片与线程头出现「● 转录中」，停止后消失 | `startRecording`(sourceType=`thread`) / `endRecording` | `/chat` `chat-transcript-card` + `chat-transcript-tab` + `chat-transcript-stop` + `chat-transcript-stopped` | ✅ |
| V6 | AC6：拒绝麦克风不产生转写段并显式标「未录制」；关闭后出现「录制已暂停」且不再增长 | `setMicState` → `denied`/`paused`；I-4/I-5 | `/group` `group-mic-toggle` + `group-mic-status` | ✅ |
| V7 | AC7：邮箱/手机号默认返回遮盖串、显示「查看原文需权限」，无权限请求原文被拒并写审计 | `ingestSegment`（入库前遮盖）+ `revealPiiOriginal` → `PII_REVEAL_FORBIDDEN` + 审计 | ⚠ **逐字稿上无 PII 遮盖标注与「查看原文」出口**（`itv-transcript` 现有行内标注不含此态） | ⚠ **缺口 1** |
| V7b | O-39：身份证号/银行卡号/详细住址同样被遮盖；手机号库中为密文、接口返回掩码 | 同上，`PiiType` 五类；I-19/I-20 | 同 V7（掩码格式参照 ui-preview S-10 的 `138 •••• 2049`） | ⚠ **缺口 1** |
| V8 | 权限态：六类角色遍历；授权未完成的参与者不产生任何录音与转写段 | 全部读写用例的两层交集；`startRecording` → `CONSENT_NOT_COMPLETED` | `/studio/interview` `itv-auth-badge` + `itv-auth-panel` + `itv-auth-count` + `itv-readonly-banner` | ✅ |
| V9 | 空态：无目标数据时显示真实空态与下一步，不生成伪数据 | `listTranscript` → `[]`；`listSpeakerChannels` → `pending` 全 0 | `/studio/interview?state=empty`（七态预览轴，已建） | ✅ |
| V10 | 依赖失败：断网本地缓存、恢复补传，转写流显式标出缺口而不是拼接成连续假象 | `setMicState` 的 `gapRanges`；持久任务重放；I-5 | ⚠ **断网态屏未建**（原型「断网」档案 0 命中） | ⚠ **缺口 2** |
| V11 | 并发态：两人改同一资源不静默覆盖，可识别最终版本 | `assignSpeaker` → `CHANNEL_VERSION_CHANGED`；`correctSegmentText` → `SEGMENT_VERSION_CHANGED` | `/studio/interview` `itv-dispute-{segId}` + `itv-dispute-note-{segId}` | ✅ |
| V12 | 审计态：关键动作可按操作者/时间/对象/结果检索；越权尝试也有安全审计 | `queryProvenance`（**跨束**，见缺口 5） | `/admin` 活动流（identity 束）；本束无独立屏 | ⚠ **缺口 5** |
| V13 | 全链路无跨场次声纹比对接口或持久化身份特征；本场聚类特征随本场音频删除时销毁 | schema 内省 + 静态检查；I-12/I-13/I-14 | —（API 层验收 + 静态检查） | ✅ |
| V14 | file-first：音频与 `transcript.jsonl`（访谈另有 `notes.md`）在 22-files 可见可下载；`derived_from` 指回原音频且原件 SHA 不变 | `materializeRecordingArtifacts` → `{artifactId, versionId, contentHash, derivedFrom}` | `/projects/[id]/files`（**跨束**：files 束的目录树与下载） | ⚠ **缺口 3（跨束）** |
| V15 | Segment↔anchor 完整性：遍历全场 segments，无 anchor 记录数为 0；抽样可跳回音频 | `ingestSegment` → `ANCHOR_MISSING`；I-1/I-2/I-3 | `itv-seg-{segId}` + `itv-tc-{segId}` | ✅ |
| V16 | 只经 Context API 取上下文：AI 侧无对 segments/向量库/对象存储的直连；一次 AI 请求对应一条 `context_packs` 可重放 | `proposeAiAnnotation` → `CONTEXT_PACK_REQUIRED` / `DIRECT_SEGMENT_ACCESS_FORBIDDEN`；`lint-arch-deps` | `/brain` `brain-context-pack`（**跨束**：context-pack 束） | ⚠ **缺口 4（跨束）** |

---

## 二、`uc-5-2` R12（10 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：指派后引述自动补上出处且能撤销；撤销后所有回填处同步退回「出处待补」 | `assignSpeaker` → `backfilledRefs`；`revokeAssignment` → `revertedRefs`；I-10/I-11 | `/studio/interview` `itv-assign-{segId}` + `itv-assign-pick-{segId}` | ⚠ **缺口 6**（撤销出口未建） |
| V2 | AC2（O-14）：候选人全部在本场在场名单内；无跨场次声纹特征表或比对调用 | `listSpeakerChannels` → `candidates ⊆ roster`；`ROSTER_UNAVAILABLE`；I-9/I-12 | `itv-overlap-pick-{segId}`（候选列表来源） | ✅ |
| V2b | O-14 销毁时点：①指派完成后 embedding 数为 0（物理删除）②第 8 天兜底任务同样为 0 且写审计 ③重跑只产生新派生版本 | `destroyVoiceprintEmbeddings` + `voiceprintFallbackSweep`；I-13～I-17 | —（API 层验收 + 定时任务断言） | ✅ **本束最硬的一条** |
| V3 | AC3：两类异常段调用抽引述均被拒；经人工修正/拆分后解锁；「逐字稿校对 N」同步递减 | `markQuote` 四个拒绝码；`splitOverlapSegment`；`correctSegmentText` | `itv-overlap-{segId}` + `itv-dispute-{segId}` + `itv-mark-quote-{segId}` | ⚠ **缺口 7**（文本修正出口原型缺失，D-10） |
| V4 | AC4：含 PII 段落默认返回遮盖串；无权限请求原文被拒并写审计；有权限取到原文同样写审计 | `revealPiiOriginal`；I-19/I-23 | ⚠ 同 uc-5-1 V7（无遮盖标注出口） | ⚠ **缺口 1** |
| V5 | 权限态：六类角色遍历，返回数据与可执行动作严格符合 R5 | 全部用例的两层交集；观察者掩码到角色标签 | `itv-readonly-banner` + `itv-alias-note` + `itv-interviewee-self` | ✅ |
| V6 | 空态：无目标数据时显示真实空态与下一步 | `listSpeakerChannels` → 空 channels | `/studio/interview?state=empty` | ✅ |
| V7 | 依赖失败：输入与最近成功数据保留，错误可解释可重试 | `ROSTER_UNAVAILABLE` / `PII_MASKING_UNAVAILABLE` | `/studio/interview?state=dep-failed`（七态预览轴） | ✅ |
| V8 | 并发态：两人同时指派同一声道不静默覆盖；同一段被多人认领保留争议标记且双方可见 | `assignSpeaker` → `CHANNEL_VERSION_CHANGED`；`markDispute` | `itv-dispute-{segId}` + `itv-dispute-note-{segId}` | ⚠ 见 **D-9**（`disputed` 是实现者补的） |
| V9 | 审计态：每次指派与撤销记录「谁把哪个声道绑到了谁、什么时候」；越权也有安全审计 | `queryProvenance`（**跨束**） | `/admin` 活动流 | ⚠ **缺口 5** |

---

## 三、`uc-5-3` R12（10 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：引述在报告里能一路追回原始音频位置 | `markQuote` → `{segmentId, anchor}`；下游 `referenceQuote` | `itv-mark-quote-{segId}` + `itv-quote-{segId}`；报告侧来源角标在 10-report（**跨束**） | ⚠ **缺口 8（跨束）** |
| V1b | anchor 完整性：遍历全部引述，缺 anchor 记录数为 0；按 anchor 能在 22-files 打开原件定位 | `markQuote` → `ANCHOR_MISSING`；I-29 | `itv-tc-{segId}`；原件定位在 `/projects/[id]/files`（**跨束**） | ⚠ **缺口 3（跨束）** |
| V2 | AC2：AI 打点带 `origin: ai` 与 agent 名；未确认取不到、引用被拒；确认后才可引用；忽略可检索 | `proposeAiAnnotation` / `decideAiAnnotation`；`AI_ANNOTATION_NOT_CONFIRMED`；I-24～I-27 | `/studio/interview` `itv-decision-{segId}`（「AI 标记 · 决策点（待确认）」）+ `/chat` `chat-transcript-insight` | ⚠ **缺口 9**（三出口 `[确认][编辑后确认][忽略]` 未建） |
| V3 | AC3：把引述绑到 RQ2，UC-6.4 覆盖度视图与 UC-6.5 证据矩阵同步反映 | `bindQuoteToRq` → `coverageDelta` | `/studio/interview` `itv-coverage-summary`（**消费方跨束**：06-itv） | ⚠ **缺口 10（跨束）** |
| V4 | AC4：对「正在识别 / 待校对 / 待人工指派」三态调用标引述均被拒，返回可读原因与「去校对」出口 | `markQuote` 四个**可区分**拒绝码 | `itv-mark-quote-{segId}`（禁用态）+ `itv-overlap-{segId}` | ✅ 见 I-8 |
| V5 | 权限态：六类角色遍历，严格符合 R5 | 两层交集 | `itv-readonly-banner` + `itv-followups-denied` | ✅ |
| V6 | 空态：无目标数据时显示真实空态与下一步 | `listQuotes` → `[]` | `/studio/interview?state=empty` | ✅ |
| V7 | 依赖失败：输入与最近成功数据保留，可解释可重试 | `CONTEXT_PACK_NOT_REPLAYABLE` / `PII_MASKING_UNAVAILABLE` | `/studio/interview?state=dep-failed` | ✅ |
| V8 | 并发态：两人改同一资源不静默覆盖，可识别最终版本 | `ANNOTATION_ALREADY_DECIDED` / `SEGMENT_VERSION_CHANGED` | `itv-dispute-{segId}` | ✅ |
| V9 | 审计态：AI 打点的产生、确认、忽略三类事件均可独立检索 | `queryProvenance`（三种 event type，**跨束**） | `/admin` 活动流 | ⚠ **缺口 5** |

---

## 四、`uc-5-4` R12（11 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：能看到每份转写的保留期与删除时间，元数据记录取自哪一级 | `getMaterialRetention` → `{expiresAt, resolvedDays, resolvedFrom}` | `/studio/interview` `itv-retention`（**项目级一个数值**，非逐份） | ⚠ **缺口 11** |
| V2 | AC2：改项目覆盖值后 ①新授权页显示新值 ②已提交同意书快照仍显示旧值 ③已落库材料到期时间不变 | `resolveRetention` + `renderConsentCopy` + `snapshotConsentInstance`；I-31/I-38 | `/consent` `consent-body` + `consent-controller` | ✅ |
| V3 | AC3：全仓无写死保留天数常量；清空项目覆盖回落组织默认；清空组织默认则拒绝开始录制 | `resolveRetention` → `RETENTION_POLICY_MISSING`；I-32/I-33 静态检查 | —（API 层验收 + 静态检查门控） | ✅ |
| V3b | O-01：五参数默认值断言（材料 180 / 留痕 180 / 宽限 30 / 知识 6·12·24 月 / 审计 1095）；本模块无硬编码天数 | 留存策略内核的 `getRetentionPolicy`（**跨束**：00-core/17-gov） | —（API 层验收） | ⚠ **缺口 12（跨束）** |
| V4 | AC4：把到期时间调到过去，断言先不可读、进待删除队列，宽限期后物理删除并产出可检索删除证明 | `runExpiryDeletion` → `{logicallyDisabled, physicallyDeleted, certificates}`；I-34 | —（API 层验收；逐份删除时间界面未建，见缺口 11） | ⚠ **格式待定 D-3** |
| V4b | file-first 删除：①22-files 中该场次四类文件不可见不可下载 ②embedding/图边/摘要/缓存可验证失效 ③不可删对象仍在 | `runExpiryDeletion` 的 `CASCADE_INVALIDATION_FAILED`；I-35/I-36 | `/projects/[id]/files`（**跨束**：files 束） | ⚠ **缺口 3（跨束）** |
| V5 | 权限态：六类角色遍历，严格符合 R5 | 两层交集 | `/consent` `consent-body`（受访者视角）+ `itv-readonly-banner` | ✅ |
| V6 | 空态：无目标数据时显示真实空态与下一步 | `getMaterialRetention` → 空列表 | `/studio/interview?state=empty` | ✅ |
| V7 | 依赖失败：删除任务失败时材料保持不可读、告警重试，**不产出删除证明** | `runExpiryDeletion` → `DELETION_TASK_FAILED`；I-34 | —（API 层验收 + 告警） | ✅ |
| V8 | 并发态：两人改同一资源不静默覆盖，可识别最终版本 | `freezeExpiry` → `EXPIRY_ALREADY_FROZEN` | —（API 层验收） | ✅ |
| V9 | 审计态：参数变更、到期删除、删除证明发放三类事件可独立检索 | `queryProvenance`（三种 event type，**跨束**） | `/admin` 活动流 | ⚠ **缺口 5** |

---

## 五、缺口清单（这一件的真正价值所在）

> 这 12 条是**这一轮设计的产出，不是失败**。契约束的意义就是把它们在写代码之前找出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | **PII 遮盖在界面上完全没有落点**。`itv-transcript` 现有行内标注含「待人工指派 / 争议 / 决策点 / 正在识别」，**唯独没有**「已自动遮盖：… · 查看原文需权限」，也没有查看原文的授权出口 | 界面缺口（F72） | 交给 ui-prototyper 补：逐字稿行内遮盖标注 + `[查看原文]` 出口 + 无权限态。掩码格式沿用 S-10 的 `138 •••• 2049`。**API 层的五类遮盖与手机号密文可先行开工**（I-19/I-20 是纯 API 断言） |
| **2** | **断网/补传态屏未建**。原型「断网」档案 0 命中，V10 的「转写流上显式标出缺口」无界面 | 界面缺口（F69） | ui-prototyper 补一态：转写流上的 gap 标记 + 「本地缓存 N 段待补传」。契约侧 `gapRanges` 已定（I-5） |
| **3** | **file-first 的另一半在 `files` 束**。V14 / V1b / V4b 的「在 22-files 可见、可下载 / 删除后真消失」不由本束验收 | **跨束** | 提**阶段一致性复核**：本束**不得**另建索引表；目录结构与命名对外可见即契约；可见性沿用同一套 `acl_bindings`。F73 是这条的落点 |
| **4** | **Context API 是唯一取数路径，门控在 `context-pack` 束**。V16 要静态 + 运行时双重断言 | **跨束** | 一致性复核确认：AI 侧（副驾驶、归纳、打点候选）**一律经 Context Pack**。若各下游各自直连 `segments`，PII 策略与权限判定会有 N 份实现 |
| **5** | **provenance / 审计查询面跨束**。本束的指派、撤销、PII 查看、声纹销毁、删除证明五类事件都要写审计并可检索，但查询面不在本束 | **跨束** | 与 phase-00 `artifact` 束的缺口①是同一件事：**统一一个 provenance 查询面**。各束各造就是第 N 次「同一事实声明在多处」 |
| **6** | **撤销指派的界面出口未建**。`itv-assign-*` 只有指派，无撤销；V1 的「撤销后全部退回出处待补」无处触发 | 界面缺口（F74） | ui-prototyper 补撤销出口 + 影响范围二次确认（对齐 S-14 的危险动作规范）。API 断言可先行 |
| **7** | **`识别置信度低 · 待校对` 无解除出口**。原型行内操作条五个按钮**没有文本编辑入口**，早期稿本的 `[编辑文本]` 是伪造按钮已删 | 需裁决 + 界面缺口 | 见 `domain.md` **D-10**。契约侧已给 `correctSegmentText` 端口，但**这是本束替 UC 补的设计**，签核时必须确认 |
| **8** | **引述→报告的追回链另一半在 10-report**。V1「引述在报告里能一路追回原始音频位置」两端分属两束 | **跨束** | 一致性复核：报告来源角标必须携带 `segmentId + anchor`，不复制正文 |
| **9** | **AI 打点的三出口未建**。`itv-decision-{segId}` 只渲染了「AI 标记 · 决策点（待确认）」徽章，没有 `[确认] [编辑后确认] [忽略]` | 界面缺口（F77） | ui-prototyper 补三出口 + 依据出口 `[看洞察]`（`/chat` 已有 `chat-transcript-insight`，访谈侧缺）。**闸门本身（I-24）是纯 API 断言，可先行** |
| **10** | **引述↔RQ 绑定的消费方在 06-itv**。V3 要断言覆盖度视图与证据矩阵同步 | **跨束** | 一致性复核：`rqId` 的生命周期归谁、覆盖度重算由谁触发 |
| **11** | **逐份转写的保留期/删除时间呈现不存在**。`itv-retention` 是**项目级一个数值**，AC1b 要的是**每份** | 界面缺口 + Backlog | 见 `domain.md` **D-11**。需补画原型。另注意 R8「保留期三处呈现必须同源」（I-40）——现在只有两处 |
| **12** | **留存策略内核（五参数读取接口）不在本束**。V3b 要断言五个默认值 | **跨束** | 本束是**消费方**；内核在 00-core / 17-gov。一致性复核确认它有人负责，且 UC-6.3 的同意书渲染读**同一个**接口（否则告知天数与实际执行天数会不一致——这是合规上的实质缺陷） |

---

## 六、反向检查：有没有多余的 API

| API 操作 | 被哪条验收要求 | 结论 |
|---|---|---|
| `startRecording` | uc-5-1 V1 V5 V6；uc-5-4 V3（缺参数拒绝开始） | ✅ |
| `setMicState` | uc-5-1 V6 V10（gap） | ✅ |
| `ingestSegment` | uc-5-1 V2 V3 V7 V7b V15 | ✅ |
| `listTranscript`（含 `q` 检索） | uc-5-1 V2 V4 V9 | ✅ |
| `endRecording` | uc-5-1 V5 | ✅ |
| `revealPiiOriginal` | uc-5-1 V7 V7b；uc-5-2 V4 | ✅ |
| `materializeRecordingArtifacts` | uc-5-1 V14 | ✅ |
| `listSpeakerChannels` | uc-5-2 V2 V6 | ✅ |
| `assignSpeaker` | uc-5-2 V1 V8 | ✅ |
| `overrideSegmentSpeaker` | uc-5-2 V1（单段例外修正） | ✅ |
| `splitOverlapSegment` | uc-5-1 V3；uc-5-2 V3 | ✅ |
| `correctSegmentText` | uc-5-2 V3 | ⚠ **本束替 UC 补的**（D-10），签核时确认 |
| `revokeAssignment` | uc-5-2 V1 | ✅ |
| `markDispute` | uc-5-2 V8 | ⚠ **实现者已造出该状态**（D-9），签核时确认 |
| `destroyVoiceprintEmbeddings` | uc-5-2 V2b ① | ✅ |
| `voiceprintFallbackSweep` | uc-5-2 V2b ② | ✅ |
| `markQuote` | uc-5-3 V1 V1b V4 | ✅ |
| `bindQuoteToRq` | uc-5-3 V3 | ✅ |
| `markMoment`（人工打点） | uc-5-3 V1 | ✅ |
| `proposeAiAnnotation` | uc-5-1 V16；uc-5-3 V2 | ✅ |
| `decideAiAnnotation` | uc-5-3 V2 V9 | ✅ |
| `referenceQuote / referenceAnnotation`（下游引用门） | uc-5-3 V2 ② | ✅ |
| `resolveRetention` | uc-5-4 V1 V3 V3b | ✅ |
| `freezeExpiry` | uc-5-4 V1 V8 | ✅ |
| `runExpiryDeletion` | uc-5-4 V4 V4b V7 | ✅ |
| `getMaterialRetention` | uc-5-4 V1 V6 | ✅ |
| `renderConsentCopy` | uc-5-4 V2 ① | ✅ |
| `snapshotConsentInstance` | uc-5-4 V2 ② | ✅ |

**28 个操作全部有 UC 要求，无孤儿接口。** 其中两个（`correctSegmentText` / `markDispute`）
是**本束替 UC 补的设计**，已单列标出——它们正是「实现者替 UC 做决定」最容易发生的位置。

---

## 七、签核时请重点看这三处

1. **缺口 3/4/5/8/10/12 全是跨束的**，且缺口 5 与 phase-00 `artifact` 束的缺口①是同一件事。
   它们不该在本束解决，而应在**阶段一致性复核**统一设计。若每束各造一套
   provenance 查询 / Context 取数路径 / file-first 登记，就是本仓第 N 次「同一事实两处声明」。
2. **缺口 1 是本束最大的界面缺口**：PII 遮盖（F72，3 点）在契约层完备、在界面层**一个落点都没有**。
   请确认它由 ui-prototyper 在签核前补出，还是接受「API 先行、界面随后」。
3. **`correctSegmentText` 与 `markDispute` 是本束替 UC 补的两个端口**（D-9 / D-10）。
   前者是因为「待校对」状态在原型里**根本没有解除出口**——不补它，那个状态是死的。
   后者是因为实现者已经在 mock 里造了 `disputed`。请逐一裁定。
