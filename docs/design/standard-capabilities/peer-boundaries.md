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

派生子任务队列不是主会话下一轮消息/插话队列：`subtask_runs` 不承担主 run 重连、attempt 或 steering。当前子任务仅文本结果；父取消阻断 pending 子任务和晚到入队已在 4ef787b83 接入，文件产出、running 远端取消与公共事件仍待完成，不能称完整验收。

## 已发生的交叉改动

- `ac597acc5`（WX-T011）：`agent-interrupts.ts` assumptions 不再至少两条；`tools.py`/`graph.py` 与确认卡保持一致并补测试。没有重建审批、恢复或布局。peer 修改同一区域时保留这条语义，避免重新实现或恢复旧约束。
- `65327d7b1`（WX-E002）：新增 `standard-capabilities.ts`，未修改主 run 状态或事件 union。
- `7dcd2feaa`（WX-E004 API）：`PinnedSkillContent.package`、`readPinnedSkills` 全文件读取、`toWireSkills` fresh/resume 包传输属于本批次；与 peer 事件适配分别合并。
- `06d1e5cce`（WX-T042 增量）：`ports.ts` 仅增加受信任 `executionMode`；provider 仅投影该限制并统一 fresh/resume callback；Python selector 仅为后台文本任务选无工具图；`kernel.module.ts` 仅替换子任务 DI。主 run 账本、stream 事件和恢复关系不在这些修改中。
- `f26b931e1`（WX-E007）：仅修预算测试假模型，使独立 Rubric grader 不消费主脚本；生产 harness 未修改。

`ports.ts`、`deep-agent-model-provider.ts`、`pg-agent-run-repository.ts`、`kernel.module.ts`、`graph.py`/`harness.py` 是交叉文件。按上述符号/职责合并，不整文件覆盖另一会话，不借能力接线改造 peer 的控制平面。事件、控制及产物接入以最终共享 contracts 为准。

## 集成验收

特别需要对齐 Skill 活动来源：peer 输入计划以 `call_skill` 为当前展示来源；它适用于旧路径。本批次目标是官方 SkillsMiddleware 渐进读取完整包，新路径不保证每个 Skill 都调用旧 `call_skill`。应根据真实加载记录、固定包版本与实际 ToolCall 关联做展示；不得为了 UI 计数保留多余模型调用，也不得把读 SKILL.md 算作技能已经执行成功。公共活动字段由 peer 的统一契约承载，本批次提供来源事实。

本批次输出能力结果和取消原语；peer 映射为统一工作台事实。最终联合验证 native 文件内容/hash、失败不显示 ready、控制命令不重复取消、停止后不启动新工具，以及 ToolCall/子任务在实时流和回放中不重复。双方局部测试通过不等于集成链通过。

## 直接任务协作（2026-09-07）

用户已授权本任务与「agent ux dev」通过任务消息直接协作；只在真实接口依赖或文件冲突时发送，不做周期性互相唤醒。对方 task ID 为 `01a07700-7c3c-7402-9855-d7dc9f9fcf5e`。最近已收到对方 PR #2890 / a47ef0a55 的状态消息；这是对方报告的快照，并非当前 CI 或部署证明。

已集成 peer 的 446b03557（同参数 deny 优先级）与 d78a0790d（取消优先的原子暂停结算），本分支对应 1eb5f732c、a8d47eb89。原生暂停结算被取消抢先后的 session 释放由 50b9d9a40 补齐。另有本分支 1db33275d 将 `findRequesterUserId` 收紧为同线程 human 消息；合并该共享查询时应保留此约束。

后续任务消息工具返回 `Transport closed`，不能认定下列问题已送达或对方已承诺实现；不重复发送无内容变化的请求：

- running 子任务远端取消与公共事件接入：需要实际接口与验收证据，现有 pending 取消不能标为 running 已停止。
- W13 授权撤销/执行失败的站内通知：调度适配器需要现有提醒发布入口及稳定 `factId` 去重语义。只读检查尚未找到该入口；未另建邮件或通知表。
- MCP 固定授权快照：本分支已确认现有 review 只有记录、未形成可执行不可变快照，正在补齐本模块执行适配；不会把空 tool policy 当成全部授权。

消息通道恢复后，优先给对方已推送的整合 SHA / PR 和上述实际待答接口；不把未推送工作树当作可直接整合的交付。
