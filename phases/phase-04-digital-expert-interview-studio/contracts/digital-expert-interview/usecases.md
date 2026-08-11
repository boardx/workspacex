# 契约束 `digital-expert-interview` — 用例接口与失败模式

## 一、应用端口

| 操作 | 输入 | 成功结果 | 主要失败 |
|---|---|---|---|
| `listDigitalInterviews` | scope, status filter | 历史卡投影 | `NO_INTERVIEW_ACCESS`, `DEPENDENCY_UNAVAILABLE` |
| `listDigitalExperts` | domain filter | 可用专家投影 | `DEPENDENCY_UNAVAILABLE`（不得伪装空列表） |
| `createDigitalInterviewDraft` | name, tags, topic | `draft` | `DIGITAL_INTERVIEW_INPUT_INVALID` |
| `confirmDigitalInterviewTopic` | interviewId, version | `experts_pending` + candidates | `DIGITAL_INTERVIEW_STEP_INVALID`, `AI_GENERATION_UNAVAILABLE`, `CONCURRENT_MODIFICATION` |
| `updateDigitalInterviewExperts` | add/remove ids, version | candidate set | `DIGITAL_EXPERT_REQUIRED`, `DIGITAL_EXPERT_NOT_AVAILABLE`, `CONCURRENT_MODIFICATION` |
| `confirmDigitalInterviewExperts` | interviewId, version | `questions_pending` + per-expert questions | `DIGITAL_INTERVIEW_STEP_INVALID`, `AI_GENERATION_UNAVAILABLE` |
| `updateDigitalInterviewQuestions` | expertId, mutations, version | per-expert questions | `DIGITAL_QUESTION_EXPERT_INVALID`, `CONCURRENT_MODIFICATION` |
| `startDigitalInterviewRuns` | interviewId, version | run list | `DIGITAL_INTERVIEW_STEP_INVALID` |
| `retryDigitalExpertRun` | interviewId, expertId | one updated run | `DIGITAL_EXPERT_RUN_NOT_FAILED`, `DEPENDENCY_UNAVAILABLE` |
| `generateDigitalInterviewReport` | interviewId, version | traceable report | `DIGITAL_REPORT_NOT_READY`, `DIGITAL_REPORT_SOURCE_INVALID`, `AI_GENERATION_UNAVAILABLE` |
| `startQuickDigitalInterview` | expertId | persisted quick interview | `DIGITAL_EXPERT_NOT_AVAILABLE` |
| `convertQuickInterviewToBatch` | quickInterviewId, editable metadata | draft with source reference | `NO_INTERVIEW_ACCESS`, `DIGITAL_INTERVIEW_INPUT_INVALID` |

`listDigitalExperts` 与主题确认时的专家候选都通过 `DigitalExpertCatalogPort` 消费现有 Agent Definition 与 Context Pack；返回并保存 `DigitalExpertSnapshot`，不创建或修改组织级专家对象。

## 二、HTTP 面

受保护路由统一挂在既有 interview 控制器边界下；准确路径由 `packages/contracts/src/interview.ts` 导出，Web 客户端不得手写第二套响应类型。至少覆盖：列表、详情、创建/保存、确认主题、专家增删确认、问题增删改确认、运行/单专家重试、报告生成、快捷访谈与转批量。

所有写操作携带 `version` 或等价条件更新；重复提交要么幂等返回同一结果，要么返回既有 `CONCURRENT_MODIFICATION`，不得生成重复专家、问题、run 或报告。

## 三、失败处理

- 专家目录、生成器或报告服务失败时保留当前输入和最后成功状态，并显示可重试错误；不渲染成空态。
- 单专家失败只产生该专家的失败 run；重试不得重跑已完成专家。
- 报告生成失败时素材仍可读，重新生成不得改变已确认问题和回答。
- 权限在操作中撤回时复用 `PERMISSION_REVOKED_MIDWAY`，并且目标资源信息不泄露。
- 模型失败日志只记录 interview、expert、operation 和 correlation id，不记录问题或回答正文。
- 所有报告与快捷/批量问答接口只输出探索性结果，不暴露写入强洞察、决策依据或组织晋升的动作。
