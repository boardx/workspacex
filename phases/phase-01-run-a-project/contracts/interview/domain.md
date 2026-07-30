# 契约束 `interview` — 领域模型与不变量（支撑材料）

> 洋葱最内层。**不依赖任何外层**：这里出现的东西不知道 HTTP、不知道 S3、不知道 PostgreSQL。
> 覆盖 feature 见 `design-signoff.md` frontmatter 的 `covers:`（**权威**，ADR-023 决策三）。
> 依据 UC：`06-itv/uc-6-0` ~ `uc-6-7` 共八份。
> 裁决引用：O-01（材料保留期 180 天）· O-05（拒绝 AI 分析＝前置检索层过滤）· O-15（两种令牌）
> · O-16（普遍性断言 5 人 / 跨组织聚合 8）· O-33（通知平面单点）· O-36（240 秒 / 2 条每分钟 / 0.45）
> · O-39（PII 五类 + 加密存储掩码展示）· D-13 / D-15（两级 SLA）· D-18 · D-19 · D-25 · D-27 / D-28
> · D-30 / D-38（正式引用只能指向固定快照）。

---

## 一、实体与值对象

### `InterviewSession` 访谈场次（实体）—— 一等对象，**不依赖项目**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `InterviewId` | |
| `orgId` | `OrgId` | 租户隔离键（RLS，属 identity 束） |
| `projectId` | `ProjectId \| null` | **可空**。「不属于任何项目」是一等范围，不是兜底桶（uc-6-0/R3-3） |
| `researchProjectId` | `ResearchProjectId \| null` | **可空**，与 `projectId` 并存 —— 见 [待定 D-1] |
| `sourceKind` | `"human" \| "virtual"` | 真人 / 虚拟（数字人）。phase-1 只展示与隔离，构造归 phase-3 16-persona |
| `status` | 枚举 | `执行 / 完成 / …` —— **[待定 D-2]：取值集合未在任一 UC 穷举** |
| `appliedTemplateVersionId` | `TemplateVersionId \| null` | 套用时**固化的版本号**（I-9 脱钩） |
| `requiredSubjectIds` | `SubjectId[]` | **必需受访者集合**＝主访对象（O-15）；门禁只作用于它 |

> 访谈可**先无项目、后挂载、再解除**（uc-6-0/A3）。挂载是**独立关系**（见 `StepAttachment`），
> 不是把访谈搬进项目；一场可挂多个环节，也可以永不挂载。

### `StepAttachment` 挂载关系（实体）

`{ id, interviewId, projectId, stepId, pinnedVersionId, attachedBy, attachedAt, detachedAt? }`
`pinnedVersionId` 指向 **artifact 束**的 `ArtifactVersion`（D-30 / D-38）。解除挂载**不删除产出**。

### `InterviewTemplate` / `TemplateVersion`（实体）—— 组织级跨项目资产，`projectId` 恒空

模板决定三样，**缺一不可**（uc-6-1/R7 原文）：① 提纲结构 ② 每段时长 ③ **要收集的数据字段**。
`TemplateVersion` 不可变（按 `artifact_versions` 同构管理，SHA-256）。
`usedCount` 是**统计投影**，不是可写字段（I-8）。
`extractedFromInterviewIds: InterviewId[]` —— 反向抽取的来源链（uc-6-1/A3，口径为 [设计]）。

### `Outline` 访谈大纲 / `OutlineSection` 段落（实体）

段落结构**固定两层且顺序不可颠倒**：先 `objective`（要问出什么），后 `openers: string[]`（≥2 条）。
`Outline.status ∈ { draft_ai, pending_confirm, confirmed }`；
`pending_confirm` 是 AI 生成后的默认态（页头「AI 已按目标生成 · 待你确认」），**未确认不得进现场**（I-10）。

### `ResearchPlanParams` 研究计划参数（值对象）

四行承载五个语义（uc-6-2/R3-7）：`suggestedSessions` / `participantsPerSession` +
`sameOrgMax` / `durationMinutes` + `multiPartyDurationMinutes` /
`retentionDays`（**读项目 `材料保留期`，禁止写死**）+ `trainingProhibited`（独立开关）。

> ⚠ **UC 内部自相矛盾**：R3-7 与 AC4 写「**四行**」，而 R12/V4 写「研究计划参数**五项**均可读写」。
> 契约按「四行 / 五语义」建模，**但这需要人类在签核时钉死**（见 `design-signoff.md`）。

### `Subject` 访谈对象（实体）—— **项目侧组卡与访谈侧名单是同一条记录的两个投影**

六列（uc-6-7/R3-2）：`name`（允许匿名代称）/ `roleTitle` / `contact`（**PII**）/ `background` / `mode` / `state`。
访谈侧扩展列：`kind`（成熟用户 / 从未评估…）/ `origin`（行业协会 / 冷启邀约…）/ `language` /
`consentStatus`（**派生自 `ConsentBits`，不另存**，I-19）/ `tags` / `relations`。
`groupId: GroupId | null` —— 未归组的对象**不产生转写回流目标**。

`contact` 是值对象 `ContactInfo { cipher, mask }`：**密文存储、接口默认只返回掩码**（O-39）。

### `ConsentBits` 同意位（值对象）—— 本束的合规核心

四项**彼此独立**、封闭枚举（人类 2026-07-27 拍板）：
`record`（录音）· `transcript`（转成文字稿）· `ai_analysis`（交给 AI 做分析）· `attribution`（报告中署名与职务）。

`ConsentSubmission`（实体）= `{ id, interviewId, subjectId, bits, submittedAt, renderedSnapshotId, tokenId }`。
**只追加不覆盖**：每次变更追加一条新版本（I-16）。

### `ConsentSnapshot` 同意书渲染快照（实体）—— 不可变

提交当时告知了什么（保留期 / 数据控制方 / 联系人 / 合规邮箱四个渲染变量的取值 + 全文）。
项目参数事后变更**不回溯改写**它（I-15）。

### `AccessToken` 两种令牌（实体，O-15）

| 类型 | 有效期 | 一次性 | 用途 |
|---|---|---|---|
| `signing` 签署令牌 | **7 天** | **是**（提交即作废） | UC-6.3 首次授权 |
| `portal` 门户长效令牌 | **＝ 该场材料保留期**（读 O-01，默认 180 天） | 否 | UC-6.6 行使权利 |

两者都可被研究员/合规负责人**单条撤销**；`portal` 可由受访者**自助重发**。
**全仓不得出现「24 小时」作为本束令牌或撤回 SLA 的时限**（I-13、I-17）。

### `WithdrawalRequest` 撤回请求（实体）—— 五步编排

`{ id, subjectId, scope: ConsentKey[], steps: WithdrawalStep[5], receiptId? }`
五步与两级 SLA（D-15）：01 待删除队列 ≤5min · 02 引述退出检索并重算矩阵 ≤5min ·
03 报告段落标「证据已撤回」**不删除** ≤5min · 04 通知拍板人复核（**需人工**）· 05 物理删除并出回执 ≤30 天。

### `OutlineProgress` / `RqCoverage`（实体）—— 现场的人工判定

`RqCoverage.value ∈ { 证据充分, 有信息待追问, 尚未覆盖, 不适用本人 }`（**4 个取值**）。
两者的 `writerOrigin` **恒为 `human`**（I-11）。

> ⚠ **UC 内部自相矛盾（第二处）**：uc-6-4/R3-7 明写「4 个取值」并把「是否存在第 5 个取值」标为 [待确认]，
> 而同一份 UC 的 R8 写「**五态**必须都能选」，`feature_list.json` 的 F92 标题也写「RQ **五态**覆盖度」。
> 本契约按 **4 值 + 封闭性待裁决**建模。**签核必须钉死这一条**——它是 UC-6.5 证据矩阵「未提及」语义的输入。

### `CopilotSuggestion` AI 建议（实体）

`category ∈ { 追问, 观察员, 澄清, 反例 }`（另有 `覆盖` 提示，形态与前四类不同 —— [待定 D-3]：
它是第五类还是独立对象，UC 两处措辞不一）。
必带 `reason` + `sourceSegmentId` + `sourceTimecode`；可选 `rqBinding` / `priority`。
`origin ∈ { ai, human_observer }` —— 观察员私密建议走同一栏但**必须视觉可分**。
四出口 `outcome ∈ { used, edited_used, later, ignored }`，`used/edited_used` 计为已采纳。

### `Quote` 引述 / `Theme` 主题 / `EvidenceCell` 证据矩阵格（实体）

`EvidenceCell.strength ∈ { 强, 弱, 未提及, 附和, 反例 }`（**封闭五取值**）。
`附和` 不计入强度合计；`反例` 不可被合并/权重调整抹掉。
矩阵头部必须同时给 `sessionCount`（N 场）与 `subjectCount`（M 位）—— **场次数 ≠ 人数**。

### `Insight` 候选洞察 / 洞察库条目（实体）

`origin: "ai" | "human"`、`evidenceRefs: QuoteRef[]`（**缺来源不可确认**）、
`sourceKind: "human" | "virtual"`、`isStrong: boolean`、`contextPackId`。

---

## 二、不变量

> 判据：**任何时刻都为真，违反即数据损坏。** 写不成断言的规则赶到 `usecases.md` 的前置条件里。
> 🔗 = **跨束不变量**，不能在本束单独实现，须提到阶段一致性复核。

| # | 不变量 | 怎么断言 |
|---|---|---|
| **I-1** | 同意位的写入者**恒为受访者本人的令牌主体**；系统中不存在任何以员工身份写他人 `ConsentBits` 的路径 | 枚举本束全部写路由，断言无一可改他人同意位；以研究员身份直接构造请求返回 `CONSENT_STAFF_READONLY`（uc-6-3/V4） |
| **I-2** | `ConsentKey` 是**封闭枚举** `{record, transcript, ai_analysis, attribution}`，新增须走 ADR | 断言成员集合与 `packages/contracts/src/interview.ts` 一致，且未声明值被 zod 拒绝。⚠ **断言集合不断言长度**（`toHaveLength` 会拦下经评审的正当新增） |
| **I-3** | 在必需受访者集合的提交齐备之前，该场**不存在任何音频对象与 `transcript_segment` 行** | 未提交时调 `startSession` 得 `CONSENT_REQUIRED`；扫该场对象存储与 segments 表，断言 0 条（uc-6-3/V2） |
| **I-4** | `ai_analysis = false` 的受访者，其 `segmentId` **不出现在任何 `context_packs` 快照的 items 中** | 对该场每一次 AI 调用取其 Pack 快照，断言不含该 `segmentId`；把同意位改为 true 后重跑，其片段方出现（证明是**前置过滤**而非出口遮盖，O-05 / V6 / V8） |
| **I-5** | 每条 `CopilotSuggestion` 都有非空 `sourceSegmentId` + `sourceTimecode`；无来源的建议**不得落库** | 构造无来源的生成结果，断言写入被拒（uc-6-4/V4） |
| **I-6** | 提纲完成态与 RQ 覆盖态的 `writerOrigin` **恒为 `human`** | 以 `origin: ai` 主体调这两个写接口一律被拒；同接口由研究员调用成功（uc-6-4/V2） |
| **I-7** | `RqCoverage.value` 属封闭 4 值集合 | 集合断言 + 未声明值被拒。⚠ **[待定]**：是否存在第 5 个取值须人类裁决（见上文矛盾） |
| **I-8** | 模板的 `usedCount` 是**统计投影**：等于其全部版本被套用的次数，且**不存在写它的接口** | 连套 3 次断言递增 3；直接写该字段的请求被拒（uc-6-1/V2） |
| **I-9** | 套用即脱钩：`session.appliedTemplateVersionId` 一经写入不变；改模板不追改已建访谈，改访谈不回写模板 | 套用后改模板 → 断言 session 内容不变；改 session → 断言模板不变；来源引用仍在（uc-6-1/V4） |
| **I-10** | `Outline.status ≠ confirmed` 时**该场不能进入现场**（服务端） | 以 `pending_confirm` 调 `startSession` 得 `OUTLINE_NOT_CONFIRMED`；确认后放行（uc-6-2/V5） |
| **I-11** | 每个 `OutlineSection` 的 `objective` 非空且 `openers.length ≥ 2`，且**序列化结构中 `objective` 在 `openers` 之前** | 结构断言 + 字段顺序断言；缺项数 = 质量提示计数（uc-6-2/V1） |
| **I-12** | `ResearchPlanParams.retentionDays` 恒等于该项目生效的 `材料保留期`；**代码库中不存在写死的保留天数常量** | 全仓 grep 断言无 `180` 之类字面量用于保留期；改项目参数后重读断言随动（uc-6-2/V4 · O-01） |
| **I-13** | `signing` 令牌：`expiresAt = issuedAt + 7d` 且 `usedAt` 一经写入即失效（**一次性**）；`portal` 令牌：`expiresAt = 材料保留期届满时刻` | 第 8 天访问被拒；用过一次再用被拒；把时钟推到第 179 天 portal 仍可用、届满后被拒（O-15 / V8 / V9b） |
| **I-14** | 令牌只映射**其本人的数据切片**：越出切片的读写一律服务端拒绝并写安全审计 | 用该令牌读他人数据 / 读提纲 / 读 AI 建议 / 写洞察，全部被拒并有审计行（uc-6-6/V8） |
| **I-15** | `ConsentSnapshot` **不可变**：项目参数变更不改写已提交的快照 | 改 `材料保留期` 后重读门户，断言展示的快照字节一致；新发出的授权页文案已变（uc-6-6/V5） |
| **I-16** | `ConsentSubmission` **append-only**：变更追加新版本，无 UPDATE / DELETE | 断言 UPDATE/DELETE 被拒；行数单调不减；历史版本可查（uc-6-6/R7） |
| **I-17** | 撤回后：①②③ 步在 **≤5 分钟**内完成；⑤ 在 **≤30 天**内完成并出回执；**全仓不存在「24 小时」这一时限** | 计时断言三步 SLA；grep 断言配置与文案无 24h 口径（D-15 / V7 / V2） |
| 🔗 **I-18** | 撤回后：其 embedding 不可召回、新建 Context Pack 不含其 `segmentId`、OCR/摘要/图边（`ontology_edges` / `claim_evidence`）一并失效、以其为唯一证据的 Claim 转 `contested`、缓存不再命中；**历史 `context_packs` 快照仍在但标注「来源已失效」** | 六条逐条断言（uc-6-3/V7b · uc-6-6/V13）。**跨束**：context-pack + artifact + 22-files + 17-gov |
| 🔗 **I-19** | 撤回第 05 步后，该受访者的音频与 `transcript.jsonl` 对应版本在 **22-files 文件浏览器中不可见、不可下载** | 以有权账号在文件浏览器请求，断言 404 / 不可下载。**跨束**：22-files（file-first 的删除语义） |
| **I-20** | `Subject.consentStatus` 是 `ConsentBits` 的**派生投影**，磁盘上不存在第二份同意书状态 | 改访谈侧同意位 → 断言项目侧组卡状态同步变化；查表结构断言无第二列/第二表（uc-6-7/V5） |
| **I-21** | `ContactInfo` 密文存储；任何接口默认返回 `mask`；**以 agent 身份请求明文一律被拒** | 查库断言密文；无权限取明文被拒且写审计；有权限取明文**也写审计**；agent 主体一律拒（uc-6-7/V7 · O-39） |
| **I-22** | 批量导出结果**不含联系方式列** | 导出后解析文件断言无该列（uc-6-7/V7） |
| **I-23** | `[AI 建议人选]` 的结果落**候选态**：未经人确认**不产生对象表行**，且候选中**不含联系方式明文** | 调用后断言表行数不变、候选带机器角标与理由来源；确认后才写入（uc-6-7/V3 · D-27） |
| **I-24** | AI 预约**不产生任何外发调用**：只生成草稿；外发只能由人触发且写审计 | 触发「按表预约」后断言外发适配器零调用；人点发送后才有一次调用（uc-6-7/V4 · D-28 外发邮件恒 R3） |
| **I-25** | 存在上下级关系的两个对象**默认不在同一场次**，并标 `已拆场`；强行同场须二次确认并留痕 | 构造上下级后排场，断言默认拆场；强行同场断言有确认记录与审计行（uc-6-3/V9 · uc-6-7/V6） |
| **I-26** | `EvidenceCell.strength` 属封闭五值；`附和` 不计入主题强度合计；某主题 `反例` 数为 1 时，任何合并/权重调整后仍 ≥1 | 集合断言；构造 `附和` 断言合计不含它；构造唯一 `反例` 断言合并被阻断（uc-6-5/V4） |
| **I-27** | 「普遍性断言」的放行条件 = **独立受访者数 ≥ 5**；计数口径 = `distinct(subjectId)`，同一人多条只算 1，`附和` 与 `sourceKind=virtual` 不计入 | 4 位时被阻断并回报实际人数 4；补到 5 位放行；同一人 3 条强引述断言仍算 1（O-16 / V7） |
| **I-28** | `sourceKind = virtual` 的结论**不能被标为强洞察、不能进入决策引用**（接口层拒绝，非按钮置灰） | 两个接口各调一次断言返回拒绝；统计接口返回 `真人 N 位` 与 `虚拟 M 条` 两个独立字段（D-25 / V3） |
| **I-29** | 每条洞察至少挂 1 条 `evidenceRefs`，且每条证据可经 anchor 一路定位到 `transcript.jsonl` 与原音频时间码 | 缺来源的候选断言不可确认；抽样断言 100% 可定位（uc-6-5/V1 / V15 · O-35 结构性断言） |
| 🔗 **I-30** | 正式引用（挂到项目环节 / 加入决策依据 / 报告正式版）**只能指向固定快照**（`pinned` 版本） | 断言 live/draft 引用被拒 `REQUIRES_PINNED`（D-30 / D-38）。**跨束**：artifact 束 I-14 是同一条 |
| **I-31** | `projectId IS NULL` 的访谈可见性 = **创建者 + 显式协作者**，**不因无项目而全组织可见** | 以非协作者身份按 ID 直读断言被拒并写审计；列表接口响应体**不含**越权数据（抓包断言，uc-6-0/V2） |
| 🔗 **I-32** | 每场访谈在对象存储中有三类文件：音频 + `transcript.jsonl` + `notes.md`，且可在 22-files 该项目目录下可见可下载；转写稿 `derivedFrom` 指向原音频版本，原音频 SHA-256 未变 | HEAD 三个对象断言 size>0；断言 `derivedFrom` 有效且原件哈希不变（uc-6-4/V13）。**跨束**：artifact + 22-files |
| 🔗 **I-33** | 本束一切 AI 消费**只经 Context API 取 Context Pack**；代码路径中不存在对 `segments` / 向量库 / 对象存储的直连查询 | 静态检查断言无直连；每条建议/洞察可回放其 `context_packs` 记录（uc-6-4/V14 · uc-6-5/V14）。**跨束**：context-pack |
| **I-34** | `向受访者展示 AI 建议` 关闭时，受访者端接口**响应体中不含任何建议字段**（服务端不下发，非前端隐藏） | 以受访者令牌调该场任意读接口，断言响应体无建议字段；打开开关后才出现（uc-6-3/V10 · uc-6-4/V3） |

### 为什么 I-3 与 I-4 是两条

I-3 是**采集门**（没授权就不该有数据）；I-4 是**输入门**（有数据但不能进模型）。
只做 I-3 不做 I-4：`record=是 / ai_analysis=否` 的受访者会被正常录音转写，
然后**片段照样喂进副驾驶**——这正是原型同屏「Weber 不参与 AI 分析 + 追问卡来源 Weber」的错误（O-05 已判定为原型自身错误）。
只做 I-4 不做 I-3：未授权者被录了音，事后再过滤已无意义。

### 为什么 I-18 / I-19 不能只在本束实现

撤回链跨 **artifact（快照）· context-pack（召回与 Pack）· 22-files（文件层删除）· 10-report（段落标失效）·
17-gov（审计与回执）· 决策台账（拍板人）** 六处。每一环都必须有人接，缺一即「撤回未完成」。
**本仓已有一次「撤回链 SLA 声明在两处」的漂移**（`lib/withdrawal-flow.ts` 是那次的收敛结果）——
本束**不再声明第二份 SLA 数字**，只引用单源。

---

## 三、这个域不负责什么

- **权限判定本身**：两层交集鉴权与 RLS 属 `identity` 束（phase-00）。本束用例的前置条件只写「调用者在该场有 X 权限」。
- **转写与说话人指派的实现**：UC-5.1 / 5.2 / 5.3 属 `05-rec` 束。本束只消费其 Segment 与引述锚点，
  并规定「未授权不采集」「AI 分析＝否不进 Pack」两道门。
- **Context Pack 的装配算法与 `omissions` 结构**：属 `context-pack` 束（phase-00）。
  本束只提供**过滤输入**（同意位 + 撤回状态）并要求 `omissions` 记录被过滤的来源类别与条数（不泄露内容）。
- **虚拟人的构造**（专家设定 / 提问与推演 / 采纳与标注）：**phase-3 的 16-persona**。本束只消费其结论并执行隔离。
- **报告工作台与决策台账**：10-report / 13-deliv（phase-2）。本束只定义「标失效不删除」「通知拍板人复核」两条约束。
- **通知平面的具体形态**：O-33 单点定义在 `.harness/instructions/` 的通知规范，本束只引用，**不重复定义**。

---

## 四、[待定 —— 需人类裁决] 清单

| # | 缺什么 | 为什么本束定不了 |
|---|---|---|
| **D-1** | 一场访谈能否**同时**归属研究项目与业务项目（一个外键还是两个） | uc-6-0/R10 明列为 [待确认]；原型两处措辞不一（范围显示「研究项目·采购决策如何形成」，行内所属显示「欧洲进入策略」） |
| **D-2** | `InterviewSession.status` 的**完整取值集合** | 原型只给了 `执行 / 完成`；封闭性无人裁决 ⇒ 无法写 I-* 的集合断言 |
| **D-3** | AI 建议的 `覆盖` 提示是**第五类**还是独立对象 | uc-6-4 R3-6 写「另有一条【覆盖】提示」、R8 写「四类，另加【覆盖】」——形态不一致 |
| **D-4** | `RqCoverage` 是否存在**第 5 个取值** | uc-6-4/R3-7 自标 [待确认]；而 R8 与 F92 标题写「五态」。**两者不能同时为真** |
| **D-5** | 研究计划参数是**四行还是五项** | uc-6-2 R3-7/AC4 写四行，V4 写五项 |
| **D-6** | 质量提示（`N 段还需你改问法`）**是否阻断进入现场** | uc-6-2/R10 明列 [待确认]。与 I-10（未确认草案不得进现场）是两条不同的闸，别混 |
| **D-7** | 「某物流园区运营总监」这类**去标识化角色描述的生成规则**：由谁写、能否被受访者核对、跨报告是否一致 | uc-6-3/R10 [待确认]。它是 `attribution=false` 时的**唯一**替代口径，缺规则即无法验收 |
| **D-8** | 文字稿副本的**交付方式与时限**；**本人 PII 是否对本人解遮盖**；**删除请求的范围**（仅本场 vs 组织内本人全部记录） | uc-6-6/R10 三条 [待确认]，全部属合规输入 |
| **D-9** | 「不会删掉」的**法定留存清单**（O-39 的外部合规输入） | 删除确认页必须诚实列出「不会删什么」，清单不给就写不出这一屏 |
| **D-10** | 从众风险的**自动识别口径**：关系图 + 发言先后即可判定，还是必须人工确认 | uc-6-5/R10 [待确认]。它决定 `附和` 是系统写还是人写 —— 而 I-6 只约束了提纲与 RQ 两处 |
| **D-11** | `[调整证据权重]` 的**权重语义与取值范围** | uc-6-5/R10 [待确认]。权重能否把 `强` 压成 `弱` 直接影响 I-26 与 I-27 的计数 |
| **D-12** | 对象能否**跨组 / 跨项目复用**，以及此时转写回流到哪个组 | uc-6-7/A3 [待确认]。它决定 I-20 的投影是 1:1 还是 1:N |
| **D-13** | 对象**放弃受访后联系方式的清除时点** | uc-6-7/E3 [待确认] |
| **D-14** | `[AI 建议人选]` **能否检索组织外部来源**（原型有 `行业协会 / 冷启邀约`） | 若可，须受 21-mcp 授权范围约束 —— 那是**另一个束**的门 |
| **D-15** | 「材料不足」的最小量（建议 ≥3 场访谈 或 ≥20 条引述） | O-35 明写**需研究方法负责人给出**；缺它则 uc-6-5 的「不得伪造结论」只有定性没有判据 |
