# AIDT 原子受理交接

本轮用户明确批准上下文桥接，root 在统一 init 退出 0 后分配 A1 修改受理层。历史设计页的待签核 frontmatter 未被修改；这份记录不代签设计文件。

## 已实现

- 使用新合同的严格 selector 与单源 canonical JSON 计算 SHA256，客户端不提供可信 hash 或材料正文。
- 外层 `findAccepted` 和事务内 advisory-lock replay 均比较原文、Agent、selectorHash；ordinary/null 与 AIDT 互换冲突。AIDT 同时比较附件集合，不给旧 run 添加新附件。
- `PgChatMessageCommandRepository` 第三个可选依赖为 A2 `AidtMessageAcceptancePort`。没有 selector 且没有旧 marker 时不调用该端口；selector 存在但依赖缺失时失败关闭。
- `prepareIn` 使用受理仓储传入的同一 `TenantSession`，由 A2 按 project → org/member → thread 锁定和授权。A1 后续线程锁只重入，并再次检查实际 project 与 archived 状态。
- 准备结果的 selector hash、snapshot focus 与授权池交叉核对。仅 general scope 可进入；最终实际 `agent_runs.skill_version_ids` INSERT 为单一 verified focus，原 Agent/AgentVersion 不替换。
- 消息、首次带 marker 的 queued run、材料快照、accepted step 与附件均在原 `withTenant` 事务内完成；准备或保存快照失败时整体回滚，提交后才有 kick。
- AIDT 快路径和事务 replay 重验当前权限与原来源，不重读新 head、不重新准备、不起名、不重复 kick，返回 `reused:true`。普通 Chat 保留原有 queued-run 恢复 wake-up。

## 真实验证及边界

初始 13 项反例为 11 failed / 2 passed；修复后新增受理 28 项与普通 Skill 解析 15 项共 43/43 通过。局部 TypeScript 检查与 diff check 退出 0，见同目录 red/green/typecheck 日志与 `context-atomic-validation.json`。

本测试使用真实应用用例及 Pg adapter，事务协议由可回滚内存 session 记录；没有启动数据库、模型或 API。它证明受理分支和 session 传递，不代替 PostgreSQL 约束或模型接收材料的事实。A6 正负责独立真实 PG → claim → provider messages → receipt 验收。

root 需将 `AIDT_MESSAGE_ACCEPTANCE` 注入 Pg adapter 第三参数；A3 迁移须正常应用后才支持新 marker 列。源码未由 A1 提交。

## 冲突码跟进

root 随后授权把 AIDT 相关的两层冲突统一为 `AidtContextError("AIDT_CONTEXT_CONFLICT")`，普通 Chat 旧错误类/仓储 conflict outcome 不变。新增封闭码反例先得到 10 failed / 35 passed，修复后 3 文件 45/45 通过（30 受理、15 普通解析），见 `context-atomic-conflict-*.log`。

transport 保持 root/A3 的窄决定：fresh 有 selector 可以在 SSE 前实际 HTTP409；旧 AIDT 同 ID 去掉 selector 的 incoming ordinary 请求仍使用既有 SSE，显式 `RUN_ERROR IDEMPOTENCY_CONFLICT` 拒绝。此处只证明受理层抛准确闭码，实际 HTTP/SSE 投影由 A3 验证。

已向 root/A4 单独提示：旧 busy-message queue 没有保存 selector 的字段，AIDT 宿主不得静默排队成普通无上下文 run；本次 A1 未扩队列协议。
