# Sandbox 容量优化进度

2026-10-28，issue #5966，基线 `607324e8bfd2`，分支 `codex/sandbox-capacity-control`。

- 已实现：服务内有界队列、按可信用户键限额、总超时内等待、取消/断连清理、聚合容量指标。
- 已接线：普通聊天和 Skill 试跑的身份、Native 可见性检查得到的作者、私有传输头；两类 sandbox 的稳定可选配置文件。
- 已补文档：机制图、配置与私有指标探测、devapp→CN 压测发布步骤、重启与隔离边界。
- 独立审查指出普通 Chat 持久化取消未传播的问题，已通过失败测试复现并修复；新增真实 PG→HTTP→等待队列验证。
- 身份登记单独交付 #5965；用户明确本次不需要网关，未配置网关、签发 token 或创建租约。
- 全包验证：sandbox 109 通过/1 原有跳过，contracts 1240 通过，cloud-deploy 706 通过，Python 860 通过/45 原有条件跳过；真实 PG/API 30+3 通过，传输/取消 4 通过。
- 相关验证与环境失败记录见 `docs/evidence/sandbox-capacity-5966/README.md`。
- 未部署 devapp/CN，未改变服务器规格，未验证 100/200 人真实负载，未实现全局持久化调度或自动扩容。

交付 PR：https://github.com/boardx/workspacex/pull/5968 。当前 CI/可合并状态必须读取 PR 与 `pnpm harness pr-queue --pr 5968 --json`，不以本文静态快照代替。
