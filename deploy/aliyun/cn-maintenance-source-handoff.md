# CN 维护发布源码交接（#5221，同一迭代）

唯一源码分支 `worker/cn-release-5221-operational-recovery`，base/tool 来源 `64cc2b85053823a4c7461eb404b9f3a99c749a33`；已保全正常 commit `6bcaa36e1`。应用固定 `9b25bfa65662b96c0826fe67506b562ea46aa6d0`，基线固定 `ba6343199f3c834d6a198f83d0c771614292c82b`。#5226/#5237 为已合入来源，不按模块另开 PR。

源码已接实际消费者：固定六镜像离线 inspect（本机 socket/空受保护 Docker config）、三库恢复 prehold audit、同一持久 control/diagnostic 会话、固定 9b 算法迁移、只读 provider producer/完整响应验证、completion intent→验证→原子 exclusive receipt→durable journal、指针/服务/三库恢复优先的激活动作、真实只读 canonical 与六条浏览器业务源码。空 registry 已移除。异常事务/未知状态保留 FD9；角色封锁后不重新建立 DDL 连接。

Independent review subsequently found and this same iteration fixed: incomplete closed role admission, baseline API-dependent drain after fencing, unproved writesHeld=true in recovery errors, machine-specific bundle paths, and a stale preactivate invocation assertion. Each fenced role now requires NOLOGIN and exact per-cluster map closure; actual role-observation negative fixtures reject omitted/manual/open/reopened roles. Drain uses the sealed diagnostic connection with pre/post barrier checks, exact session/hold generation and freshness binding. No API unpause/new DB connection is used. Recovery error and journal write state remain unproven without a fresh successful guard.

Canonical draft PR: https://github.com/boardx/workspacex/pull/5247 . Normal push hooks passed 9/9; source wrapper includes all Node/Python pure fixtures, 11 acceptance boundary cases, 30 Python fence/probe tests, 31 recovery executor cases, and 14 bootstrap regression cases. Exact-head CI must complete and independent review must accept before any merge; local success does not imply CI green.

当前发布不可执行：所有写入者停写/NOLOGIN 与实际 hello/ASR/Skill/PDF 写入验收存在顺序冲突。默认入口在任何锁/hold/DB/指针动作前精确拒绝 `MAINTENANCE_ACCEPTANCE_WRITER_LANE_NOT_IMPLEMENTED`。两种具体流程与恢复责任见 `cn-maintenance-acceptance-decision.md`；不能用私有 flag 改为 ready。

剩余工程/证据边界：共同快照与 backup-time 对象闭包、完整原始目录/ACL/RLS/AGE/数据 hash 的独立恢复证据；真实 root-private 输入/权限/Node-pg 与浏览器运行时闭包；所有安装目标的 fresh provider inventory；六个 immutable images 的 seal/prepare；真实恢复及停写演练；明确风险批准和最终公开 commit/health/login/六流程验收。当前缺这些，不提供上线 ETA。前述 90–180 分钟只估本轮源码审阅候选，不估生产完成。

本轮没有连接数据库、启动服务/容器、恢复/解密/传输数据、安装生产工具、创建权限、迁移、停机或切流。原始 DevOps 与其他已取消会话未重启。所有源码 worker 已停写；后续只在本分支推进一个 direct-main draft PR，保持未 ready、不自动合并。

The legacy held preactivate collector still starts bootstrap containers/new connections. Its consumer now rejects before invocation with MAINTENANCE_HELD_PREFLIGHT_CONSUMER_NOT_IMPLEMENTED. A real held diagnostic preactivate replacement remains source work. Recovery producer/validator/prehold positive closure remains incomplete, as explicitly described in cn-maintenance-recovery-collection-plan.md. No dummy positive receipt is used to clear either gate.
