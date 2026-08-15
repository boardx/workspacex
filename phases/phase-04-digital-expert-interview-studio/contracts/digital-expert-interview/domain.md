# 契约束 `digital-expert-interview` — 领域模型与不变量

> 本束扩展 Phase 01 的 `interview` 能力，只定义数字专家工作流；不会复制第二套访谈范围、鉴权、错误信封或真人授权模型。
> API 契约唯一落点仍是 `packages/contracts/src/interview.ts`。

## 一、实体与值对象

### `DigitalInterview`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `InterviewId` | 复用既有访谈身份 |
| `orgId` | `OrgId` | RLS 隔离键 |
| `name` | `string` | 非空访谈名称 |
| `tags` | `string[]` | 至少一项 |
| `topic` | `string \| null` | 创建时为空；只能由“确认主题”操作写入非空主题 |
| `status` | `DigitalInterviewStatus` | 八态单源 |
| `sourceQuickInterviewId` | `InterviewId \| null` | 快捷访谈转批量时保留来源 |
| `selectedExpertIds` | `DigitalExpertId[]` | 已确认集合不得为空 |
| `reportId` | `InterviewReportId \| null` | 报告生成后写入 |
| `version` | `number` | 并发修改保护；每一次成功的显式确认恰好递增一次 |

`DigitalInterviewStatus` 是封闭八态：
`draft / topic_pending / experts_pending / questions_pending / running / report_pending / completed / failed`。

### `DigitalExpertSnapshot`

`{ expertId, agentDefinitionId, agentVersion, displayName, role, domains, materialContextPackId, materialVersion, exploratory: true }`。
它是访谈发生时的只读快照和来源指针，不是第二套组织级专家身份；显示字段随访谈保存，材料正文仍只能经 Context API 按当前权限读取。

### `DigitalInterviewQuestion`

`{ id, interviewId, expertId, order, text, purpose, status }`。问题必须且只能属于本场已选的一位专家；不同专家的问题集合相互独立。

### `DigitalExpertRun`

`{ interviewId, expertId, status, completedQuestionIds, failedOperation?, retryCount, startedAt?, completedAt? }`。
单专家运行失败只改变自己的运行记录，不回滚其他专家已完成的问答。

### `DigitalInterviewFinding`

`{ id, reportId, text, expertId, questionId, exploratory: true, sourceAnswerId, validationNote? }`。
报告发现必须同时指向专家、问题和回答；`exploratory` 恒为 `true`。

## 二、状态迁移

| 当前态 | 操作 | 下一态 | 关键前置条件 |
|---|---|---|---|
| `topic_pending` | 确认主题 | `experts_pending` | 名称、标签、主题有效；成功生成或允许手动添加专家 |
| `experts_pending` | 确认专家 | `questions_pending` | 至少一位专家 |
| `questions_pending` | 确认问题并运行 | `running` | 每位专家至少一题且归属合法 |
| `running` | 全部运行结束 | `report_pending` | 允许部分专家失败，但不得伪装全部成功 |
| `report_pending` | 生成报告 | `completed` | 所有发现可追溯且标探索性 |
| 任一可恢复态 | 依赖失败 | `failed` | 保存最后成功步骤和失败 operation |
| `failed` | 重试 | 原目标态 | 只重试失败 operation，不清空既有成功结果 |

## 三、不变量

| # | 不变量 | 机械断言 |
|---|---|---|
| I-1 | 状态只来自八态闭集；卡片、详情、当前步骤与主按钮均由该字段投影 | 契约拒绝第九值；同一 fixture 的四处投影一致 |
| I-2 | `createDigitalInterview` 只保存名称、标签、范围和 `requestId`，初始态为 `topic_pending`；它不保存主题，也不调用专家生成器 | HTTP 创建响应与重新读取均为 `topic=null`、`status=topic_pending`；生成器 0 调用 |
| I-3 | 未确认主题不得生成专家；未确认专家不得生成问题；未确认问题不得开始运行 | 三种跳步均由服务端拒绝 |
| I-4 | 已确认专家集合永不为空 | 删除最后一位返回 `DIGITAL_EXPERT_REQUIRED` |
| I-5 | 问题只能归属于本场已选专家 | 外部或已删除专家返回 `DIGITAL_QUESTION_EXPERT_INVALID` |
| I-6 | 单专家失败不改变其他专家的完成记录 | 失败后重读其他 run 仍为 completed 且回答不变 |
| I-7 | 报告失败不删除主题、专家、问题、回答或候选素材 | 重试前后素材哈希一致 |
| I-8 | 每条报告发现均含合法 `expertId`、`questionId`、`sourceAnswerId` 且 `exploratory=true` | 响应契约与数据库约束双重断言 |
| I-9 | 快捷访谈创建即进入历史记录；转批量保留来源引用且只复制当前用户有权使用的内容 | 跨组织/无权内容不进入目标访谈 |
| I-10 | 无权与不存在返回同一个既有 `NO_INTERVIEW_ACCESS` 信封；每请求的运维 `traceId` 是唯一允许不同的字段 | 两者均为 404；遮蔽 `traceId` 后信封一致，两个非空 traceId 不同，正文不含 reason code 或被寻址 interview id |
| I-11 | 数字专家材料只经既有 Context API 读取 | 静态依赖检查与 context-pack provenance 断言 |
| I-12 | 所有有效修改后保存版本；恢复以服务端状态为准 | 重进页面或重建进程后恢复准确步骤、版本与运行进度 |
| I-13 | 主题、专家、问题、运行和报告的推进都必须经各自的显式确认操作；输入中的未确认内容是客户端 dirty buffer，不得提前写入服务端 | 输入主题/编辑专家或问题时没有写请求；点击确认后恰好保存一个新版本 |
| I-14 | 每一个可重放写操作以 `(orgId, interviewId, operation, requestId)` 去重；相同 payload 重试复用首次成功的 HTTP status 与业务正文，改变 payload 重用同一 `requestId` 被拒绝 | F04 create/confirm 首次和 replay 均为 201；遮蔽动态 `traceId` 后正文相同；重试不生成第二个版本/专家/问题/run/报告；payload 指纹不同返回 `IDEMPOTENCY_KEY_REUSED` |
| I-15 | 写入带调用方读到的 `expectedVersion`；服务端版本不相等时冲突，绝不静默覆盖 | 陈旧版本返回 `CONCURRENT_MODIFICATION`，服务端内容和版本保持不变 |

## 四、边界

- 复用 Phase 01 `InterviewId`、范围/权限、错误信封和 `/itv` 路由，不修改真人访谈授权、录制或撤回链。
- 复用 Phase 00 Agent/Context/Artifact/Identity 契约与 `synthesized` 语义；数字专家结论不能成为强证据。
- 本束没有写入强洞察、决策依据或组织晋升的操作；未来接入这些出口须由 Phase 03 治理能力服务端复核。
- 本束不包含真人、用户画像、语音或视频数字人，也不新增第二份手写 mock 事实源。
