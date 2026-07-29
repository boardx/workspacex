# 契约束 `interview` — UC 覆盖证明（支撑材料）

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，只要有一条 UC 的验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature：F80 F81 F82 F83 F84 F85 F86 F87 F88 F89 F90 F91 F92 F93 F94 F95 F96 F97 F98 F99（68 点）
> ⚠ **上面这一行是派生视图，不是权威。** 权威是 `design-signoff.md` frontmatter 的 `covers:`（ADR-023 决策三）。
> 改覆盖范围改那里，**不要**只改这一行。
>
> 依据 UC：`06-itv/uc-6-0` ~ `uc-6-7` 共 **8 份**，R12 验收线索合计 **107 条**（含 2 条 `Vnb` 变体）。
> 本表 **105 行** —— uc-6-4 的 `V13` / `V14` 各出现两次且语义不同，按编号合并成一行（见第五节的缺陷说明）。

## 怎么读这张表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**里的真实 `data-testid` 或路由；填不出来的标
`—（API 层验收）` 或指向 `ui.md` 的缺口编号，**但不能空着**。
已建成的只有两处：`/studio/interview`（现场主屏）与 `/consent`（受访者同意书）。屏的清单见 `ui.md`。

---

## 零、⚠ 先看这条：门控对本束的 5 份 UC 实际上是**空转**的

`verify-uc-coverage.ts` 用 `^-\s*(V\d+)` 从 R12 抓验收线索。本束八份 UC 里：

| UC | R12 行的写法 | 门控抓到 | 实际有 |
|---|---|---:|---:|
| uc-6-1 / uc-6-2 / uc-6-5 | `- V1（成功态…` | 10 / 12 / 16 | 10 / 12 / 16 |
| **uc-6-0 / uc-6-3 / uc-6-4 / uc-6-6 / uc-6-7** | `- **V1（成功态…`（**加粗**） | **0** | 9 / 16 / 16 / 14 / 14 |

**这五份 UC 的 R12 章节写法完全正常、编号齐全**——是**门控的正则不认加粗**，
于是它对这五份 UC 报「R12 共 0 条」，coverage 表里**一条不写也照样绿**。
本束 107 条验收线索中的 **69 条（64%）当前不受任何机械保护**。

⚠ 讽刺的是，同一个脚本在**读表格**时专门加了容忍加粗的分支
（`/^\|\s*\*{0,2}(V\d+)\*{0,2}\s*\|/`，注释写着「本脚本第二版就因此误报 web-kernel 漏 10 条」），
**却没给读 UC 的那一侧加同样的容忍**。同一个排版问题，一侧修了一侧没修。

**这是门控缺陷，不是 UC 缺陷。** 本文件把 107 条**全部**列进表里；
修门控正则（`^-\s*\*{0,2}(V\d+)`）是一个独立的 harness 修复，不属本束 feature 范围。
在它被修好之前，**本表的完整性靠人签核，不靠脚本**。

⚠ 另有两处 **UC 自身的编号缺陷**（不是门控问题），已在下文对应小节标出：
uc-6-4 的 `V13` / `V14` **各出现两次且语义不同**；uc-6-5 与 uc-6-6 的编号顺序被架构态条目打乱。

---

## 一、uc-6-0 R12（9 条 · 访谈 Studio 列表与范围）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：在某项目与「不属于任何项目」之间切换，两次集合不相交且计数可复现 | `listInterviews`（scope 三形态） | ⚠ 屏未建（ui.md U-1 范围切换器） | ⚠ 缺口 U-1 |
| V2 | AC2：非协作者按 ID 直读无项目访谈被拒并写审计；列表不返回再前端过滤 | `getInterview` → `NO_INTERVIEW_ACCESS`；`listInterviews` 服务端过滤 | —（API 层验收 + 抓包断言） | ✅ 见 domain I-31 |
| V3 | AC3：`[＋ 新建访谈]` 三步走完，范围默认继承切换器取值且可在向导内改 | `createInterviewFromWizard` | ⚠ 屏未建（ui.md U-3 三步向导） | ⚠ 缺口 U-3 |
| V4 | AC4：挂到项目环节后成员可见；解除后回到无项目且产出仍在；正式引用指向固定快照 ID | `attachToProjectStep` / `detachFromProjectStep` → `REQUIRES_PINNED` | ⚠ 屏未建（ui.md U-1 详情底栏） | ⚠ 缺口 U-1 · 跨束 X-1 |
| V5 | AC5：虚拟条目带强标记；统计接口返回真人与虚拟两个独立计数 | `listInterviews` → `counts.human` / `counts.virtual` | ⚠ 屏未建（ui.md U-1 列表行徽标） | ⚠ 缺口 U-1 |
| V6 | 权限态：六种角色遍历；重点断言项目负责人读不到他项目与他人无项目访谈 | `getInterview` / `listInterviews` 的角色矩阵 | `/studio/interview` `itv-view-switcher` 与 `itv-view-observer`（预览手段，非权限） | ⚠ 缺口 G-2 |
| V7 | 空态：区分「本范围无访谈」与「无权查看本范围」两种文案，不生成示例访谈 | `listInterviews` → `[]` 与 `SCOPE_NOT_VISIBLE` 两种结果 | ⚠ 屏未建（ui.md U-1 空态） | ⚠ 缺口 U-1 |
| V8 | 依赖失败：列表接口失败时保留当前范围与筛选，错误可解释可重试 | `listInterviews` → `DEPENDENCY_UNAVAILABLE` | `/studio/interview` `?state=dep-failed`（七态壳已建） | ✅ 壳已建 |
| V9 | 审计态：范围切换不写审计；挂载/解除/跨项目读取写审计；管理员访问对项目负责人可见 | `attachToProjectStep` / `detachFromProjectStep` / `getInterview` → `AuditWriter` | ⚠ 屏未建（审计查询面属 17-gov） | ⚠ 跨束 X-4（D-18） |

## 二、uc-6-1 R12（10 条 · 新建访谈模板）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：套用模板后新访谈带上分段、每段时长、要收集的数据字段三样且与模板一致 | `applyTemplate` → `sections` + `dataFields` | ⚠ 屏未建（ui.md U-2 模板库） | ⚠ 缺口 U-2 |
| V2 | AC2：连套 3 次 `用过 N 次` 递增 3；直接写该字段的接口被拒 | `listTemplates` 的统计投影；写请求 → `TEMPLATE_STAT_READONLY` | ⚠ 屏未建（ui.md U-2 列表行） | ✅ 见 domain I-8 |
| V3 | AC3：从 3 场已办访谈抽取的结果是草案、需确认才入库、入库后可列出来源 | `extractTemplateDraft` / `confirmTemplateDraft` | ⚠ 屏未建（ui.md U-2 抽取草案确认屏） | ⚠ 缺口 U-2 · 口径 C-1 |
| V4 | AC4：套用后改模板已建访谈不变；改访谈模板不变；两者仍保留来源引用 | `updateTemplate`（新版本）+ `session.appliedTemplateVersionId` 固化 | ⚠ 屏未建（ui.md U-2 溯源链） | ✅ 见 domain I-9 |
| V5 | 校验失败态：写入诱导性问法时助手指出并给修改建议 | `checkQuestionQuality` → `findings` | ⚠ 屏未建（ui.md U-2 编辑器质量提示） | ⚠ 口径 C-2（诱导只在问卷侧命中） |
| V6 | 权限态：研究员/引导师/组长/受访者/观察者/未授权者遍历，严格符合 R5 | `listTemplates` / `updateTemplate` 的角色矩阵 | `/studio/interview` `itv-view-switcher`（预览手段） | ⚠ 缺口 G-2 · 待定 D-16 |
| V7 | 空态：模板库为空显示真实空态与两个出口，不预置示例模板 | `listTemplates` → `[]` | ⚠ 屏未建（ui.md U-2 空态） | ⚠ 缺口 U-2 |
| V8 | 依赖失败：AI 推演分段不可用时仍可手工建模板，错误可解释可重试 | `createTemplate` 不依赖 AI；`AI_GENERATION_UNAVAILABLE` 只降级 | `/studio/interview` `?state=dep-failed`（七态壳） | ✅ 壳已建 |
| V9 | 并发态：两人改同一模板不静默覆盖且可识别最终版本 | `updateTemplate` → `TEMPLATE_VERSION_CHANGED` | ⚠ 屏未建（ui.md U-2 冲突提示） | ⚠ 缺口 U-2 |
| V10 | 审计态：模板创建/编辑/抽取确认/套用可按操作者时间对象结果检索；越权也有安全审计 | 上述四用例 → `AuditWriter` | ⚠ 审计查询面属 17-gov | ⚠ 跨束 X-4 |

## 三、uc-6-2 R12（12 条 · 研究设计：上下文与大纲）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：每段有非空「要问出什么」与 ≥2 条开场问法，且序列化中目标字段在问法之前 | `updateOutlineSection` → `OUTLINE_INCOMPLETE`；结构与字段顺序断言 | ⚠ 屏未建（ui.md U-4 大纲编辑器） | ✅ 见 domain I-11 |
| V2 | AC2：走完三步向导，生成的大纲含模板分段与数据字段、含对象背景，且每项可编辑保存 | `createInterviewFromWizard` + `generateOutline` + `updateOutlineSection` | ⚠ 屏未建（ui.md U-3 + U-4） | ⚠ 缺口 U-3 U-4 |
| V3 | AC3：页面返回体含两条方法论声明原文 | `getInterview` → `methodologyNotes[2]`（原文属契约） | ⚠ 屏未建（ui.md U-4 常驻要点） | ⚠ 缺口 U-4 |
| V4 | AC4：研究计划参数可读写；`数据保留` 等于项目材料保留期；全仓无写死天数；训练开关可被下游读取 | `readResearchPlanParams` / `updateResearchPlanParams` | `/studio/interview` `itv-retention`（保留期展示已建） | ⚠ 待定 D-5（四行 vs 五项） |
| V5 | AC5：AI 生成后状态为 `待确认`，以此状态调「进入现场」被拒；确认后放行；重新生成对手改段落二次确认 | `startSession` → `OUTLINE_NOT_CONFIRMED`；`regenerateOutline` → `OUTLINE_OVERWRITE_NEEDS_CONFIRM` | ⚠ 屏未建（ui.md U-4 页头闸门） | ✅ 见 domain I-10 |
| V6 | E1：写入照抄研究问题的问法时给出经历型改写示例 | `checkQuestionQuality`（kind=outline） | ⚠ 屏未建（ui.md U-4） | ⚠ 缺口 U-4 |
| V7 | E6：合计时长超参数时提示压缩，且提示引用的是参数值而非写死的 60 | `updateOutlineSection` → `DURATION_EXCEEDS_PLAN`（detail 带参数值） | ⚠ 屏未建（ui.md U-4 合计时长） | ✅ 见 domain I-12 |
| V8 | 权限态：六种角色遍历，严格符合 R5 | 本组用例的角色矩阵 | `/studio/interview` `itv-view-switcher`（预览手段） | ⚠ 缺口 G-2 |
| V9 | 空态：无模板或无对象时向导各步显示真实空态与创建入口，不生成示例大纲 | `listTemplates` / `listSubjects` → `[]` | ⚠ 屏未建（ui.md U-3 空态） | ⚠ 缺口 U-3 |
| V10 | 依赖失败：AI 生成不可用时保留上一版大纲并可手工编辑 | `generateOutline` → `AI_GENERATION_UNAVAILABLE`（不清空） | `/studio/interview` `?state=dep-failed`（七态壳） | ✅ 壳已建 |
| V11 | 并发态：两名研究员同时改同一段大纲不静默覆盖且可识别最终版本 | `updateOutlineSection` → `CONCURRENT_MODIFICATION` | ⚠ 屏未建（ui.md U-4） | ⚠ 缺口 U-4 |
| V12 | 审计态：大纲确认、重新生成、研究计划参数变更（尤其训练开关）可检索 | `confirmOutline` / `regenerateOutline` / `updateResearchPlanParams` → `AuditWriter` | ⚠ 审计查询面属 17-gov | ⚠ 跨束 X-4 |

## 四、uc-6-3 R12（16 条 · 受访者授权）

> ⚠ 本节的 16 条**门控当前一条都不要求**（见第零节）。

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：受访者提交后现场页顶部显示 `授权 3/4 · <姓名> 不参与 AI 分析` | `submitConsent` → `getStageState.auth` | `/studio/interview` `itv-auth-badge` `itv-auth-count` `itv-auth-panel` | ⚠ 口径 C-3（四项拆法不一致） |
| V2 | AC2：未提交时 `[开始访谈]` 禁用**且**直接调开始录制/转写接口被拒；提交后两者均放行 | `startSession` → `CONSENT_REQUIRED` | ⚠ 屏未建（现场主屏无 `[开始访谈]` 门禁控件） | ✅ 见 domain I-3 |
| V3 | AC3：授权页渲染四项原型措辞；取消 AI 分析与署名各自当场出现降级文案 | `getConsentPage` → `items[4]` 文案属契约 | `/consent` `consent-body` `consent-item-*` `consent-check-*` | ⚠ 口径 C-3（现有只有 3 项且缺 AI 分析项） |
| V4 | AC4：以研究员身份枚举全部写接口，不存在可改他人同意位的入口；界面无勾选控件 | `getConsentMirror`（只读）；构造写请求 → `CONSENT_STAFF_READONLY` | ⚠ 屏未建（ui.md U-6 只读镜像） | ✅ 见 domain I-1 |
| V5 | AC5：授权页含数据控制方、联系人、合规邮箱三项且随项目参数变化；缺任一项发链接被拒 | `getConsentPage.controller`；`issueSigningToken` → `RETENTION_PARAMS_MISSING` | `/consent` `consent-controller` | ⚠ 占位值（合规邮箱是编的，S-18） |
| V6 | AC6 · O-05：AI 分析＝否时人工抽引述允许、归纳跳过、副驾驶取不到、绕过前端也被拒、改回是后重跑才出现 | `extractQuotes`（允许）+ `buildInterviewContextPack`（前置过滤）+ `generateCandidateInsights` | ⚠ 屏未建（矩阵与候选区，ui.md U-8） | ✅ 见 domain I-4 |
| V7 | AC7 · D-15：撤回五步的 SLA 逐条断言，且全流程不存在「24 小时」这一时限 | `requestWithdrawal` → `steps[5]`；`getWithdrawalStatus` | `/consent` `consent-withdraw-flow` `consent-withdraw-step-*` | ⚠ 待合规确认 SLA（S-05） |
| V7b | 级联失效：embedding 不可召回、图边与摘要失效、唯一证据 Claim 转 contested、缓存不命中、文件层真消失、历史快照标注失效 | `WithdrawalOrchestrator` 的六条级联断言 | `/studio/interview` `itv-withdrawal-impact` `itv-withdrawal-quotes` `itv-withdrawal-decision` | ⚠ 跨束 X-2（六条各在别束） |
| V8 | AC8 · O-15：签署令牌第 8 天被拒且一次性；门户长效令牌有效期＝材料保留期；可自助重发；可单条撤销；不存在 24 小时单令牌 | `issueSigningToken` / `submitConsent` 签发 portal / `revokeToken` / `resendPortalToken` | ⚠ 屏未建（ui.md U-9 门户） | ✅ 见 domain I-13 |
| V9 | AC9：同意书三态与实际同意位一致；上下级默认拆场标 `已拆场`，强行同场二次确认并写审计 | `getConsentMirror.consentStatus`（派生）；`checkSplitSession` → `SPLIT_SESSION_REQUIRED` | ⚠ 屏未建（ui.md U-6 名单表） | ✅ 见 domain I-20 I-25 |
| V10 | AC10：`向受访者展示 AI 建议` 关闭时受访者端响应体不含任何 AI 建议字段 | `listCopilotSuggestions` → `SUGGESTION_NOT_FOR_SUBJECT`（服务端不下发） | `/studio/interview` `?view=interviewee` 下 `itv-copilot` 不渲染 | ✅ 见 domain I-34 |
| V11 | 权限态：受访者、研究员、联合主持、观察员、观察者、项目负责人、未登录、失效令牌遍历 | 本组全部用例的角色矩阵 | `/studio/interview` `itv-view-*` `itv-readonly-banner` | ⚠ 缺口 G-2 |
| V12 | 空态：无受访者时显示真实空态与「添加参与者」下一步，不生成示例数据 | `listSubjects` → `[]` | ⚠ 屏未建（ui.md U-6 空态） | ⚠ 缺口 U-6 |
| V13 | 依赖失败：受访者提交写入失败时页面显示失败并保留选择，系统中不产生任何已授权记录 | `submitConsent` → `CONSENT_WRITE_FAILED` | `/consent` `?state=dep-failed`（七态壳，未接真实失败） | ⚠ 缺口 U-5 |
| V14 | 并发态：受访者改选择与研究员刷新镜像并发时不静默覆盖，以受访者最后一次提交为准 | `submitConsent` → `CONSENT_VERSION_CONFLICT` | ⚠ 屏未建（ui.md U-6 镜像刷新） | ⚠ 缺口 U-6 |
| V15 | 审计态：授权提交、撤回、令牌签发与撤销、强行同场、七开关变更均可检索；管理员读取对项目负责人可见 | 上述用例 → `AuditWriter`（D-18） | ⚠ 审计查询面属 17-gov | ⚠ 跨束 X-4 |

## 五、uc-6-4 R12（14 个编号 · 现场记录与 AI 副驾驶）

> ⚠ **UC 自身的编号缺陷**：`V13` 与 `V14` **各出现两次且语义不同**——
> 一处是架构态（file-first / Context API），一处是并发态 / 审计态。
> 下表按编号合并成一行并**同时列出两种语义**；请人类在签核时决定是否给架构态重新编号。

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：点 `[结束并转写]` 后结束页立刻返回 5 个 RQ 的覆盖态且取值在枚举内 | `endAndTranscribe` → `coverageSummary` | `/studio/interview` `itv-coverage-summary` | ⚠ 待定 D-4（4 值 vs 五态） |
| V2 | AC2：以 agent 身份调「设置提纲完成」与「设置 RQ 覆盖态」均被服务端拒绝；研究员调用成功 | `setOutlineSectionStatus` / `setRqCoverage` → `AI_WRITE_FORBIDDEN` | `/studio/interview` `itv-outline`（左栏已建） | ✅ 见 domain I-6 |
| V3 | AC3：七开关关闭时以受访者令牌调任意读接口响应中不含建议字段；打开后才出现 | `listCopilotSuggestions` → `SUGGESTION_NOT_FOR_SUBJECT` | `/studio/interview` `?view=interviewee` 无 `itv-copilot` | ✅ 见 domain I-34 |
| V4 | AC4：每条建议含类别、理由、来源时间码、可选 RQ 绑定与优先级；四出口各生效；无来源被拒落库 | `listCopilotSuggestions` / `actOnSuggestion` → `SUGGESTION_NO_SOURCE` | `/studio/interview` `itv-copilot` `itv-followups` `itv-followups-denied` | ⚠ 缺口 U-7（四出口未建全） |
| V5 | AC5：注入「连续发言超阈值 + 他人举手未答」触发私下提醒且含两项事实；受访者端与广播无该提醒；只超时长不触发 | `evaluateSpeakingBalance` / `inviteSpeaker` | ⚠ 屏未建（ui.md U-7 私下提醒块） | ⚠ 缺口 U-7 |
| V6 | AC6：状态条显示 `授权 3/4` 与「不参与 AI 分析」；把授权撤到未提交后该人不产生转写段 | `getStageState.auth`；`requestWithdrawal` 联动 | `/studio/interview` `itv-auth-badge` `itv-tracks` `itv-track-*` | ⚠ 口径 C-3 |
| V7 | AC7：逐字稿五种状态标注可分别断言；低置信与重叠两类之和等于状态条的 `逐字稿校对 N` | `getStageState` → `roster` 与 segment 标注；05-rec 提供 | `/studio/interview` `itv-seg-*` `itv-overlap-*` `itv-dispute-*` `itv-quote-*` | ⚠ 跨束 X-3（05-rec） |
| V8 | O-05 联合：Pack 快照不含其 segmentId、右栏无其来源建议、下游 AI 产物同样不含、改回是后重跑才出现 | `buildInterviewContextPack`（per-speaker 前置过滤） | ⚠ 屏未建（Pack 回放屏属 context-pack 束） | ✅ 见 domain I-4 |
| V9 | 权限态：主持人、联合主持、观察员、记录 agent、受访者令牌、项目负责人、未授权者遍历 | 本组用例的角色矩阵 | `/studio/interview` `itv-view-*` `itv-readonly-banner` | ⚠ 缺口 G-2 |
| V10 | 空态：新开一场尚无发言时三栏各显示真实空态，不生成示例建议或假逐字稿 | `getStageState` → 空集合 | `/studio/interview` `?state=empty`（七态壳已建） | ✅ 壳已建 |
| V11 | E9：停掉副驾驶后转录、提纲勾选、标引述、覆盖度全部仍可用，右栏显示「建议暂不可用」 | `listCopilotSuggestions` → `COPILOT_UNAVAILABLE`（其余用例不受影响） | `/studio/interview` `itv-copilot` 的 dep-failed 分支 | ⚠ 缺口 U-7 |
| V12 | E8：制造一次转写失败，状态条 `转写处理 1 失败` 出现、可重试、逐字稿留可见缺口且不静默丢段 | `endAndTranscribe` → `TRANSCRIPTION_FAILED`；`getStageState.transcriptionFailed` | `/studio/interview` `itv-realtime-bar` `itv-session-header` | ⚠ 跨束 X-3（05-rec） |
| V13 | **两义**：架构态 file-first（音频 + `transcript.jsonl` + `notes.md` 三文件可见可下载、`derivedFrom` 正确、原音频哈希未变）；并发态（主持人与联合主持同改同段不静默覆盖） | `ObjectStore` 三文件断言；`setOutlineSectionStatus` → `CONCURRENT_MODIFICATION` | `/projects/demo/files` 文件树（22-files 已建） | ⚠ 跨束 X-5 · **UC 编号冲突** |
| V14 | **两义**：架构态 Context API（副驾驶路径无直连查询、每条建议可回放 Pack）；审计态（提纲勾选、覆盖态变更、建议采纳忽略、私下提醒、结束并转写可检索） | 静态检查 `lint-arch-deps` + `ContextApiClient`；`AuditWriter` | ⚠ 审计与 Pack 回放面均在别束 | ⚠ 跨束 X-4 X-6 · **UC 编号冲突** |

## 六、uc-6-5 R12（16 条 · 访谈回流成洞察）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：洞察库每条都能点回原始证据（时间码 + 说话人 + 场次），且引用指向不可变快照 | `confirmInsight` 固化来源快照；`getEvidenceMatrix` | `/studio/interview` `itv-insights` `itv-tc-*` | ⚠ 缺口 U-8（洞察库屏未建） |
| V2 | AC2：AI 分析＝否时抽引述返回原文、候选来源不含该人、聚类输入不含其片段、绕过前端被拒、排除名单写留痕 | `extractQuotes` / `generateCandidateInsights` → `excludedSubjectIds` | ⚠ 屏未建（ui.md U-8 候选区） | ✅ 见 domain I-4 |
| V3 | AC3 · D-25：虚拟来源调「标为强洞察」与「加入决策依据」均被接口拒绝；统计返回真人与虚拟两个独立字段 | `markStrongInsight` / `referenceForDecision` → `VIRTUAL_SOURCE_FORBIDDEN` | ⚠ 屏未建（ui.md U-8 统计区） | ✅ 见 domain I-28 |
| V4 | AC4：矩阵格子取值枚举完整；`附和` 不计入强度合计；唯一 `反例` 阻断合并 | `getEvidenceMatrix`；`mergeThemes` → `COUNTEREXAMPLE_WOULD_VANISH` | ⚠ 屏未建（ui.md U-8 证据矩阵） | ✅ 见 domain I-26 |
| V5 | AC5：下属在上级之后附和被标 `附和 · 非独立证据`，矩阵落 `附和`，强度不变 | 05-rec 的段标注 → `getEvidenceMatrix` | ⚠ 屏未建（ui.md U-8） | ⚠ 待定 D-10（谁判定附和） |
| V6 | AC6：样本量呈现处返回 `场次数` 与 `人数` 两个字段，不相等时都正确显示 | `getEvidenceMatrix` → `sessionCount` + `subjectCount` | ⚠ 屏未建（ui.md U-8 头部） | ⚠ 缺口 U-8 |
| V7 | AC7 · O-16：4 位独立受访者时「用户普遍认为」被阻断并给出实际人数与改写建议；补到 5 位放行；同一人 3 条只算 1 | `checkGeneralizationClaim` → `GENERALIZATION_UNSUPPORTED` | ⚠ 屏未建（ui.md U-8 报告草稿） | ✅ 见 domain I-27 |
| V7b | O-16：跨组织不可逆聚合样本量 < 8 的分组标「不可推断」；全仓不存在第二个聚合门槛值 | `checkGeneralizationClaim`（aggregate 分支）+ 全仓 grep 断言 | ⚠ 屏未建（跨组织聚合面属 12-3 / 17-gov） | ⚠ 跨束 X-7 |
| V8 | 撤回联动：撤回后 ≤5 分钟内引述退出检索且矩阵格子强度被重算 | `WithdrawalOrchestrator` 第 02 步 → `getEvidenceMatrix` 重算 | `/studio/interview` `itv-withdrawal-quotes` | ⚠ 跨束 X-2 |
| V9 | 权限态：研究员、引导师、组长、受访者、观察者、未授权者遍历 | 本组用例的角色矩阵 | `/studio/interview` `itv-view-*` | ⚠ 缺口 G-2 |
| V10 | 空态：无引述时矩阵显示真实空态；全员拒绝 AI 分析时显式说明「只出引述、不出候选洞察」 | `getEvidenceMatrix` → `[]`；`generateCandidateInsights` 的 E8 分支 | ⚠ 屏未建（ui.md U-8 专有空态） | ⚠ 缺口 U-8 |
| V11 | 依赖失败：归纳服务失败时已抽引述保留，可重试，不产出半截洞察 | `generateCandidateInsights` → `AI_GENERATION_UNAVAILABLE`（事务性） | `/studio/interview` `?state=dep-failed`（七态壳） | ✅ 壳已建 |
| V12 | 并发态：两名研究员同时合并主题不静默覆盖，可识别最终版本且可回滚 | `mergeThemes` → `CONCURRENT_MODIFICATION` + 回滚 | ⚠ 屏未建（ui.md U-8 操作条） | ⚠ 缺口 U-8 |
| V13 | 审计态：候选生成、洞察确认、主题合并拆分、权重调整、虚拟隔离拒绝事件可检索 | 上述用例 → `AuditWriter` | ⚠ 审计查询面属 17-gov | ⚠ 跨束 X-4 |
| V14 | 架构态：候选生成只经 Context API 无直连查询；每次生成有可重放 `context_packs` 记录且 `omissions` 记录被过滤的来源类别与条数 | `buildInterviewContextPack` → `omissions`；`lint-arch-deps` 静态检查 | ⚠ Pack 回放面属 context-pack 束 | ⚠ 跨束 X-6 |
| V15 | 架构态：抽样每条洞察的证据可经 anchor 一路定位到 `transcript.jsonl` 与原音频时间码（100%） | `confirmInsight.evidenceRefs` + artifact 束的 anchor | `/projects/demo/files` 文件树（22-files 已建） | ⚠ 跨束 X-5 |

## 七、uc-6-6 R12（14 条 · 受访者自助门户）

> ⚠ 本节的 14 条**门控当前一条都不要求**（见第零节）。

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：用已提交过授权的同一条链接进入门户视图，改选择、索取副本、发起删除三件事均返回受理凭据 | `getPortalView` / `updateConsentFromPortal` / `requestTranscriptCopy` / `requestErasure` | ⚠ 屏未建（ui.md U-9 门户三动作区） | ⚠ 缺口 U-9 |
| V2 | AC2：撤回五步 SLA 逐条断言；全流程配置与文案不存在「24 小时」 | `requestWithdrawal` → `steps[5]`；全仓 grep 断言 | `/consent` `consent-withdraw-flow` `consent-withdraw-step-*` | ⚠ 待合规确认（S-05） |
| V3 | AC3：全流程无任何注册或登录步骤；未创建持久账号 | `getPortalView`（仅令牌主体，不建 principal） | `/consent`（无登录入口） | ✅ 见 domain I-14 |
| V4 | AC4：副本只含本人发言，不含他人发言、研究员笔记、AI 建议、主题与洞察；他人 PII 保持遮盖 | `requestTranscriptCopy` → 本人切片导出 | ⚠ 屏未建（ui.md U-9 副本说明） | ⚠ 待定 D-8 |
| V5 | AC5：改项目材料保留期后门户展示的当初渲染快照不变；新发出的授权页文案已变 | `getPortalView.snapshot`（不可变）；`getConsentPage`（按当前参数渲染） | ⚠ 屏未建（ui.md U-9 `[看当初的告知内容]`） | ✅ 见 domain I-15 |
| V6 | AC6：每条请求返回状态与预计完成时间，且随流水线推进更新 | `listSubjectRequests` → `{state, etaAt}` | ⚠ 屏未建（ui.md U-9 我的请求进度） | ⚠ 缺口 U-9 |
| V7 | AC7：撤回后研究员收到通知；触发第 04 步时拍板人收到复核任务；无任何自动改写决策结论的写操作 | `WithdrawalOrchestrator` → `Notifier`；断言决策表零写入 | `/studio/interview` `itv-withdrawal-decision` | ⚠ 跨束 X-2 |
| V8 | 安全态：用该令牌读他人数据、读提纲、读 AI 建议、写洞察或报告全部被服务端拒绝并写安全审计 | 全部用例 → `TOKEN_SCOPE_VIOLATION` + `AuditWriter` | ⚠ 屏未建（负例无界面，API 层验收） | ✅ 见 domain I-14 |
| V9 | E1：撤销令牌后访问只显示失效说明与合规邮箱，响应体不含任何访谈内容 | `getPortalView` → `TOKEN_INVALID`（响应体为空壳） | ⚠ 屏未建（ui.md U-9 令牌失效态） | ⚠ 缺口 U-9 |
| V9b | O-15 令牌时效：签署令牌第 8 天与二次使用被拒；门户令牌第 179 天可用、届满被拒；重发策略明确；单条撤销不影响他人 | `issueSigningToken` / `resendPortalToken` / `revokeToken` | ⚠ 屏未建（ui.md U-9 重发入口） | ✅ 见 domain I-13 · 待定（重发后旧令牌去留二选一） |
| V10 | 不可逆诚实性：删除确认页返回体含「会删 / 不会删 / 时限 / 不可逆」四段说明，缺任一段视为失败 | `requestErasure` → `willDelete` `willNotDelete` `slaText` `irreversible` | ⚠ 屏未建（ui.md U-9 删除确认页） | ⚠ 待定 D-9（法定留存清单） |
| V11 | E3：模拟物理删除失败时材料保持不可读、发告警重试、未发出删除回执 | `issueDeletionReceipt` → `ERASURE_NOT_COMPLETE` | ⚠ 屏未建（ui.md U-9 请求处理中态） | ⚠ 缺口 U-9 |
| V12 | 审计态：门户访问、同意位变更、副本请求与交付、删除请求与回执可按操作者时间对象检索 | 上述用例 → `AuditWriter`（操作者＝受访者令牌标识） | ⚠ 审计查询面属 17-gov | ⚠ 跨束 X-4 |
| V13 | 架构态：删除完成后 embedding/OCR/图边/摘要/缓存均失效、新 Pack 不含其 Segment、22-files 中不可见不可下载、历史快照标注来源已失效 | `WithdrawalOrchestrator` 的级联断言（与 uc-6-3/V7b 同一条） | `/projects/demo/files` 文件树（22-files 已建） | ⚠ 跨束 X-2 X-5 |

## 八、uc-6-7 R12（14 条 · 访谈对象表）

> ⚠ 本节的 14 条**门控当前一条都不要求**（见第零节）。

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：新增对象填齐六列后，该对象出现在向导第二步可选列表，其「背景与要问什么」进入生成大纲的上下文入参 | `createSubject` → `listSubjects` → `createInterviewFromWizard` | ⚠ 屏未建（ui.md U-10 组卡对象表） | ⚠ 缺口 U-10 |
| V2 | AC2：跑完一场后转写、引述与洞察自动关联到对象所属组，关联记录含来源资源版本触发者时间与可见范围；正式引用指向固定快照 | `routeTranscriptToGroup` → `artifactRefs` | ⚠ 屏未建（ui.md U-10 回流展示） | ⚠ 跨束 X-1 |
| V3 | AC3：`[AI 建议人选]` 结果标记机器产出、带理由与来源、不在表中直接生成行、候选不含联系方式明文、经人确认才写入 | `suggestCandidates` / `acceptCandidate` | ⚠ 屏未建（ui.md U-10 候选卡） | ✅ 见 domain I-23 |
| V4 | AC4 · D-28：触发「按表预约」只生成草稿且无任何外发调用；人点发送后才外发并写审计 | `draftBookingInvite` / `sendBookingInvite` → `OUTBOUND_REQUIRES_HUMAN` | ⚠ 屏未建（ui.md U-10 预约草稿） | ✅ 见 domain I-24 |
| V5 | AC5：在访谈侧把同意书状态从 `待签` 改为 `拒绝 AI 分析`，项目侧组卡状态列同步变化（同一条记录非两份副本） | `getConsentMirror` 与 `listSubjects` 读同一派生源 | ⚠ 屏未建（ui.md U-6 + U-10 两处投影） | ✅ 见 domain I-20 |
| V6 | AC6：A 标为 B 的下属并排同场时默认拆场标 `已拆场`；强行同场二次确认并写审计；同组织第 3 人被参数阻止 | `checkSplitSession` → `SPLIT_SESSION_REQUIRED` / `SAME_ORG_LIMIT` | ⚠ 屏未建（ui.md U-10 排场提示） | ✅ 见 domain I-25 |
| V7 | AC7：联系方式默认返回遮盖串；无权限取明文被拒并写审计；有权限取明文也写审计；agent 一律被拒；批量导出不含联系方式 | `revealContact` → `CONTACT_PLAINTEXT_DENIED`；`exportSubjects` | ⚠ 屏未建（掩码样式 `138 •••• 2049` 已在 `/consent` 用过） | ✅ 见 domain I-21 I-22 |
| V8 | AC8：`交给 AI 分析 = 否` 的对象，其回流内容不参与本组推演模板的自动填充，只能以原文引述出现 | `routeTranscriptToGroup` + `buildInterviewContextPack` 前置过滤 | ⚠ 屏未建（组推演模板属 02-tpl） | ⚠ 跨束 X-8 |
| V9 | E7：对象撤回后表上该行仍在但状态为「已撤回」，内容在检索中查不到，界面明确提示数据已失效 | `listSubjects` 的 `state=withdrawn`；检索层已剔除 | ⚠ 屏未建（ui.md U-10 状态列） | ⚠ 缺口 U-10 |
| V10 | 权限态：引导师、组长、组员、研究员、观察者、访谈 agent、未授权者遍历；组员取不到联系方式；观察者取不到整张表 | `listSubjects` / `revealContact` 的角色矩阵 | ⚠ 屏未建（ui.md U-10） | ⚠ 缺口 G-2 |
| V11 | 空态：空对象表显示真实空态与两个出口，不预置示例对象 | `listSubjects` → `[]` | ⚠ 屏未建（ui.md U-10 空态） | ⚠ 缺口 U-10 |
| V12 | 依赖失败：AI 建议服务不可用时手工加对象仍可用，错误可解释可重试 | `suggestCandidates` → `AI_GENERATION_UNAVAILABLE`；`createSubject` 不依赖 AI | ⚠ 屏未建（ui.md U-10 dep-failed 态） | ⚠ 缺口 U-10 |
| V13 | 并发态：引导师与组长同时改同一行时不静默覆盖，可识别最终版本 | `updateSubject` → `CONCURRENT_MODIFICATION` | ⚠ 屏未建（ui.md U-10 行内编辑） | ⚠ 缺口 U-10 |
| V14 | 审计态：对象增删改、联系方式查看、AI 建议采纳、预约外发、强行同场可按操作者时间对象结果检索；越权也有安全审计 | 上述用例 → `AuditWriter` | ⚠ 审计查询面属 17-gov | ⚠ 跨束 X-4 |

---

## 九、缺口清单（这一件的真正价值所在）

> 这些是**本轮设计的产出，不是失败**。契约先行的意义就是把它们在写代码之前找出来。

### 9.1 门控与口径缺陷（最该先看的）

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **G-1** | **`verify-uc-coverage.ts` 的 R12 正则不认加粗**，导致本束 8 份 UC 里 5 份被当成「R12 共 0 条」，**69 条验收线索不受任何机械保护** | **门控缺陷**（不是 UC 缺陷） | 把 `^-\s*(V\d+)` 改成 `^-\s*\*{0,2}(V\d+)`，与该脚本读表格时**已有**的加粗容忍对齐。这是 harness 修复，不属本束 feature；⚠ 修完必须**造一次反证**（故意删掉本表某一行，确认门控转红），否则又是一次「全绿但空转」 |
| **C-3** | **「授权 N/4」的四项在仓库里有三个互相冲突的版本** ——① UC-6.3 人类 2026-07-27 拍板：`录音 / 转成文字稿 / 交给 AI 分析 / 报告中署名与职务`；② `apps/web/lib/mock/interview.ts` 的 `AUTHORIZATION.items`：`录音 / 转文字稿 / 引述 / 内部复用`（即 ui-preview 的 **S-09**，也正是 UC-6.3 开头点名说「**是错的**」的那套旧四项）；③ `apps/web/lib/mock/entry.ts` 的 `SESSION.grants` 与 `/consent` 屏：**只有三项** `录音 / 转文字稿 / 实名引用` | **同一事实三处声明且已漂移** —— 本仓最高发缺陷的第 N 次复现 | 收敛为**单一事实源** `packages/contracts/src/interview.ts` 的 `ConsentKey` 枚举，mock **从契约生成**；`/consent` 与现场状态条都消费它。⚠ **最危险的一处**：`交给 AI 分析` 这一项在已建成的界面里**根本不存在**，而 O-05 的全部合规约束都挂在它上面 |
| **C-1** | **模板反向抽取的全部依据是一个语义未定的括注**「来自 3 场项目」 | 需人类确认 | uc-6-1/A3 已自行降级为 [设计]。签核时确认：F83 的「反向抽取」是真需求还是过度解读；若是后者，F83 的点数与范围要缩 |
| **C-2** | **「诱导性问法体检」是从问卷侧借来的** ——「诱导」二字在原型档案里只命中问卷，访谈侧只有 `2 段还需你改问法` | 需人类确认 | 签核确认 `checkQuestionQuality` 在访谈侧的真实形态；否则 uc-6-1/V5 无法验收 |
| **C-4** | **UC 内部自相矛盾三处**：RQ 覆盖 4 值 vs 五态（uc-6-4）· 研究计划参数四行 vs 五项（uc-6-2）· AI 建议四类 vs 四类+覆盖（uc-6-4） | UC 缺陷 | 见 `domain.md` 的 [待定 D-3/D-4/D-5]。⚠ `feature_list.json` 的 F92 标题已经把「五态」固化进权威清单了，**改口径要连带改它** |
| **G-2** | **场景角色（研究员 / 受访者 / 观察员 / 记录 agent）不在 `ProjectRole` 四值枚举里** ——现有实现另开 `?view=` 预览轴（ui-preview 的 **S-03**），而本束**每一份 UC 的 V-权限态**都要求按这些角色做服务端断言 | 跨束 + 需裁决 | 与 ui-preview 的 S-02（合规负责人缺位）是同一个问题的两面：**角色本体是否需要「场景角色」这一层**。必须在 identity 束与阶段一致性复核里合并裁决，**否则本束 8 条权限态验收全部无处落地** |

### 9.2 跨束交叉约束（提到阶段一致性复核，不在本束单独解决）

| # | 交叉约束 | 涉及的束 | 为什么不能各做各的 |
|---|---|---|---|
| **X-1** | 正式引用只能指向固定快照 | interview + artifact（I-14）+ 22-files | 若本束自己判「是不是快照」，就成了 artifact 束 `referenceForDownstream` 门之外的第二个判定 —— D-30 会被绕过 |
| **X-2** | **五步撤回 + 两级 SLA + 六条级联失效** | interview + context-pack + artifact + 22-files + 10-report + 17-gov + 决策台账 | 本仓已因「撤回链 SLA 声明在两处」漂移过一次。**SLA 数字与级联清单必须单源**，本束只引用 |
| **X-3** | 转写段、说话人指派、逐字稿五种状态标注 | interview + 05-rec（UC-5.1/5.2/5.3） | uc-6-4/V7 的「两类之和 = 状态条计数」跨了两束的数据，谁算谁必须定死 |
| **X-4** | **统一的审计/provenance 查询面** | interview + 17-gov + artifact + identity | 本束 8 份 UC 各有一条「审计态」验收。若每束各造一个查询面，就是 artifact 束缺口①的重演 |
| **X-5** | file-first：音频 + `transcript.jsonl` + `notes.md` 三文件可见可下载，删除时真消失 | interview + artifact + 22-files | 「删除要能演示」的验收标准在 22-files；只删 PG 行而文件仍可下载 = 撤回未完成 |
| **X-6** | **一切 AI 输入只经 Context API**；`omissions[].reason` 的枚举单源 | interview + context-pack | phase-00 已把丢弃原因收敛为 7 类枚举（ui-preview 的 **S-12**）。本束**不得再造一份**排除原因词汇 |
| **X-7** | 阈值单源：普遍性断言 5 人 · 跨组织聚合 8 · 相关度 0.45 · 发言提醒 240 秒 · 建议 2 条每分钟 | interview + 12-3（phase-2）+ context-pack | O-16 明写「全仓不出现第二个聚合门槛值」。这些数字**只能有一个声明处** |
| **X-8** | 转写回流进「本组推演模板」的自动填充，受同意位约束 | interview + 02-tpl | 过滤器在本束（Context Pack 构建期），消费方在 02-tpl。若 02-tpl 直接读 segments 就绕过了 O-05 |
| **X-9** | 受访者是**非注册主体**（令牌即身份），不进 `ProjectRole` 也不建持久 principal | interview + auth + identity | phase-00 的 `auth` 束只处理注册用户。「令牌主体」这条鉴权路径**没有任何束认领** |

### 9.3 契约管不到的东西

| # | 缺口 | 补法 |
|---|---|---|
| **N-1** | **「≤5 分钟」是 SLA 不是性能目标**（uc-6-6/R9 原文），需要**可观测指标与告警**，zod 写不了 | 落成部署形态约束：撤回流水线的逐步耗时指标 + 超时告警，写进 `observability.md` 并在一致性复核确认有人负责 |
| **N-2** | **令牌限速**（防枚举、防第三方持有后大量拉取）与**短时效一次性下载链接** | 网关/对象存储配置，非 API 保证。与 artifact 束的 I-2（对象写一次）同类 |
| **N-3** | **合规输入四项**：法定留存清单 · 删除证明格式 · 加密密钥策略 · 本人 PII 是否对本人解遮盖 | O-38/O-39 明写「**必须等合规负责人输入**」。**删除确认页在这四项到位前写不出来**（uc-6-6/V10 要求四段说明齐全） |
| **N-4** | **「某物流园区运营总监」这类去标识化角色描述的生成规则** | uc-6-3/R10 [待确认]。它是 `attribution=false` 的**唯一**替代口径；由谁写、能否被本人核对、跨报告是否一致，都不是 API 形状问题 |

---

## 十、反向检查：有没有多余的 API

| API 操作 | 被哪条验收要求 | 结论 |
|---|---|---|
| `listInterviews` | uc-6-0 V1 V5 V7 V8 | ✅ |
| `getInterview` | uc-6-0 V2 V6 · uc-6-2 V3 | ✅ |
| `attachToProjectStep` / `detachFromProjectStep` | uc-6-0 V4 V9 | ✅ |
| `listTemplates` / `getTemplate` | uc-6-1 V2 V7 · uc-6-2 V9 | ✅ |
| `createTemplate` / `updateTemplate` | uc-6-1 V4 V8 V9 V10 | ✅ |
| `applyTemplate` | uc-6-1 V1 V2 V4 | ✅ |
| `extractTemplateDraft` / `confirmTemplateDraft` | uc-6-1 V3 | ⚠ **依据最弱**（见缺口 C-1）——若人类判定「来自 3 场项目」不足以支撑，这两个用例应删 |
| `checkQuestionQuality` | uc-6-1 V5 · uc-6-2 V6 | ⚠ 依据待确认（缺口 C-2） |
| `createInterviewFromWizard` | uc-6-0 V3 · uc-6-2 V2 V9 | ✅ |
| `generateOutline` / `regenerateOutline` | uc-6-2 V2 V5 V10 | ✅ |
| `updateOutlineSection` / `confirmOutline` | uc-6-2 V1 V7 V11 V12 | ✅ |
| `readResearchPlanParams` / `updateResearchPlanParams` | uc-6-2 V4 V7 V12 | ✅ |
| `issueSigningToken` | uc-6-3 V5 V8 · uc-6-7 V1 | ✅ |
| `getConsentPage` | uc-6-3 V3 V5 V12 | ✅ |
| `submitConsent` | uc-6-3 V1 V13 V14 | ✅ |
| `getConsentMirror` | uc-6-3 V4 V9 · uc-6-7 V5 | ✅ |
| `configureSessionRolesAndSwitches` | uc-6-3 V10 V15 · uc-6-4 V3 | ✅ |
| `startSession` | uc-6-3 V2 · uc-6-2 V5 | ✅ |
| `revokeToken` / `resendPortalToken` | uc-6-3 V8 · uc-6-6 V9b | ✅ |
| `requestWithdrawal` / `getWithdrawalStatus` / `issueDeletionReceipt` | uc-6-3 V7 V7b · uc-6-6 V2 V7 V11 | ✅ |
| `getStageState` | uc-6-4 V1 V6 V7 V10 V12 | ✅ |
| `setOutlineSectionStatus` / `setRqCoverage` | uc-6-4 V2 V13 V14 | ✅ |
| `evaluateSpeakingBalance` / `inviteSpeaker` | uc-6-4 V5 | ✅ |
| `listCopilotSuggestions` / `actOnSuggestion` | uc-6-4 V3 V4 V11 · uc-6-3 V10 | ✅ |
| `endAndTranscribe` | uc-6-4 V1 V12 | ✅ |
| `buildInterviewContextPack` | uc-6-3 V6 · uc-6-4 V8 · uc-6-5 V2 V14 | ✅（本束合规核心） |
| `extractQuotes` | uc-6-3 V6 ① · uc-6-5 V2 ① V11 | ✅ |
| `generateCandidateInsights` | uc-6-5 V2 V10 V11 V14 | ✅ |
| `confirmInsight` | uc-6-5 V1 V13 V15 | ✅ |
| `getEvidenceMatrix` | uc-6-5 V4 V5 V6 V8 V10 | ✅ |
| `mergeThemes` / `splitThemes` / `adjustEvidenceWeight` | uc-6-5 V4 V12 V13 | ⚠ `adjustEvidenceWeight` 的**权重语义未定**（domain 待定 D-11）——契约形状写不实 |
| `markStrongInsight` / `referenceForDecision` | uc-6-5 V3 | ✅ |
| `checkGeneralizationClaim` | uc-6-5 V7 V7b | ✅ |
| `getPortalView` | uc-6-6 V1 V3 V5 V6 V9 | ✅ |
| `updateConsentFromPortal` | uc-6-6 V1 V12 | ✅ |
| `requestTranscriptCopy` | uc-6-6 V4 · uc-6-3 R3 步骤 3 | ✅ |
| `requestErasure` / `listSubjectRequests` | uc-6-6 V1 V6 V10 V11 | ✅ |
| `listSubjects` / `createSubject` / `updateSubject` | uc-6-7 V1 V9 V11 V13 · uc-6-3 V12 | ✅ |
| `revealContact` / `exportSubjects` | uc-6-7 V7 V10 V14 | ✅ |
| `suggestCandidates` / `acceptCandidate` | uc-6-7 V3 V12 | ✅ |
| `draftBookingInvite` / `sendBookingInvite` | uc-6-7 V4 V14 | ✅ |
| `routeTranscriptToGroup` | uc-6-7 V2 V8 | ✅ |
| `checkSplitSession` / `forceSameSession` | uc-6-3 V9 · uc-6-7 V6 | ✅ |

**45 组操作中 42 组有明确 UC 要求；3 组依据不足**（`extractTemplateDraft` / `checkQuestionQuality` /
`adjustEvidenceWeight`），已在上表标出并进签核清单 —— **无孤儿接口，但有三个依据薄弱的接口需人类裁掉或补依据。**
