# 契约束 `postinvest-rating` — 领域模型与不变量（支撑材料）

> 洋葱最内层。翻译自 `requirements/01-postinvest-rating-agent.md` 的 R1 / R3 / R4 / R7 / R9 / R10，
> 不发挥。形状的单一事实源是 `packages/contracts/src/postinvest-rating.ts`（签核第 ③ 件）；
> 本文件只写 zod 写不了的东西——**不变量**（在任何时刻都为真，违反即数据损坏）。
>
> ⚠ **本文件里不出现任何评分阈值、比率阈值、区间或分级文案**（R7-1）。它们只在
> `skills/standard-finance/postinvest-rating/` 包内；这里出现一个数字就是第二份事实源。

## 一、实体与值对象

### `PostinvestRatingRecord`（聚合根：评级记录）

```
PostinvestRatingRecord {
  id, projectId
  version:      int ≥ 1            # 同一 projectId 内从 1 起递增
  status:       draft | confirmed  # 单向，confirmed 不可逆
  grade:        RatingGrade | null # null ⇔ 无法评级（A1）
  gradeMeta:    RatingGradeMeta | null
  flags:        DataQualityFlag[]  # 可多选
  scores:       ScoreBreakdown
  evidence:     EvidenceRow[]
  uncertainties: string[]
  discardedOffWhitelistCount: int ≥ 0
  inputFiles:   RatingInputFile[]  # 每个带 sha256
  reports:      RatingReport[]     # 每个带 verified
  runId                            # 产生本版本的 agent run（agent-runtime 束）
  createdAt, confirmedBy?, confirmedAt?
  corrections:  RatingCorrection[]
}
```

一条记录 = 一次 run 的完整结论快照。「版本链」不是独立实体，是同一 `projectId` 下按
`version` 排列的记录序列（`listRatingRecords.out.versions`）。

### `RatingGrade` / `RatingGradeMeta`（值对象，投影）

`RatingGrade` 只保证五档 **A–E 的封闭性**；`RatingGradeMeta` 是 API 把 skill 包分级表
「那一行」（颜色 token / 含义 / 投后管理建议）**原样带回**前端的形状。区间与文案不在契约、
不在前端、不在本文件。

### `ScoreBreakdown`（值对象，确定性脚本输出投影）

`{ s1, s2, s3, total, intermediates: Record<string, number|null>, scriptVersion }`。
每个数值 `nullable`——缺失是 `null`，不是 `0`。`intermediates` 的键名由脚本定义，契约不枚举。

### `EvidenceRow`（值对象，依据表一行）

`{ field, value: number|null, unit, sourceFileId, sourceLocator, scoreComponent }`。
`sourceLocator` 只能是实际读到的章节标题 / 表头 / 行标识 / 转录稿原句 / `structure.json` 表格坐标。
`scoreComponent ∈ {S1, S2, S3, quality, none}`：`quality` = 只用于数据质量判定，`none` = 仅定性佐证。

### `DataQualityFlag`（值对象，封闭枚举，可多选）

`normal | incomplete | estimated | business_abnormal | suspected_abnormal`。触发条件只在 skill 包。

### `MissingDataReason`（值对象，人工确认事实）

`{ reasons: MissingDataReasonCode[], otherText?, standaloneOnly, operatingReportOnly, noPriorYear }`。
它是 run 输入的一部分，**来源只能是人**（表单）；哪些码算「正常原因 / 异常原因」由 skill 包决定。

### `FeedbackType` / `FeedbackOutcome` / `RatingCorrection`

五类反馈 `calc_error | mapping_error | misunderstanding | missing_info | subjective`；
分流结果 `recorded_only | rerun_started`；`RECORD_ONLY_FEEDBACK_TYPE = "subjective"` 是 R7-6 的机械表达。
`RatingCorrection` 是修正历史一条（同一内容另写入组织记忆，记忆侧形状不在本束）。

### `RatingInputFile` / `RatingReport`

输入文件 `{ fileId, filename, sha256(64 hex 小写), kind ∈ {statement, audit_report, recording, unknown} }`，
`kind` 由服务端识别（R3-2 回显）。产物 `{ artifactId, kind ∈ {pdf, xlsx, png}, verified }`。

### `TrustedSourceWhitelist` / `TrustedSourceDomain`（组织级配置）

`domains: TrustedSourceDomain[]`，元素是**小写裸域名**（无协议 / 路径 / 端口 / 通配符）；
`TRUSTED_SOURCE_SEED_DOMAINS`（D2 八个种子域）是组织初始化写入值，管理员可增删。
被评公司官网按项目登记，不在种子里。

### 跨束引用（本束不定义、只消费）

- 组织角色 `OrgRole`（`identity.ts`）；项目成员关系（组织 ∩ 项目两层交集）。
- run 生命周期 / 事件流 / 取消（`agent-runtime` / `streaming-transport` / `run-control`）。
- HITL 中断与 checkpoint（`deep-agent-hitl`）；本束只定义裁决入口 `decideRatingHitl`。
- 沙箱失败码 `SCRIPT_FAILED_AFTER_RETRIES | SANDBOX_TIMEOUT | SANDBOX_UNAVAILABLE`（`skills.ts`）；
  `KERNEL_UNAVAILABLE`（`kernel-gateway.ts`）——本束在 `err` 里引用同名值。
- 原件上传 `uploadArtifact`（`files.ts`）；聊天附件白名单（`chat-file-upload.ts`）。

## 二、不变量（每条都能写成断言；「应该 / 建议」不算不变量）

| # | 不变量（断言形式） | 出处 | 在哪里强制 |
|---|---|---|---|
| **I-1 可复现** | 同一份清洗后 schema + 同一 `scriptVersion` ⇒ 两次运行的 `ScoreBreakdown`（含 `intermediates` 每个键）**逐位相等** | R7-2、R9 可复现 | skill 包脚本（纯函数、`network:none`）；F01 `scoring-determinism.test.ts` 断言 |
| **I-2 算分只来自脚本** | 记录里任何 `scores.*` 非 `null` 值都等于脚本对该记录 `evidence` 的输出；脚本非零退出 ⇒ run `failed`，不存在「LLM 补一个分数」的分支 | R3-8、R4 E3、R9 | deep-agent 编排（F04）；`null-not-zero-and-script-only-scoring.test.ts`；失败码复用 `skills.ts` |
| **I-3 `confirmed` 不可逆** | `status = confirmed` 的记录，其全部字段（`confirmedBy` / `confirmedAt` 在内）此后永不改变；对它的 `confirmRatingRecord` / `submitFeedback` 恒回 `RECORD_ALREADY_CONFIRMED` | R3-16、R7-7 | 应用层前置检查 + 存储层只读（F07 `version-and-confirm-immutable.test.ts`） |
| **I-4 版本严格递增** | 同一 `projectId` 下 `version` 从 1 起、**严格递增、无空洞、无重复**；新版本只由 `createRatingRun`（新一轮）或 `submitFeedback` 的 `rerun_started` 分支产生；旧版本内容不变 | R3-15、R4 A5 | 应用层分配（创建即占位，`CreateRatingRunOutput.recordId`）+ 存储层 `(projectId, version)` 唯一约束 |
| **I-5 主观偏差不产生版本** | `submitFeedback.in.type = subjective` ⇒ `outcome = recorded_only` ∧ `newRecordId` 缺席 ∧ 该项目最大 `version` 不变 ∧ skill 包规则 / 权重不变；其余四类 ⇒ `outcome = rerun_started` ∧ `newRecordId` 指向 `version + 1` 的 `draft`（E7：结论未变也新建） | R3-14、R7-6、MAAU 防退化 | 应用层跨字段规则（契约注释明说不用 refine）；`feedback-five-way-split.test.ts` |
| **I-6 grade 为空 ⇔ 无法评级** | `grade = null` ⇔ `gradeMeta = null` ⇔ `scores.total = null` ⇔ 记录走了 A1「无财务报表」路径（`uncertainties` 含「无法评级：无财务报表」）；反之只要出了分，`grade` / `gradeMeta` 同时非空 | R4 A1、契约字段注释 | 应用层组装记录时保证；契约 `.nullable()` 只表达可空，等价关系由 F04 测试断言 |
| **I-7 白名单元素是小写裸域名** | `TrustedSourceWhitelist.domains` 每个元素满足 `TrustedSourceDomain` 正则（小写、无协议 / 路径 / 端口 / 通配符）；写入不合规 ⇒ `WHITELIST_INVALID_DOMAIN`，整批拒绝不部分写入 | R3-10、D2 | 契约 zod 正则（请求体 ValidationPipe）+ 应用层错误码映射 |
| **I-8 参与算分的依据必有来源** | `scoreComponent ∈ {S1,S2,S3}` 的每一行 `sourceFileId` 与 `sourceLocator` 非空，且 `sourceFileId ∈ inputFiles[].fileId`；不满足的行不得进入脚本输入 | R7-4、R3-6 | 契约 `min(1)`（形状）+ 应用层「进入脚本前过滤 / 拒绝」（F04）；F02 契约测试断言缺来源行 parse 失败 |
| **I-9 缺失记 `null`，永不写 0** | 抽取不到的字段在 `EvidenceRow.value` 与 `ScoreBreakdown.*` 里是 `null`；不存在「缺失被换成 0 再算」的路径；每个 `null` 字段在 `uncertainties` 里有一条对应条目 | R3-6、R7-3 | 清洗步骤（data-analysis）+ 脚本输入校验（F04 `null-not-zero` 测试） |
| **I-10 契约不含阈值** | `postinvest-rating.ts` 与本束四份 `.md` 里不出现任何分数阈值、比率阈值、区间边界或分级文案；`RatingGradeMeta` 四字段逐字来自 skill 包 | R7-1、R8 | 契约文件头声明 + 人类签核核对；F01 `fixtures-coverage` 断言阈值只在包内 |
| **I-11 行业背景不改分** | 对同一 `evidence` 集合，白名单检索有 / 无 / 失败三种情况下 `ScoreBreakdown` 逐位相等；行业背景只进入文字段与 `discardedOffWhitelistCount` | R3-10、R7-8、R4 A7 / E5 | 编排顺序（算分在检索之前完成，检索结果不进脚本输入）；F06 测试 |
| **I-12 非白名单结果默认丢弃且计数** | 检索结果的域名不与 `domains` 任一元素精确 / 子域匹配 ⇒ 不进入任何输出；`discardedOffWhitelistCount` = 被丢弃条数；未配置 / 未检索 ⇒ 0 | R7-9、D2 | 编排层过滤（F06）；契约 `nonnegative()` |
| **I-13 输入可追溯** | 每条记录 `runId` 非空、`inputFiles` 每项 `sha256` 是 64 位小写十六进制、`scores.scriptVersion` 非空；三者共同决定「可原样重跑」 | R6 后置、R9、R12 可追溯 | 契约正则 / `min(1)`；F04 落库时从原件与包版本填入 |
| **I-14 人工确认事实来自人** | `missingData`、本期 / 上期指定、降级触发确认三件事只能由 `createRatingRun.in.missingData` 与 `decideRatingHitl` 写入；Agent 不得自行产生这三类事实 | R7-5、R3-3、R3-11 | 编排层：三者在 run 输入 / HITL 恢复值里只读；F08 测试断言未裁决前不落库 |
| **I-15 未验证产物不可下载** | `RatingReport.verified = false` 的产物不出现在可下载状态；`verified` 只由读取校验步骤写 `true` | R4 E9 | F04 发布步骤（`wx_artifact_publish` 后读取校验）；前端按 `verified` 渲染 |

## 三、③ 件为什么是 zod 契约文件（形态 A）

本束有对外 HTTP 面（八个操作），第 ③ 件是 `packages/contracts/src/postinvest-rating.ts`，
已在 `packages/contracts/src/index.ts` 导出为 `postinvestRating`。不走「无 HTTP 面」形态 B。

## 四、待人类在签核时确认

- **I-6 的 A1 双路径**：契约 `NO_FINANCIAL_STATEMENT` 注释写「本操作层面的拒绝面；服务端也可选择
  接受并出『数据需求说明』记录」——即 A1 既可在 `createRatingRun` 直接拒，也可接受后产出
  `grade = null` 的记录。两条都合 UC，但**只能选一条**做默认，否则前端空态 / 结果态两种分支都要写。
- **I-4 的「创建即占位」**：`CreateRatingRunOutput.recordId` 意味着 run 失败（E3 / E4）后会留下一条
  永远 `draft`、无分数的记录占住一个版本号。这是否可接受（A6 恢复靠它），还是失败 run 的占位应回收？
- **`MissingDataReason.otherText` 必填性**：契约不用 refine（mock 生成器限制），`reasons` 含 `other`
  而 `otherText` 缺席由应用层拒——契约里没有对应错误码（现只能落 400 通用校验），是否要补一个？
