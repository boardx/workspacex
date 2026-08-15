# 契约束 `digital-expert-interview` — 用例接口与失败模式

## 一、应用端口

| 操作 | 输入 | 成功结果 | 主要失败 |
|---|---|---|---|
| `listDigitalInterviews` | scope, status filter | 历史卡投影 | `NO_INTERVIEW_ACCESS`, `DEPENDENCY_UNAVAILABLE` |
| `listDigitalExperts` | domain filter | 可用专家投影 | `DEPENDENCY_UNAVAILABLE`（不得伪装空列表） |
| `createDigitalInterview` | `{ name, tags, scope, requestId }` | `topic_pending`；只含名称/标签/范围/版本 | `DIGITAL_INTERVIEW_INPUT_INVALID`, `IDEMPOTENCY_KEY_REUSED` |
| `confirmDigitalInterviewTopic` | `{ interviewId, topic, requestId, expectedVersion }` | `experts_pending` + candidates | `DIGITAL_INTERVIEW_STEP_INVALID`, `AI_GENERATION_UNAVAILABLE`, `CONCURRENT_MODIFICATION`, `IDEMPOTENCY_KEY_REUSED` |
| `updateDigitalInterviewExperts` | `{ interviewId, add, remove, requestId, expectedVersion }` | dirty candidate set | `DIGITAL_EXPERT_REQUIRED`, `DIGITAL_EXPERT_NOT_AVAILABLE`, `CONCURRENT_MODIFICATION`, `IDEMPOTENCY_KEY_REUSED` |
| `confirmDigitalInterviewExperts` | `{ interviewId, requestId, expectedVersion }` | `questions_pending` + per-expert questions | `DIGITAL_INTERVIEW_STEP_INVALID`, `AI_GENERATION_UNAVAILABLE`, `CONCURRENT_MODIFICATION`, `IDEMPOTENCY_KEY_REUSED` |
| `updateDigitalInterviewQuestions` | `{ interviewId, expertId, mutations, requestId, expectedVersion }` | dirty per-expert questions | `DIGITAL_QUESTION_EXPERT_INVALID`, `CONCURRENT_MODIFICATION`, `IDEMPOTENCY_KEY_REUSED` |
| `confirmDigitalInterviewQuestions` | `{ interviewId, requestId, expectedVersion }` | `running` + run list | `DIGITAL_INTERVIEW_STEP_INVALID`, `CONCURRENT_MODIFICATION`, `IDEMPOTENCY_KEY_REUSED` |
| `retryDigitalExpertRun` | interviewId, expertId | one updated run | `DIGITAL_EXPERT_RUN_NOT_FAILED`, `DEPENDENCY_UNAVAILABLE` |
| `generateDigitalInterviewReport` | interviewId, version | traceable report | `DIGITAL_REPORT_NOT_READY`, `DIGITAL_REPORT_SOURCE_INVALID`, `AI_GENERATION_UNAVAILABLE` |
| `startQuickDigitalInterview` | expertId | persisted quick interview | `DIGITAL_EXPERT_NOT_AVAILABLE` |
| `convertQuickInterviewToBatch` | quickInterviewId, editable metadata | draft with source reference | `NO_INTERVIEW_ACCESS`, `DIGITAL_INTERVIEW_INPUT_INVALID` |

`listDigitalExperts` 与主题确认时的专家候选都通过 `DigitalExpertCatalogPort` 消费现有 Agent Definition 与 Context Pack；返回并保存 `DigitalExpertSnapshot`，不创建或修改组织级专家对象。

## 二、HTTP 面

受保护路由统一挂在既有 interview 控制器边界下；准确路径由 `packages/contracts/src/interview.ts` 导出，Web 客户端不得手写第二套响应类型。至少覆盖：列表、详情、创建/保存、确认主题、专家增删确认、问题增删改确认、运行/单专家重试、报告生成、快捷访谈与转批量。

创建路由为 `POST /interviews/digital`；主题确认路由为 `POST /interviews/digital/:interviewId/topic/confirm`；其余步骤按同一 `/:interviewId/<step>/confirm` 形状暴露。创建输入只允许 `{ name, tags, scope, requestId }`，不接收 `topic`。每一个确认请求都必须携带 `requestId` 与 `expectedVersion`；成功时恰好保存一个新版本。相同 `requestId` 和相同规范化 payload 的成功 replay 必须复用首次成功的 HTTP status 与业务正文：本 F04 create/confirm 的首次和 replay 都是 201；若平台附带动态 `traceId`，遮蔽它后正文相同。同 key 但 payload 改变返回 `IDEMPOTENCY_KEY_REUSED`，而不是覆盖或生成重复专家、问题、run 或报告。任何陈旧 `expectedVersion` 返回 `CONCURRENT_MODIFICATION`。

`getDigitalInterview` 是恢复的唯一读端口：刷新和进程重建都从 `GET /interviews/digital/:interviewId` 取得服务器的状态、当前步骤和版本。无权与不存在在该端口均为 404；将平台每请求生成的非空 `traceId` 遮蔽后，错误信封逐字节相同，两个 `traceId` 必须不同。共同信封不得包含 `reasonCode` 或被寻址的 interview id。

### Skill 建议的双层持久化

`sendDigitalInterviewSkillMessage` 立即把用户消息、助手消息和 proposal 持久化到 `POST /interviews/digital/:interviewId/skill/messages`；proposal 有 `proposalId`、目标步骤、建议内容与 `createdAt`。`applyDigitalInterviewSkillProposal` 只把建议应用到当前步骤的客户端 dirty buffer，不是写操作。只有对应步骤的显式 `confirm*` 才把已应用内容写入访谈并递增版本；取消/离开不应把未确认的 applied buffer 落库。

## 三、失败处理

- 专家目录、生成器或报告服务失败时保留当前输入和最后成功状态，并显示可重试错误；不渲染成空态。
- 单专家失败只产生该专家的失败 run；重试不得重跑已完成专家。
- 报告生成失败时素材仍可读，重新生成不得改变已确认问题和回答。
- 权限在操作中撤回时复用 `PERMISSION_REVOKED_MIDWAY`，并且目标资源信息不泄露。
- 模型失败日志只记录 interview、expert、operation 和 correlation id，不记录问题或回答正文。
- 所有报告与快捷/批量问答接口只输出探索性结果，不暴露写入强洞察、决策依据或组织晋升的动作。
- 操作未确认内容时离开步骤或页面，UI 必须请求用户确认放弃或继续编辑；选择继续编辑不得触发写入。
