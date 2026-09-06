# 工作台与 Tools/Skills 接线契约 v1

面向标准能力 peer。职责边界以 [peer 分工单](agent-workbench-peer-boundary-2026-09-07.md) 为准；本文仅记录可调用入口、版本与验证证据，不定义第二套能力状态机。

## 可集成版本

分支：`codex/agent-workbench-upgrade`。以下均已提交到本地独立 worktree，尚未合入 main；最终共用一个 PR，目前 PR 未创建。不能把本文件当作 main 或已部署版本的声明。

| 单元 | 提交 | 导出 / 入口 |
|---|---|---|
| 公共 Skill 事实、真实调用身份、去重与投影 | `c11d77f57` | `@repo/contracts/skill-activity`：`SkillActivityFact`、`SkillActivityStream`；`@repo/contracts/execution-journal`：`ExecutionEvent`、`ExecutionEventInput` |
| 停止后不启动新工具或脚本重试 | `c170a1594` | Python `run_control._values`；API `maybeRunSkillScript` 的 `cancelAtCheckpoint` |
| 父取消与工具执行检查接点 | `78543a6b2` | `ParentRunControl`、`ChildRunCanceller`、`ToolExecutionAuthority`；单次审批精确绑定仍待后续提交 |
| 子取消确认展示 | `6420a3681` | GET/POST 的 `childCancellation`，独立提示与退避读取 |
| 主运行恢复与 fencing | `1db6a178f` | `run-lease.ts`、`PgRunRecovery`、同线程串行领取 |

## Skill 事实进入统一 journal

内部 TypeScript writer：`AgentRunStore.appendExecutionEvent(orgId, runId, event)`，生产实现为 `PgAgentRunRepository.appendExecutionEvent`。DI token 为 `AGENT_RUN_STORE`。它不是浏览器可调用的写事件 API；不得将用户请求中的 org/run/attempt 原样当作可信上下文。

主执行器为 `ModelCallInput.onSkillActivity(fact)` 注入闭包，用本轮可信 `orgId`、`runId`、`executionAttemptId` 调用 writer。Python peer 在真实事实产生位置使用 LangGraph custom stream：

```python
from langgraph.config import get_stream_writer

get_stream_writer()({
    "type": "skill_activity",
    "version": 1,
    "fact": {
        "contractVersion": 1,
        "factId": "<同一事实重连和恢复时稳定的 ID>",
        "stage": "body_read",
        "skillId": "<固定 skill ID>",
        "skillStableName": "report",
        "skillVersion": "<固定版本 ID>",
        "packageDigest": "<64 位小写 SHA256>",
        "readPath": "/skills/report/SKILL.md",
    },
})
```

provider 的 fresh 和 resume 均请求 `messages-tuple`、`updates`、`custom`。`DeepAgentModelProvider` 严格验证 custom envelope 后等待回调持久化；写入失败不得伪装为成功接收。事实内容不接收 orgId、runId、attemptId 或任意扩展字段。

| stage | 附加字段 | 含义 |
|---|---|---|
| `metadata_discovered` | 无 | 发现固定技能的元数据，不表示读取正文或执行 |
| `body_read` | 必须 `readPath` | 实际读取正文；界面以中性“读取技能正文”展示，不显示执行成功 |
| `execution_started` | 必须真实 `toolCallId` | peer 已确认技能执行开始 |
| `execution_succeeded` | 必须真实 `toolCallId` | peer 已确认该执行成功 |
| `execution_failed` | 必须真实 `toolCallId`、安全 `errorCode` | peer 已确认执行失败；不接收堆栈或秘密作为错误码 |

writer 以 `(orgId, runId, factId)` 去重，在已有 run 行锁内原子处理：相同 fact 重发是 no-op，不增加 seq；相同 factId、不同内容抛出 `SKILL_ACTIVITY_FACT_CONFLICT`。恢复时保留同一事实的 factId，不为重放生成新 UUID。不同阶段是不同事实，应有不同 factId。跨 attempt 的重复事实保留首次记录的 attemptId。

统一读入口继续是 `GET /agent-runs/:runId/execution-events?afterSeq=N`，走既有会话可见性授权；AG-UI 以 `CUSTOM(name="execution_event")` 投影同一 journal。客户端以 run/seq 去重，读取正文不会被转换为成功事件。旧 `call_skill` 仅显示工具调用结果，不证明新路径的 Skill 执行成功。

工具 start/end 新增可选 `sourceToolCallId` 保存上游真实调用 ID。界面按 run + sourceToolCallId 合并跨审批 attempt 的同一次调用，并保留尝试记录；缺少该字段的历史事件使用原身份，不按工具名合并。

## 父取消与工具执行检查

### 父取消接点

`apps/api/src/application/agent-run/parent-run-control.ts` 导出 `PARENT_RUN_CONTROL`、`CHILD_RUN_CANCELLER`、`ParentRunControl`、`ChildRunCanceller`、`ParentCancellation`。peer 在 API Nest DI 注册 `CHILD_RUN_CANCELLER` adapter，实现：

```ts
cancelChildren(input: ParentCancellation): Promise<ChildCancellationResult>;
readCancellation(input: ParentCancellation): Promise<ChildCancellationResult>;
// input = { orgId, parentRunId, requestId }
// result = { kind: "unavailable" }
//        | { kind: "pending", runningChildIds: string[] }
//        | { kind: "confirmed" }
```

`AgentRunController.cancel` 先完成现有用户/组织/线程权限验证和 `requestCancellation` 持久写入，再调用 `ParentRunControl.propagateCancellation`。可信 orgId、parentRunId、首次 cancel_requested_at 来自受 RLS 保护的数据库；requestId 为该三元组的 SHA256，重试使用相同标识。peer 不应把浏览器提供的子任务列表当作取消范围，应按这两个可信父标识原子筛选自己的子任务。

`confirmed` 必须表示该父范围内没有尚在运行或待运行的子任务。首批仅原子取消 pending 时，有 running 就返回 pending，不能返回 confirmed。远端 abort 已发出也不等于停止已确认。未安装 adapter 或 adapter 抛错返回 unavailable；不会覆盖已接受的父取消或把它误报为全停。

父 `POST /agent-runs/:runId/cancel` 和授权 `GET /agent-runs/:runId` 返回 `childCancellation`。未申请父取消为 not_requested。GET 调用 adapter 的只读 readCancellation；不得借 GET 重发取消。UI 独立显示待确认状态，退避读取；父任务终态不被子确认状态冒充或覆盖。

### 工具开始前检查

内部 HTTP：`POST /internal/agent-runs/:runId/tool-execution/check`；请求头 `x-deep-agent-internal-key` 复用 `DEEP_AGENT_SERVICE_INTERNAL_KEY` 的既有服务鉴权。缺失/错误 key 返回 401，严格 payload 验证失败返回 400。内部 TS 服务是 `TOOL_EXECUTION_AUTHORITY` → `ToolExecutionAuthority.check`。

```json
{
  "orgId": "<可信 callback.org_id>",
  "attemptId": "<可信 callback.attempt_id>",
  "leaseEpoch": 1,
  "toolName": "read_file"
}
```

`call_skill` 还须提供 skillStableName。Python 从可信 `configurable.run_control_callback` 读取 base_url、key、org_id、run_id、attempt_id、lease_epoch；fresh/resume 均由主执行器及 provider 投影，不接受模型参数覆盖这些字段。

输出为 allowed:true 或 allowed:false + reason（run_unavailable、cancel_requested、lease_lost、attempt_stale、skill_not_mounted、approval_required）。服务同时核对真实 run 状态、取消标记、epoch/有效期和真实 context_built 对应 attempt；租约只是其中一个条件。风险和 L2 grant 复用 `classifyToolCallRisk`、固定 `readPinnedSkills` 及 `ToolPermissionGrantStore`。

**当前版本限制**：L0/L1 与已有持续 grant 路径可用；78543a6b2 对新原生路径的“仅本次”审批保守返回 approval_required，不能冒用为已接通。精确 permissionRequestId + ToolCall + 参数 hash 的单次消费绑定正在补齐，完成后在本表登记新提交。旧 HITL resume 路径继续保留。

该检查只授权当前 dispatch 边界，不是可长期复用的许可，也不替代工具自己的文件、SQL、MCP 等资源 ACL。peer 应紧邻执行调用；不能检查一次后永久缓存 allowed。实际 ToolCall 执行幂等及远端停止确认仍由工具/子任务 owner 提供。

## 已有证据与联合验收边界

- `c11d77f57` 提交前对应工作树：`execution-journal-pg.test.ts` 15 项通过，含 8 个并发 writer 同事实去重、冲突和跨组织隔离。
- Skill 入口纯测试覆盖真实 custom 字节接收、fresh/resume stream mode 与失败传播；该单元报告 12 项通过。
- 前端 Skill 事实、时间线及折叠测试 11 项通过；正文读取没有成功标记，同源 ToolCall 跨 attempt 合并，不同同名调用保留。
- `c170a1594`：Python 取消边界 8 项、API 脚本取消 2 项通过。
- 尚未联合验收真实 SkillsMiddleware 事实来源、native 文件 bytes/hash、pending 子任务原子取消、running 远端停止确认及迟到结果。测试替身和局部通过不替代这些证据。

- 父取消与权限接点：PG 3 项通过（真实 context attempt、过期 epoch、跨租户、首次取消身份）；后端目标 22 项通过；子取消 UI 7 项通过。仍不等于 peer adapter 联合验收。
