# 需求：真流式传输与状态机修复

## R1 概览
- **Use Case 名称**：把 agent-run 的轮询传输替换为真流式，并修复状态机导致的
  "恢复卡死" bug
- **Actor**：终端用户（发起 agent 任务、刷新页面后期望看到正确的恢复状态）
- **目标**：用户提交任务后，无论是否刷新页面/断线重连，都能实时看到 agent
  执行的每一步，且任何非终态都有对应的可交互 UI，不会永久停留在 loading
- **系统边界**：`apps/api/src/application/agent-run/agui-bridge.ts`、
  `apps/web/lib/copilotkit-v2-run-restore.ts`、`apps/web/lib/agent-run.ts`、
  `apps/web/components/chat/copilotkit-v2-panel-body.tsx`、
  `packages/contracts/src/wave2-runtime.ts`

## R2 前置条件 / 触发条件
- **前置条件**：`01-kernel-unification.md` 的网关转发机制已就绪（本需求依赖
  网关能直接订阅内核的 `astream_events`）。
- **触发条件**：用户发起任意 agent 任务；或用户在任务执行期间/执行后刷新页面、
  切换设备、经历网络断线。

## R3 主流程
1. 用户发起任务，网关下发 run 请求给内核，同时与前端建立 WebSocket 长连接。
2. 内核产生事件（`token_delta`/`tool_call_start`/`tool_call_end`/`plan_update`/
   `status_change`/`checkpoint_saved`）即时通过网关转发给前端，事件产生到前端
   收到的端到端延迟低于 500ms。
3. 前端根据事件实时渲染执行进度，不依赖任何定时轮询。
4. 用户中途刷新页面：前端重新建立 WebSocket 连接时携带最后已知的事件序号/
   checkpoint 标识，网关从 `deep-agent-service` 的 checkpointer 中补发断点之后
   的事件，前端无损接续渲染（不丢事件、不重复）。
5. run 到达终态（`succeeded`/`failed`）后，前端渲染最终结果，连接可正常关闭。

## R4 备选流程与异常流程
- **备选流程**：
  - A1：用户在另一台设备/标签页打开同一个 run，应能通过同样的订阅机制看到
    一致的实时状态（不要求多端同步 UI 细节，仅要求数据一致，多端 UI 同步细节
    不在本 phase 范围）。
- **异常流程**：
  - E1（本 phase 的直接触发 bug）：run 停在非终态（`awaiting_approval` /
    `awaiting_plan_confirmation` / `awaiting_tool_permission` / `paused`，后三者
    随 `03-plan-mode-permissions.md`/`04-artifacts-steering.md` 引入）时，前端
    必须渲染对应的可交互 UI，绝不能停留在无操作可做的纯 loading 状态。这是本
    phase 的回归验收基线用例。
  - E2：WebSocket 连接异常断开，前端应在有限次数内自动重连，重连成功后无损接续
    （见 R3 步骤 4）；重连持续失败时，应明确提示用户"连接中断，请手动刷新"，
    而不是无声地停留在旧状态。
  - E3：内核进程崩溃或长时间无响应且未产生任何事件，网关应有超时判定机制，将
    run 标记为失败终态（而不是让 run 无限期停留在 `running`）。
  - E4：一个用户消息触发的任务需要多次续跑（如断线后从 checkpoint 恢复执行），
    不应因为"一条消息只能对应一个 run"的旧约束而无法表达——需要放开该唯一性约束，
    改为一个逻辑 run 可有多次续跑记录，仍映射到同一条用户消息。

## R5 权限与可见性
- 本需求不涉及角色差异，任一发起任务的用户都应获得实时流式反馈与正确的断线恢复。

## R6 后置条件 / 不包含
- **后置条件**：
  - `wave2-runtime.ts` 的轮询契约（"§5 轮询"）整体作废；`agui-bridge.ts` 的
    `readModelDeltas`/`readAgentRun` 定时轮询实现被删除。
  - 前端 `copilotkit-v2-run-restore.ts` 中"20 分钟轮询预算 + gave-up 兜底"逻辑
    被删除，替换为基于 WebSocket 订阅+checkpoint 续接的恢复机制。
  - `apps/web/lib/agent-run.ts` 的 `isTerminalRunStatus` 覆盖全部非终态
    （`awaiting_approval`/`awaiting_plan_confirmation`/`awaiting_tool_permission`/
    `paused`），且每个非终态在前端都有对应渲染分支（不是简单地"判断为非终态就
    继续 loading"）。
- **不包含**：
  - 多设备同时观看同一 run 的多端 UI 交互同步细节（如一端操作另一端联动）不在
    本需求范围，只保证数据一致可订阅。

## R7 业务规则
- 新增的流式事件 schema 必须直接对齐 AG-UI 协议原生事件类型，不自造平行格式。
- 落库（账本写入）与推流（前端事件转发）必须解耦：落库是审计/恢复用的旁路
  fire-and-forget 写入，不是前端获取状态的路径。
- 不允许任何形式的"轮询兜底"残留在代码库中，包括被注释掉但未删除的代码。

## R8 界面线索
- 断线重连提示：轻量提示"连接已恢复，继续显示实时进度"，不需要用户操作，自动
  消失。
- 执行进度流的实时渲染细节见 `03-plan-mode-permissions.md`/
  `04-artifacts-steering.md` 中定义的具体界面单元；本需求只保证事件能够实时
  到达前端。
- 参考截图：待 UI 先行阶段产出（`ui-preview/`）。

## R9 非功能约束
- 性能/规模预期：事件端到端延迟 < 500ms（不含用户网络本身延迟）；断线重连应在
  数秒内完成，不应有明显感知的数据丢失。
- 安全/隐私/合规：WebSocket 连接需复用现有鉴权机制，不因传输方式变化而降低
  访问控制强度。
- 兼容与降级要求：无（一次性切换，前后端同步部署新协议，不保留旧轮询兼容层）。

## R10 已知约束 / 依赖
- 依赖 `01-kernel-unification.md` 完成的网关-内核转发链路。
- 依赖 checkpointer 默认开启（`01-kernel-unification.md` 范围）作为断线重连的
  数据来源，没有它无损续接无法实现。
- 依赖 CopilotKit CoAgents 特性对 LangGraph 执行状态流的原生支持。

## R11 切分提示
- 建议拆分为：(a) 网关 WebSocket 端点 + 事件转发 + 落库解耦；(b) 前端订阅改造
  （删除轮询、断线重连、终态判断修复）；(c) 数据模型变更（放开"一消息一 run"
  约束）。(a) 需先于 (b)，(c) 可与 (a) 并行。

## R12 AI Ready 验收线索
- 可验证：注入已知时间戳的事件，测量端到端延迟 < 500ms；静态检查确认轮询相关
  代码已删除；模拟四种非终态各自的 E2E 测试，断言渲染对应 UI 而非无限 loading；
  固化本 phase 触发 bug 的回归用例（run 停在 `awaiting_approval`，刷新后 5 秒内
  渲染审批 UI）；模拟断连恢复，比对事件序列一致（不丢不重复）。
