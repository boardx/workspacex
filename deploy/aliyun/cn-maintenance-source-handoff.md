# CN 维护发布源码交接（#5221，同一迭代）

唯一源码分支 `worker/cn-release-5221-operational-recovery`，base/tool 来源 `64cc2b85053823a4c7461eb404b9f3a99c749a33`；已保全正常 commit `6bcaa36e1`。应用固定 `9b25bfa65662b96c0826fe67506b562ea46aa6d0`，基线固定 `ba6343199f3c834d6a198f83d0c771614292c82b`。#5226/#5237 为已合入来源，不按模块另开 PR。

源码已接实际消费者：固定六镜像离线 inspect（本机 socket/空受保护 Docker config）、三库恢复 prehold audit、同一持久 control/diagnostic 会话、固定 9b 算法迁移、只读 provider producer/完整响应验证、completion intent→验证→原子 exclusive receipt→durable journal、指针/服务/三库恢复优先的激活动作、真实只读 canonical 与六条浏览器业务源码。空 registry 已移除。异常事务/未知状态保留 FD9；角色封锁后不重新建立 DDL 连接。

独立源码审查已核对上述调用和之前的 NOLOGIN 问题，未确认新故障。正常 cloud-deploy typecheck/lint 通过；四个针对 Vitest 文件 40 tests 通过（含生成 CJS 对源码 check、实际 Node/Python fixtures）；工具 identity 17 tests 通过。完整 affected 静态验证必须正常通过后才能正常 push，不能用这些纯测试代替全钩子或 CI。

当前发布不可执行：所有写入者停写/NOLOGIN 与实际 hello/ASR/Skill/PDF 写入验收存在顺序冲突。默认入口在任何锁/hold/DB/指针动作前精确拒绝 `MAINTENANCE_ACCEPTANCE_WRITER_LANE_NOT_IMPLEMENTED`。两种具体流程与恢复责任见 `cn-maintenance-acceptance-decision.md`；不能用私有 flag 改为 ready。

剩余工程/证据边界：共同快照与 backup-time 对象闭包、完整原始目录/ACL/RLS/AGE/数据 hash 的独立恢复证据；真实 root-private 输入/权限/Node-pg 与浏览器运行时闭包；所有安装目标的 fresh provider inventory；六个 immutable images 的 seal/prepare；真实恢复及停写演练；明确风险批准和最终公开 commit/health/login/六流程验收。当前缺这些，不提供上线 ETA。前述 90–180 分钟只估本轮源码审阅候选，不估生产完成。

本轮没有连接数据库、启动服务/容器、恢复/解密/传输数据、安装生产工具、创建权限、迁移、停机或切流。原始 DevOps 与其他已取消会话未重启。所有源码 worker 已停写；后续只在本分支推进一个 direct-main draft PR，保持未 ready、不自动合并。
