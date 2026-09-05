# 需求：统一执行内核

## R1 概览
- **Use Case 名称**：把 agent-run 的双进程执行内核收敛为单一内核
- **Actor**：系统内部（无直接终端用户操作，属于架构基础设施变更），间接影响所有
  发起 agent 任务的用户（如生成 PDF 的用户）
- **目标**：消除 `apps/api`（TS）与 `apps/deep-agent-service`（Python/LangGraph）
  两处并存的规划/执行逻辑，使新增能力只需改一处
- **系统边界**：`apps/api/src/application/agent-run/execute-run.ts`、
  `apps/deep-agent-service/src/deep_agent_service/*`、`packages/contracts/src/wave2-runtime.ts`

## R2 前置条件 / 触发条件
- **前置条件**：无（这是架构基础设施改造，作为本 phase 其它需求的地基，需最先完成）
- **触发条件**：本 feature 一旦排期开工即视为触发；不由用户操作触发

## R3 主流程
1. 网关收到用户发起的 agent 任务请求（如"生成一个 PDF"）。
2. 网关做鉴权/组织隔离校验后，通过内部 gRPC/HTTP 把 run 请求转发给
   `deep-agent-service`。
3. `deep-agent-service` 承担全部规划（`write_todos`）、工具调用循环、子代理委托、
   HITL 中断/恢复、checkpoint 保存。
4. `deep-agent-service` 中需要执行有副作用操作（写文件/跑命令等）时，通过工具调用
   协议请求网关代理执行（网关侧的权限判断见 `03-plan-mode-permissions.md`）。
5. 网关在现有沙箱基础设施中执行该工具调用，把结果回传给 `deep-agent-service`。
6. `deep-agent-service` 产生的事件（token/工具调用/计划变化/状态迁移）通过
   `astream_events` 实时转发给网关，网关旁路落账本并转发给前端（详见
   `02-streaming-transport.md`）。
7. `execute-run.ts` 全程只做：请求转发、鉴权、账本旁路写入——不做任何规划/重试
   策略决策。

## R4 备选流程与异常流程
- **备选流程**：
  - A1：`deep-agent-service` 不可用（服务未启动/网络故障）时，网关应在下发前做
    健康检查，快速失败并返回明确的服务不可用错误（不是让请求悬挂等超时）。
- **异常流程**：
  - E1：`deep-agent-service` 内部执行异常（如工具调用抛出未捕获异常），需要
    通过统一的事件类型（`status_change` → `failed`）通知网关，网关据此把 run
    标记为终态，不允许 run 卡在非终态且无任何执行方在推进。
  - E2：网关代理执行工具调用时沙箱本身故障（区别于模型/内核故障），错误分类需要
    准确标记为沙箱类错误，不与内核/模型错误混淆（呼应 `05-error-observability.md`
    的错误分类修复）。
  - E3：`execute-run.ts` 中原有的三条执行分支（`executeToolLoop`、
    `useLazySkillLoading` 伪循环、纯 `complete()` 单次调用）在本 feature 完成后
    必须被物理删除，不得以"默认关闭的开关"形式保留在代码库中。

## R5 权限与可见性
- 本需求不涉及终端用户可见的权限差异，属于内部系统边界重构。
- 网关是唯一有权决定"某个工具调用是否被允许执行"的组件（内核只能提出调用意图）。

## R6 后置条件 / 不包含
- **后置条件**：
  - `apps/api` 代码库中不存在任何独立的规划/工具循环实现。
  - 所有此前默认关闭的 `deep-agent-service` 能力开关
    （`DEEP_AGENT_SUBAGENTS_ENABLED` / `DEEP_AGENT_ASYNC_SUBTASKS_ENABLED` /
    `DEEP_AGENT_TASK_AUTO_CLASSIFY` / `DEEP_AGENT_PRECOMPLETION_CHECKLIST` /
    `DEEP_AGENT_HITL_TOOLS` / `DEEP_AGENT_CHECKPOINT_DB`）默认开启，且开关本身
    在验证稳定后应被移除（不作为长期存在的配置项）。
- **不包含**：
  - 新增真实工具集（bash_exec/read_file/write_file/edit_file/grep/web_fetch）的
    具体接线属于本需求的直接依赖，但工具集的权限分级逻辑在
    `03-plan-mode-permissions.md` 中定义，本文件只定义"工具调用要经过网关代理"
    这一机制。

## R7 业务规则
- 任何新增能力，不允许在 `apps/api` 侧重新实现一份"简化版"规划/循环逻辑作为过渡
  或降级方案——这正是历史上反复出现分裂的原因，本次必须杜绝。
- `execute-run.ts` 完成本需求后代码行数应显著下降（作为退化为"薄网关"的可验证信号）。

## R8 界面线索
- 本需求无直接前端界面（纯后端架构重构），不涉及 UI 变更。

## R9 非功能约束
- 性能/规模预期：网关到内核的内部调用延迟应对最终事件转发延迟影响可忽略
  （具体阈值见 `02-streaming-transport.md` 的 < 500ms 端到端标准）。
- 安全/隐私/合规：工具调用的执行权始终在网关侧（沙箱隔离），内核不得绕过网关
  直接执行任何有副作用的操作。
- 兼容与降级要求：无（一次性切换，不保留旧路径）。

## R10 已知约束 / 依赖
- 依赖现有沙箱执行基础设施（`run-skill-script.ts` 依赖的沙箱容器隔离能力）。
- 依赖 Postgres 作为 LangGraph checkpointer 的存储后端（复用现有数据库）。
- 技术约束：`deep-agent-service` 基于 deepagents 0.7.6 / LangGraph，本需求不更换
  该技术栈，只改变其能力的默认启用状态与网关的转发/代理职责。

## R11 切分提示
- 建议拆分为至少两个 feature：(a) 网关转发+账本旁路写入改造与旧分支删除；
  (b) 灰度开关默认开启+移除开关本身的验证。二者有顺序依赖，(a) 需先行。

## R12 AI Ready 验收线索
- 可验证：`apps/api` 静态扫描不存在独立规划/工具循环符号；`execute-run.ts` 行数
  对比改造前显著下降；`deep-agent-service` 全部列出的开关在配置中默认为开启状态
  且无用户可感知的行为倒退；端到端跑一个真实任务（如生成 PDF），全链路经过网关
  转发到内核执行并正确回传结果。
