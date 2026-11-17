# A3 原生教学上下文：隔离 PostgreSQL 回归

执行日期：2026-11-16 UTC。源码 HEAD：`370c7328f723bba281709a7b51850136f0429fa5`。

环境 owner 为本轮创建专用空库 `wsx_aidt_bridge_remediation_20261117`，与业务数据库及 TC5 数据库分别隔离。本次使用 owner 提供的专用测试环境文件；该文件不包含模型供应商密钥，凭据不进入证据。测试顺序执行，使用仓库标准 `vitest.config.ts` 的数据库隔离检查、正常迁移、应用角色和测试夹具清理。未启动或停止基础设施，未更改集群角色，未访问业务库或旧 pending 数据。

| 测试 | 结果 | 实际执行范围 | 总耗时 |
| --- | --- | --- | --- |
| `bridge-real-pg.test.ts` | 22/22 通过，进程退出 0 | 真实 PostgreSQL、实际 Deep 适配器 HTTP 序列化、本地 recording loopback | 20.41 秒 |
| `return-real-pg.test.ts` | 7/7 通过，进程退出 0 | 真实 PostgreSQL 接受、精确返工快照及拒绝路径 | 4.54 秒 |

合计 29/29。模型供应商调用次数为 0；无真实模型内容质量、真实访谈或生产发布验收声明。Bridge 的 recording loopback 只记录并应答合成协议数据；Return 测试未构造模型 provider、未调用执行 worker。测试导出的 JSON 均显式记录这些边界。

本次实际验证：

- 精确保存修订经原子接受与快照保存进入实际 HTTP 消息位置，学生原话保持不变。
- 组织、项目、成员、非组成员管理员、归档、缺失修订和错误 Skill pin 均在派发前拒绝。
- 接受后真实撤权及撤权竞态阻止后续派发，不将旧授权继续用于执行。
- 同 run 重放、权限恢复及迟到回执保留原快照；普通 Chat 不产生 AIDT 快照或应用事件。
- SUM 使用独立 pin 与所选历史修订，明确无来源教师点评和缺失阶段。
- 第六步保留选定的旧第五步问题与版本；新版 head 不替换已冻结来源。
- 已确认旧第六步返工仅传白名单反思字段，目标不符、未确认、外组、跨组织、非成员或不存在修订时拒绝，且不新增 human/run/snapshot/application 行。

两套测试结束后执行了只读清理核查：该专用库中 `aidt-context-pg-%` 前缀的夹具组织、run 和快照均为 0，详见 `cleanup-check.json`。未手工删除历史业务数据。

复现命令（从 `apps/api`，先由环境 owner 提供同等专用隔离库环境）：

```sh
AIDT_CONTEXT_EVIDENCE_FILE=/absolute/path/bridge-real-pg-evidence.json \
  pnpm exec vitest run --config vitest.config.ts tests/aidt-run-context/bridge-real-pg.test.ts
AIDT_RETURN_PG_EVIDENCE_FILE=/absolute/path/return-real-pg-evidence.json \
  pnpm exec vitest run --config vitest.config.ts tests/aidt-run-context/return-real-pg.test.ts
```

证据文件：`bridge-real-pg.log`、`bridge-real-pg-evidence.json`、`return-real-pg.log`、`return-real-pg-evidence.json`、`cleanup-check.json`。

日志还记录了一项非失败警告：当前 `pg` 版本对 client 已有查询时再次调用 `query()` 发出弃用警告，提示未来 pg 9 行为变化。本次无对应测试失败；本轮未修改数据库公共夹具或放宽断言。
