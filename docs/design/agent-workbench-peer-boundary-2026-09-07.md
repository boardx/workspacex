# 工作台与标准能力 peer 分工边界

2026-09-07 用户在本任务提供边界单并要求据此协作。本文记录本工作台实现遵循的边界；所列 peer commit 是用户提供的来源线索，未经本任务核对血统、测试和集成，不表示已合入或验收。

## 责任分配

- 本工作台任务负责 S2–S4 主 run/session/attempt、状态与控制契约、持久 journal/cursor、活动快照、流式回放和公开 Thinking/Tool/Skill 投影。
- 本任务负责 S3/S6 主会话队列、插话 FIFO、领取/ACK、主运行恢复；S5 停止/暂停/恢复、取消竞争、checkpoint/attempt 映射和父取消编排。
- 本任务负责 S7–S9 计划、审批、问答恢复、输入器、布局、时间线、导航与站内提醒；S10/S12 成果工作区、预览、版本继续修改和旧入口迁移。
- 标准能力 peer 负责搜索、浏览器、SQL、记忆、调度、文档、数据分析和方法 Skill。我们复用其能力结果和取消原语，映射为统一工作台事实，不重新开发工具实现。
- peer 的 subtask_runs 是派生子任务队列，不承担主会话下一轮消息、steering、重连或 attempt。其当前仅文本结果，文件产出和父取消待联合接入。
- 缺少双方确认的接口时记录集成待办，不创建第二套表、writer、状态机或展示契约。

## 交叉文件按符号合并

ports.ts、deep-agent-model-provider.ts、pg-agent-run-repository.ts、kernel.module.ts、graph.py/harness.py 不整文件覆盖。

| 用户提供的 peer 提交 | 应保留的职责与语义 |
|---|---|
| ac597acc5 / WX-T011 | assumptions 不要求至少两条；确认卡、tools.py/graph.py 与契约一致 |
| 65327d7b1 / WX-E002 | standard-capabilities.ts；不变更主 run 状态和事件 union |
| 7dcd2feaa / WX-E004 | PinnedSkillContent.package、完整 readPinnedSkills、fresh/resume toWireSkills 包传输 |
| 06d1e5cce / WX-T042 | 受信任 executionMode、provider 投影、fresh/resume callback、后台文本子任务无工具图与子任务 DI |
| f26b931e1 / WX-E007 | 预算测试假模型隔离 Rubric grader；不改生产 harness |

## Skill 事实来源与联合验收

call_skill 仅覆盖旧路径。官方 SkillsMiddleware 渐进读取完整包的新路径由 peer 提供真实加载记录、固定包版本及实际 ToolCall 关联，本任务的公共活动契约承载这些事实。读取 SKILL.md 不等于技能执行成功；不得为了 UI 计数增加模型调用。

联合待验：native 文件内容/hash；失败不显示 ready；控制命令不重复取消；停止后不启动新工具；ToolCall/子任务在实时流和回放中不重复。双方局部测试通过不等于联合链通过。

用户给出的上游输入存档引用为 inputs/peer-agent-workbench-plan-2026-09-07.md，SHA256 为 03d86e34c260e3f132adefe860ef902a6de5a15d16c0c19e0843a58fdf7d80fc；本任务未取得并验证该原文件，不能把该摘要当作当前代码证据。
