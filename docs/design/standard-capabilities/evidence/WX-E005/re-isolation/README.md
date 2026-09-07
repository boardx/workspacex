# WX-E005 MCP 重隔离增量

本增量实现管理员发起的 server 范围 interrupt/drain，不修改主 run 生命周期。持久请求与调用关联支持另一 API 实例发起治理；执行实例轮询自己已领取的回执，停止并等待本地 Worker terminate 后才记 localAcknowledgedCalls。远端服务器可能已产生副作用，所有回执明确 remoteOutcome: unknown。

Drain 拒绝新调用，允许已领取且仍通过当前身份/可见性/固定评审检查的调用完成。到期或丢失实例的 pending 只回收成 unconfirmed，不虚构本地停止确认。重新评审生成新的固定快照，旧 run 不自动获得新的授权。

## 已执行验证

- 标准隔离 wrapper 下真实 PG、真实 Nest HTTP、官方 MCP SDK 和本地 HTTPS MCP 服务器：14/14。精确命令、会话和输出摘录见 api-observed.txt；此文件明确是工具输出摘录而非完整原始日志。重隔离 4 项覆盖另一服务实例发起 interrupt、兄弟服务器与主 run 不被取消、drain、新调用拒绝、管理员拒绝、过期回执不虚构 ack、已有数据上的迁移连续重放。
- `node --test apps/api/scripts/tests/mcp-execution-boundary.test.mjs`：31/31，独立退出码 0，见 ast-after.txt。首次 29/31 反证失败见 ast-before.txt；修复为实际 AST 分支及 SQL 参数检查，没有放宽授权。
- 在 apps/api 执行 `node scripts/lint-permission-paths.mjs`：独立退出码 0，见 permission-lint.txt。
- `node --import tsx packages/contracts/scripts/generate-mcp-execution-schema.ts --check`：退出码 0。

## 边界

远端模型与生产 MCP 服务未参与；服务器是受控真实协议 fixture，不据此声称生产远端副作用可回滚。过期实例测试直接插入已过期回执，未声称杀死真实进程。凭据执行 broker 与浏览器治理仍是后续独立增量。migration 20260909060000 使用 FORCE RLS，固定治理请求/关联只允许 app_rw SELECT/INSERT，不把 app_rw 升为秘密读取者。
