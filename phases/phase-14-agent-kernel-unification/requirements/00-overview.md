# 原始需求（概览）— agent-kernel-unification（Phase 14）

## 背景

一次线上故障排查（用户提交 PDF 生成任务后刷新页面，前端卡死在"正在恢复上次未完成
的任务…"，同时出现 `SANDBOX_UNAVAILABLE` 误标错误）暴露出 `agent-run` 子系统更深
层的架构问题：执行内核分裂在 TypeScript 网关（`apps/api`）与 Python
`deep-agent-service`（LangGraph）两处、run 状态机终态定义不完整、传输层用轮询伪装
成流式、错误分类存在兜底误标。在此基础上系统性复盘了"若要把 agent-run 打造成类似
Claude Code 的通用 Agent"所需具备的能力差距，形成本 phase。

**前提：系统尚未上线，无生产流量。本 phase 的所有改动按一次性切换设计，不做灰度、
不保留新旧并行兼容层、不做存量数据迁移兼容写法。**

## 需求文件索引

按能力域拆分，建议阅读顺序：

1. `01-kernel-unification.md` —— 统一执行内核：干掉 TS/Python 双内核分裂，
   `apps/api` 退化为纯网关，全部规划/工具循环收敛到 `deep-agent-service`。
2. `02-streaming-transport.md` —— 真流式传输与状态机修复：替换轮询契约为
   WebSocket 真流，修复 run 状态机非终态判断缺失（含本 phase 的触发 bug）。
3. `03-plan-mode-permissions.md` —— Plan Mode 与分级权限：计划可见可编辑可确认、
   工具调用按风险分级授权。
4. `04-artifacts-steering.md` —— 产出物版本化与中途插话：生成的文件成为一等公民
   实体，用户可在执行中途插话重新引导。
5. `05-error-observability.md` —— 错误人性化与可观测性：错误分类修复、面向用户
   的可读错误与建议动作、完整可审计的执行 transcript。

## 全局约束（适用于以下所有需求文件，不重复声明）

- **单一事实源**：run 状态、计划、权限决策、产出物版本，各自只有一处存储，其余
  为订阅方，不允许派生副本。
- **单一执行内核**：`deep-agent-service`（LangGraph）是唯一的规划/工具循环/记忆
  执行者；`apps/api` 永远是网关（鉴权、run 生命周期 CRUD、工具执行代理、事件流
  转发、产出物存储），不得再长出第二套执行逻辑。
- **事件模型对齐 AG-UI 协议**：新增的流式事件 schema 需直接对齐 CopilotKit AG-UI
  协议原生事件类型，不自造平行格式，避免前端渲染层需要额外适配转换。
- **一次性切换**：本 phase 涉及的旧代码（轮询实现、TS 侧多余执行分支、灰度开关）
  在对应 feature 合入时直接删除，不保留兼容路径或长期存在的 feature flag。

## 本 phase 明确不包含（Out of Scope）

- 模型多 provider 路由/fallback 的具体算法实现（只要求预留接口位置）。
- Agent 自身质量评测/回归体系的具体 eval set 与打分标准（只要求预留 CI 钩子）。
- 并行工具调用的调度实现（只要求 LangGraph 图设计不阻塞未来接入）。
- 长期跨会话/跨 run 的项目级记忆机制。
- 多设备同时观看同一 run 的多端 UI 同步细节。
- 多用户协作编辑同一 Artifact。
- 已授权记录（"以后都允许"）的后台管理界面——查看/撤销/批量管理均不在本 phase
  范围；本 phase 只做单次/本run内/以后三档运行时授权的写入与生效判断。
- "无权限访问某 run"的前端空态页面——普通用户不会走到别人的 run，RBAC 由后端
  接口层拒绝（403）即可，前端只需正确处理该错误响应。

## 已澄清的设计决策（签核前的关键裁决，供各契约束引用）

- **权限授权档位**：三档——仅本次 / 本次 run 内都允许 / 以后都允许（组织同类
  操作运行时持久化，无后台管理界面）。详见 `03-plan-mode-permissions.md` R5。
- **审批类状态统一**：`awaiting_tool_permission` 是唯一的"工具调用需人工表态"
  状态，取代现状代码中的 `awaiting_approval`（旧名废弃，二者不并存）。详见
  `02-streaming-transport.md` R6、`03-plan-mode-permissions.md` R8。
- **"无权限"态**：不在本 phase 做前端空态页面，见上方 Out of Scope。
