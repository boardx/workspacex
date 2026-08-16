# Guided Research LangGraph · API 契约增量

## 1. 权威边界

- 唯一编排运行时：`apps/deep-agent-service` Guided Research StateGraph。
- `thread_id=sessionId`，`checkpoint_ns=guided-research:v1`，生产 PostgreSQL checkpointer。
- NestJS 从 Principal 派生 `orgId/actorId`，先鉴权业务 session，再调用 Graph port；浏览器不得提交租户、
  owner、checkpoint、NodeMeta 或 model ID。
- 生产模型固定 `KERNEL_GUIDED_RESEARCH_MODEL_ID=qwen3.7-plus`，结构不合法 fail closed。

## 2. 五个公开完整输入

- `brief`: `name,tags,topic,objective,timeRange,geography,focus`
- `directions`: 完整 `directions[] {id,title,description,enabled,order}`
- `outline`: 完整 `sections[] {id,title,description,researchQuestions,order}`
- `research`: 完整 `acceptedSourceIds,excludedSourceIds`
- `report`: `title,revisionInstruction`

每个 schema 为 strict，缺字段和未知字段均拒绝。公开 input 与服务端 Graph State 分离。

## 3. 统一命令

```text
POST /research/guided-sessions/:sessionId/workflow/nodes/:node
{ node, action, requestId, expectedGraphVersion, nodeState }
```

`node` 是 `brief|directions|outline|research|report`；`action` 是
`save|generate|confirm|start|retry|reconfirm|complete` 的封闭集合。每个 node/action 组合有白名单。

读操作：

```text
GET  /research/guided-sessions/:sessionId/workflow
GET  /research/guided-sessions/:sessionId/workflow/nodes/:node
GET  /research/guided-sessions/:sessionId/workflow/events?after=<cursor>
POST /research/guided-sessions/:sessionId/skill/messages
```

## 4. 幂等、并发与错误

- `operationId=sessionId:node:action:graphVersion:requestId`。
- command receipt 与外部 effect receipt 分离；只有 finalized command 可短路返回。
- 同指纹 pending 重放恢复 Graph，并复用已落盘 effect；不得二次调用模型或搜索。
- requestId 相同但 fingerprint 不同、stale graphVersion、非法跃迁、未来节点、模型/检索/schema 失败均使用
  契约封闭 reason code；409 返回最新安全 projection，不泄露跨租户存在性或 checkpoint 内容。
- 上游 reconfirm 创建新 revision，并按 brief→directions→outline→research→report 顺序使下游 stale。

## 5. 结构化生成与检索

Brief confirm → Directions；Directions confirm → Outline；Outline confirm → Research Plan；Research
complete → Report。模型调用使用 JSON object response format，再经共享 schema 校验。真实查询、URL、抓取、
重试和来源正文由独立 search/effect port 持久化；Graph State只保存稳定 ID、版本、任务和采纳决策。
