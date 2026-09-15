# 契约束 `postinvest-rating` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层，只依赖 `domain.md`。翻译自 `requirements/01-postinvest-rating-agent.md`
> R2 / R3 / R4 / R5，不发挥。对应 `packages/contracts/src/postinvest-rating.ts` 的 `operations`。
> 第一部分是**契约操作**（前端能调的端口，八个）；第二部分是 **Agent 侧内部用例**（R3 阶段二，
> 不是 HTTP 面，但它们的失败模式决定 run 终态与页面异常态，签核时要一起看）。

## 统一失败枚举 `PostinvestRatingError`

```
NO_PROJECT_ROLE                   非项目成员 / 组织角色不允许该动作（compliance 只读；admin 除白名单与 skill 外不能写）
ORG_NOT_ELIGIBLE                  所属组织看不到「海创汇」入口（isAgentsNavVisibleForOrg）；对外裸 404（E8）
RECORD_NOT_FOUND                  记录不存在或跨组织不可见（RLS）
RECORD_ALREADY_CONFIRMED          confirmed 不可逆：再确认 / 再反馈都拒（R7-7）
ADMIN_CANNOT_CONFIRM              管理员不是超级用户：admin 不能替成员点采纳（R5）
NO_FINANCIAL_STATEMENT            只有录音没有报表（A1）——操作层拒绝面
PARSE_FAILED                      wx_document_parse 失败且关键字段全部来自失败文件（E1）
SCRIPT_FAILED_AFTER_RETRIES       评分脚本非零退出（E3，与 skills.ts 同名值）
SANDBOX_TIMEOUT                   同上（E3）
SANDBOX_UNAVAILABLE               同上（E3）；创建 run 时沙箱不可用也回这一码
KERNEL_UNAVAILABLE                deep-agent-service 不可用（E4，与 kernel-gateway.ts 同名值）
RUN_NOT_AWAITING_HITL             run 当前不在等待降级 / 本期上期确认
WHITELIST_INVALID_DOMAIN          不是小写裸域名（D2）
FEEDBACK_TYPE_REQUIRED            错误类型单选必填（R3-13）
AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD  录音误走聊天附件路径（D5）
```

统一前置（所有操作）：调用者已登录 ∧ 组织可见「海创汇」入口（否则 `ORG_NOT_ELIGIBLE` → 404）∧
组织 ∩ 项目两层交集鉴权（否则 `NO_PROJECT_ROLE`）。下面各 UC 的 `pre` 只写**额外**条件。

---

## 第一部分 · 契约操作（前端端口）

### UC-1 `createRatingRun` —— 开始评级（R3-1 ~ R3-4；R2 触发 1）

```
in:  { projectId? | newProjectName?, inputFileIds: string[], missingData: MissingDataReason }
out: { runId, recordId }                      # 创建即占位一条 draft，版本号已分配
pre: projectId 与 newProjectName 恰好一个；newProjectName 只有组织 lead 可用（R5）
     inputFileIds 里报表 / 报告是 chat-file-upload 的 attachment id，录音是 files.uploadArtifact 的 artifact id
     postinvest-rating skill 包已启用；deep-agent-service 健康；沙箱可用（R2 前置）
err: NO_PROJECT_ROLE | ORG_NOT_ELIGIBLE | NO_FINANCIAL_STATEMENT | AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD
     | KERNEL_UNAVAILABLE | SANDBOX_UNAVAILABLE
```

失败模式（穷举）：
- `projectId` / `newProjectName` 皆无或皆有 → 应用层 400（契约不用 refine）；`newProjectName` 非 lead → `NO_PROJECT_ROLE`。
- `inputFileIds` 里没有任何 `kind ∈ {statement, audit_report}` 的文件（只有录音）→ `NO_FINANCIAL_STATEMENT`（A1 操作层拒绝面；**若人类选「接受并出数据需求说明记录」则不拒，见 domain.md 四**）。
- 某个 id 指向聊天附件路径上的音频 → `AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD`，错误信息指向 `files.uploadArtifact`（D5）。
- `missingData.reasons` 含 `other` 但 `otherText` 缺席 → 应用层 400。
- 网关健康检查失败 → `KERNEL_UNAVAILABLE`（E4，快速失败，页面显示重试按钮）；沙箱不可用 → `SANDBOX_UNAVAILABLE`。
- 成功后 run 的进展 / 失败（E1 / E3 / E5 / E6 / E9）在 SSE 事件流里呈现（`streaming-transport` 束），不在本操作的 `err` 里。
- 用户中途关闭页面（A6）→ run 继续；回来后 `listRatingRecords` 找到 `draft` 占位恢复运行态；取消走 `run-control` 的 `wx_run_cancel`。

### UC-2 `getRatingRecord` —— 读一条评级记录（R3-12、A6）

```
in:  { recordId }
out: PostinvestRatingRecord
pre: 记录属于调用者可见的项目（consultant / lead 项目成员；admin / compliance 组织内只读）
err: NO_PROJECT_ROLE | ORG_NOT_ELIGIBLE | RECORD_NOT_FOUND
```

失败模式：跨组织 id → `RECORD_NOT_FOUND`（不泄露存在性）；`status = draft` 且 run 未终态 → 正常返回，
`scores` 全 `null`、`reports` 空，前端据此保持运行态。

### UC-3 `listRatingRecords` —— 版本链（R3-1 历史列表、R3-15、A5、A6）

```
in:  { projectId }
out: { projectId, versions: PostinvestRatingRecord[] }   # version 升序，每项完整记录
pre: 同 UC-2；组织 lead 可跨项目调用（投后组合视角）
err: NO_PROJECT_ROLE | ORG_NOT_ELIGIBLE
```

失败模式：项目无记录 → `versions: []`（不是错误，前端空态）；非成员 consultant → `NO_PROJECT_ROLE`。

### UC-4 `submitFeedback` —— 反馈分流（R3-13 / 14 / 15；R2 触发 2）

```
in:  { recordId, evidenceRowIndex?, type: FeedbackType, basis, attachmentFileIds? }
out: { feedbackId, outcome: recorded_only | rerun_started, newRecordId? }
pre: 记录 status = draft；调用者是该项目成员（consultant / lead）；admin / compliance 不可
err: NO_PROJECT_ROLE | ORG_NOT_ELIGIBLE | RECORD_NOT_FOUND | RECORD_ALREADY_CONFIRMED | FEEDBACK_TYPE_REQUIRED
     | PARSE_FAILED | SCRIPT_FAILED_AFTER_RETRIES | SANDBOX_TIMEOUT | SANDBOX_UNAVAILABLE | KERNEL_UNAVAILABLE
```

分流（I-5）：
- `type = subjective` → `outcome = recorded_only`，无 `newRecordId`；写一条 `RatingCorrection`（`before = after`）；
  **不重算、不改规则、不改权重**；页面回显「已记录，评级不变」。
- 其余四类 → 同步启动新 run，以修正依据 + 原 run 输入重执行 R3 步骤 6–11（只重算受影响字段），
  `outcome = rerun_started`，`newRecordId` = `version + 1` 的 `draft`；修正记录写入新旧两版 `corrections` 与 `wx_memory_write`。
  E7：重算结果完全一致 → **仍**新建版本，`uncertainties` 写明「修正后结论未变化及原因」。

失败模式（穷举）：
- `type` 缺席 / 非法 → `FEEDBACK_TYPE_REQUIRED`（契约 enum 拒非法值；缺席由应用层映射到本码）。
- 记录已 `confirmed` → `RECORD_ALREADY_CONFIRMED`（只能新开一轮 `createRatingRun`）。
- `evidenceRowIndex` 越界 → 应用层 400。
- `type = missing_info` 附件解析失败且关键字段全来自它 → `PARSE_FAILED`（E1）。
- 重算脚本失败 → 沙箱三码之一（E3），**不生成新版本**，不心算；内核不可用 → `KERNEL_UNAVAILABLE`（E4）。
- 重算时白名单检索 / 转写失败（E5 / E6）不进 `err`——新版本照常生成并标注。

### UC-5 `confirmRatingRecord` —— 采纳（R3-16、R7-7）

```
in:  { recordId }
out: PostinvestRatingRecord                  # status = confirmed，含 confirmedBy / confirmedAt
pre: 记录 status = draft 且其 run 已成功终态；调用者是该项目成员（consultant / lead）
err: NO_PROJECT_ROLE | ORG_NOT_ELIGIBLE | RECORD_NOT_FOUND | RECORD_ALREADY_CONFIRMED | ADMIN_CANNOT_CONFIRM
```

失败模式：admin 代点 → `ADMIN_CANNOT_CONFIRM`（R5「管理员不是超级用户」，与 `NO_PROJECT_ROLE` 区分是为了页面文案）；
compliance → `NO_PROJECT_ROLE`；重复采纳 → `RECORD_ALREADY_CONFIRMED`；run 仍在跑 / 已 failed 的占位记录 → 应用层 409
（**契约没有专用码，待人类裁决是否补 `RECORD_NOT_RATED`**，见 design-signoff 待决）。

### UC-6 `getTrustedSourceWhitelist` —— 读可信渠道白名单（R3-10、D2）

```
in:  {}
out: TrustedSourceWhitelist  # { domains, updatedBy: string|null, updatedAt }
pre: 组织内任一角色可读（Agent 编排也读它）
err: NO_PROJECT_ROLE | ORG_NOT_ELIGIBLE
```

失败模式：组织从未初始化 → 返回种子 `TRUSTED_SOURCE_SEED_DOMAINS`，`updatedBy = null`；不存在「空且报错」的分支（A7 是编排层行为）。

### UC-7 `updateTrustedSourceWhitelist` —— 全量替换白名单（R5 admin、D2）

```
in:  { domains: TrustedSourceDomain[] }
out: TrustedSourceWhitelist
pre: 组织 admin
err: NO_PROJECT_ROLE | ORG_NOT_ELIGIBLE | WHITELIST_INVALID_DOMAIN
```

失败模式：任一元素带协议 / 路径 / 端口 / 通配符 / 大写 → `WHITELIST_INVALID_DOMAIN`，整批拒绝（I-7）；
非 admin → `NO_PROJECT_ROLE`；`domains: []` 合法（A7：编排跳过检索并标注「未配置可信渠道」）。

### UC-8 `decideRatingHitl` —— HITL 裁决（R3-11 降级 / 直接 E；A4 本期上期指定）

```
in:  { runId, decision: approve | reject, note? }
out: { runId, decision }
pre: run 处于 deep-agent-hitl 的中断态且中断类型属于本束三种之一（business_abnormal 直接 E / 降级触发 / 期间不一致）
     调用者是该项目成员（consultant / lead）
err: NO_PROJECT_ROLE | ORG_NOT_ELIGIBLE | RUN_NOT_AWAITING_HITL | KERNEL_UNAVAILABLE
```

失败模式：run 不在中断态或已被裁决 → `RUN_NOT_AWAITING_HITL`；内核不可达 → `KERNEL_UNAVAILABLE`；
`reject` 无 `note` → 接受但 `uncertainties` 记「驳回未说明」（契约 `note` 可选，**是否改为驳回必填待人类裁决**）。
语义：`approve` → checkpoint 落库、run 继续到综合输出；`reject` → 不落库，run 回到步骤 7 按用户说明重判，
或（A4）以用户指定的本期 / 上期重启阶段二。中断机制本身在 `deep-agent-hitl` 束。

---

## 第二部分 · Agent 侧内部用例（R3 阶段二，非 HTTP 面）

这些用例由 `postinvest-rating` agent 在 deep-agent-service 内执行，前端只通过 SSE 事件流看到进展；
它们的失败模式映射到 **run 终态** 与 **记录里的标注**，而不是 HTTP 错误码，除非注明。

| 内部 UC | in → out | 复用能力 | 失败模式 → 落点 |
|---|---|---|---|
| **IUC-0 前置检索** | `projectId` → 同项目 / 同类历史错误清单 | `wx_memory_search` | 检索失败 → 跳过，`uncertainties` 记「记忆未检索」；不阻断 |
| **IUC-1 解析（R3-5）** | `inputFiles[]` → 每文件 Markdown + `structure.json` + warnings；录音 → 转录稿 | `wx_document_parse`（`ocr:false`）、`wx_audio_transcribe` | **E1** 单文件失败 → 该文件标「解析失败」+ 原始 warnings，**不自动重试**，其余继续；关键字段全部来自失败文件 → 走 A1（`grade = null` 或 `PARSE_FAILED`）。**E6** 转写失败 → 定性佐证段标「录音未转写」，不影响出分 |
| **IUC-2 清洗与口径对齐（R3-6）** | 解析产物 → 统一 schema（元 / 期间对齐 / 合并-单体标记）+ `EvidenceRow[]` | `data-analysis`（沙箱 execute + pandas） | 字段缺失 → `value = null`（**永不 0**，I-9）+ `uncertainties` 条目；`sourceLocator` 无法确定 → 该行 `scoreComponent = none`，不进算分（I-8）；**A4** 多份报表期间不一致 → 触发 HITL（UC-8），未裁决前不进 IUC-3；沙箱失败 → 沙箱三码，run `failed` |
| **IUC-3 数据质量判定（R3-7）** | schema + `missingData` → `flags[]` + 每条触发条件与数值 | skill 包数据质量表（阈值只在包内） | **A1** 无报表：正常原因 ∧ 有历史报表 → `estimated` 用上期出分；异常原因 → `business_abnormal` 直接 E；否则 `grade = null`。**A2** `noPriorYear` → 增长类按体量基础分 + 标注。**A3** 仅单体 / 仅经营报告 → `incomplete`。**E2** 两条比率规则命中 → `suspected_abnormal` + 触发数值，**不降级**。`business_abnormal` → 触发 HITL（UC-8）后跳到 IUC-6 |
| **IUC-4 确定性算分（R3-8）** | schema → `ScoreBreakdown`（含 `intermediates`、`scriptVersion`）+ 初评等级 + 降级触发 | skill 包脚本（沙箱 `network:none`，≤ 5 s） | **E3** 非零退出 → `SCRIPT_FAILED_AFTER_RETRIES` / `SANDBOX_TIMEOUT` / `SANDBOX_UNAVAILABLE`，run `failed`，stderr 原样带回，**不心算补分**（I-2）；降级触发命中 → HITL（UC-8）确认后才落 `grade` |
| **IUC-5 历史对比与趋势归因（R3-9）** | `projectId` → 同比 / 环比表 + 趋势判断（改善 / 平稳 / 恶化）+ 归因候选（带来源） | `wx_knowledge_search` / `wx_knowledge_read` | 无历史 → 「首次评级，无趋势判断」进 `uncertainties`；检索失败 → 同上并记「历史未检索」；归因只写「伴随 / 同期」，「导致」仅限当事人原话并标注（R7-10）；**不改分**（I-11） |
| **IUC-6 行业背景补充（R3-10）** | 公司名 / 行业名 → 行业基准文字段 + `discardedOffWhitelistCount` | `web_search` / `fetch_url`（`web-research`）+ UC-6 白名单 | **A7** 白名单空 → 跳过，依据表注「未配置可信渠道，未补充行业背景」，计数 0；**E5** 检索失败 / 超时 → 段落标「未获取」，评级照常；非白名单域名 → 丢弃 + 计数（I-12）；查询词含财务数值 → 编排层拒绝发出（R9 安全）；**不改分**（I-11） |
| **IUC-7 综合输出与发布（R3-11）** | 上述全部 → `RatingGradeMeta`（skill 包那一行）+ 依据表 + 不确定性 + `reports[]`（pdf / xlsx / png）→ `wx_artifact_publish` → 记录落库 | `pdf-create`、`xlsx-create`、`data-visualization`、`wx_artifact_publish` | **E9** 产物生成成功但读取校验失败 → `verified = false`，标「未验证」不可下载（I-15），其余产物照常；图表 / PDF 生成失败 → 该产物缺席 + `uncertainties` 记，不阻断记录落库（R9 降级）；HITL 未裁决（`business_abnormal` / 降级触发）→ **不落库**，等 UC-8 |
| **IUC-8 修正记忆写入（R3-15）** | `RatingCorrection` → 组织记忆 | `wx_memory_write` | 写入失败 → 修正历史仍落库，`uncertainties` 记「记忆写入失败」；不阻断新版本生成 |
| **IUC-9 定期触发（R2 触发 3、F08）** | 季度到期 → 以上一次输入创建新 run + 提示补新报表 | `wx_schedule_create/list/cancel` | 上次输入的原件不可读 → 不创建 run，通知「请补新报表」；与 UC-1 同一条创建路径，同一失败面 |

**Run 终态与页面异常态对照（R4 E1–E9）**

| 异常 | run 终态 | 记录 / 页面 |
|---|---|---|
| E1 解析失败 | 继续（部分）或 `failed`（全部关键字段） | 文件条「解析失败」+ warnings；全失败 → A1 路径 |
| E2 数据疑似异常 | 成功 | `suspected_abnormal` chip + 触发数值；不降级 |
| E3 脚本失败 | `failed`（沙箱三码） | 页面显示 stderr 摘要 + 重试；无分数、无等级 |
| E4 内核不可用 | 不创建 / `failed` | `KERNEL_UNAVAILABLE` → 服务不可用错误 + 重试按钮 |
| E5 检索失败 | 成功 | 行业背景「未获取」 |
| E6 转写失败 | 成功 | 定性佐证「录音未转写」 |
| E7 重算未变化 | 成功（新版本） | 版本 +1，注明「结论未变化及原因」 |
| E8 无权限 | 不创建 | 入口不显示；直达 404（`ORG_NOT_ELIGIBLE` 对外裸 404） |
| E9 产物未验证 | 成功 | 产物卡「未验证」，不可下载 |

## 跨束委托（不在本束实现，只调用）

- run 创建 / SSE 事件流 / 取消 → `agent-runtime` / `streaming-transport` / `run-control`（`wx_run_cancel`）。
- HITL 中断、checkpoint 落库、恢复 → `deep-agent-hitl`；本束只定义裁决入口 UC-8。
- 报表 / 报告上传 → `chat-file-upload`（白名单 / 上限以该契约为准）；录音上传 → `files.uploadArtifact`（D5）。
- 沙箱执行与失败码 → `skills.ts`（F962）；内核可用性 → `kernel-gateway.ts`。
- 组织 / 项目鉴权 → `identity` 束；产物鉴权下载 → produced-file 路径（#3560/#3586/#3592）。
- skill 包导入与双门禁（F01）→ `skills.ts` starter-pack 流程；Agent 定义发布 → `agent-runtime.ts`。
