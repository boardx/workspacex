# 与 Agent 工作台会话的开发边界

2026-09-07 用户提供另一 peer session 的工作台计划，并要求不重复开发。本文件是本批次的分工边界单源。75 项编号和验收要求保留；转交 peer 的实现不计作本批次新增开发，也不因计划已写就视为完成。

输入存档：[用户提供的计划](inputs/peer-agent-workbench-plan-2026-09-07.md)，SHA256 `03d86e34c260e3f132adefe860ef902a6de5a15d16c0c19e0843a58fdf7d80fc`。这是用户提供的快照，不代表 peer 当前代码、测试或发布状态。

## 从本批次移出的重复建设

以下采用 peer 的统一实现，本批次不另建相应表、writer、状态机或 UI：

- S2–S4：主 run/session/attempt 身份、状态与控制契约、持久事件 journal/cursor、活动快照、AG-UI/WS 回放、Thinking/Tool/Skill 过程投影。
- S3/S6：主会话消息队列、插话 FIFO、领取/ACK、主 run worker lease/fencing 与恢复。
- S5：主 run 停止/暂停/恢复、取消终态竞争、checkpoint 与 attempt 映射、父任务取消编排。
- S7–S9：计划与审批待处理区域、问题恢复、输入器、工作台布局、时间线、任务导航及站内提醒。
- S10/S12：成果工作区、预览入口、版本继续修改的用户旅程、旧聊天入口迁移及界面切换。

需要这些能力时调用现有或 peer 提供的统一契约。缺少已确认接口时保留集成待办，不自行猜出第二套接口。

## 按标准编号划分责任

| 编号 | 本批次继续交付 | 复用 peer 的交付 |
|---|---|---|
| WX-E002 | 能力元数据、来源、完整包与 sandbox 传输契约 | run/attempt/事件/控制公共契约 |
| WX-E003、T001–T008、T018 | 会话文件、官方 Backend、Node/Python 隔离、进程取消原语和资源释放 | 停止入口与主任务取消编排 |
| WX-E004、T010 | 完整 Skill 包、原生加载、子代理授权/文件范围 | Skill 时间线及子任务展示 |
| WX-E006 | native 执行结果、文件字节/元数据与既有产物入口适配 | 统一事件 writer、错误/终态、回放及 UI 交付状态 |
| WX-E007 | 每能力独特验证与证据 | S11 公共工作台 E2E；整合后复用共同证据 |
| WX-E008 | Skill/Backend 版本兼容和旧 Skill ID 映射 | 主 run/attempt 迁移、drain、恢复及工作台切换 |
| WX-T009 | write_todos 编号/来源映射及工具回归 | 计划账本投影、编辑与审批体验 |
| WX-T011–T013 | 具名工具复用；保留已提交的 T011 最小语义修正 | requestId 持久化、问题区域、审批恢复/并发控制与 UI 重构 |
| WX-T020–T021 | native 输出接既有存储/下载，验证字节与权限 | 成果事件、预览、版本继续修改与交付状态 |
| WX-T040 | 薄 wx_run_status 调用统一查询 | 权威 run 状态、快照与历史恢复 |
| WX-T041 | 薄 wx_run_cancel 工具和 sandbox 取消原语 | 主控制 API、取消状态、暂停/恢复、父子取消策略 |
| WX-T042 | 派生子任务 PG 队列、固定版本、权限/幂等、受限无工具执行及控制原语 | 父取消级联、统一子任务事件、站内提醒和展示 |

其他搜索、浏览器、SQL、记忆、调度、文档、数据分析及方法 Skill 继续由本批次实现；共享产物/控制/展示仍遵循上表。

派生子任务队列不是主会话下一轮消息/插话队列：`subtask_runs` 不承担主 run 重连、attempt 或 steering。当前子任务仅文本结果，文件产出及父取消仍待接入，不能称完整验收。

## 已发生的交叉改动

- `ac597acc5`（WX-T011）：`agent-interrupts.ts` assumptions 不再至少两条；`tools.py`/`graph.py` 与确认卡保持一致并补测试。没有重建审批、恢复或布局。peer 修改同一区域时保留这条语义，避免重新实现或恢复旧约束。
- `65327d7b1`（WX-E002）：新增 `standard-capabilities.ts`，未修改主 run 状态或事件 union。
- `7dcd2feaa`（WX-E004 API）：`PinnedSkillContent.package`、`readPinnedSkills` 全文件读取、`toWireSkills` fresh/resume 包传输属于本批次；与 peer 事件适配分别合并。
- 未提交的 WX-T042：`ports.ts` 仅增加受信任 `executionMode`；provider 仅投影该限制并统一 fresh/resume callback；Python selector 仅为后台文本任务选无工具图；`kernel.module.ts` 仅替换子任务 DI。主 run 账本、stream 事件和恢复关系不在这些修改中。
- `f26b931e1`（WX-E007）：仅修预算测试假模型，使独立 Rubric grader 不消费主脚本；生产 harness 未修改。

`ports.ts`、`deep-agent-model-provider.ts`、`pg-agent-run-repository.ts`、`kernel.module.ts`、`graph.py`/`harness.py` 是交叉文件。按上述符号/职责合并，不整文件覆盖另一会话，不借能力接线改造 peer 的控制平面。事件、控制及产物接入以最终共享 contracts 为准。

## 集成验收

本批次输出能力结果和取消原语；peer 映射为统一工作台事实。最终联合验证 native 文件内容/hash、失败不显示 ready、控制命令不重复取消、停止后不启动新工具，以及 ToolCall/子任务在实时流和回放中不重复。双方局部测试通过不等于集成链通过。
