# A3：已批准上下文桥接的契约与 transport 验证

2026-11-16 本轮用户会话原文批准：“批准上下文桥接方案，继续实现”。对应唯一设计束为 `docs/design/aidt-native-context/`；frontmatter 原提案状态保留，不代人签字。本记录是实现证据，不将批准、单元测试或快照准备等同真实模型接收。

```mermaid
flowchart LR
  A[方案A会话批准] --> B[单源selector与receipt]
  B --> C[快照+应用记录+immutable marker]
  C --> D[AGUI坐标通道与来源GET]
  D --> E[合同与transport定向检查]
  E --> F[根集成真实PG/HTTP/模型边界验收]
  classDef done fill:#d1fae5,stroke:#059669
  classDef tested fill:#ede9fe,stroke:#7c3aed
  classDef pending fill:#fef3c7,stroke:#d97706
  class A,B,C,D done
  class E tested
  class F pending
```

| 项目 | 本路实际结果 | 限制 |
| --- | --- | --- |
| 合同 | `packages/contracts/tests/aidt-run-context.test.ts` 13/13 | 严格selector、六阶段身份、safe修订、CJK/转义规范化、最终编码预算；不是服务器授权证明 |
| 合并后端定向 | 8文件72/72，见 `api-targeted.txt` | A1受理30；AGUI14；receipt/globalFilter11；bridge到accept2；approved pack3；原有filter6、headers-sent2、heartbeat4。没有PG/globalSetup，没有模型网络 |
| 架构 | 2312文件全向内，见 `architecture.txt` | 静态依赖检查 |
| 权限读取机械门 | 2317文件、343tenant表通过，见 `permission-paths.txt` | 不替代真实成员/撤权/RLS运行验收 |
| TypeScript | contracts完整typecheck退出0；本路controller/bridge/filter及3测试scoped typecheck退出0（实际终态已回收） | 不代替根全仓集成检查 |

实现只传命名selector，不转发`body.context`正文/role，不拼改AIDT持久human正文。缺少真实thread或稳定clientMessageId时受理前422；resume忽略新selector，沿既有run处理。controller的多行、中文、符号原文测试及bridge到唯一accept边界测试均逐字比较。普通Chat保留立即SSE。

同消息键的null→有selector、有→不同selector可在fresh AIDT受理前返回HTTP409；有→null仍保留普通立即SSE，随后识别旧marker并发送既有`RUN_ERROR IDEMPOTENCY_CONFLICT`，HTTP为200，不能记作HTTP409。controller测试只证明传输映射；实际不新增run/message与同快照由A1受理/根PG验收另外证明。

迁移 `20261116160000_aidt_run_context.sql` 新增两张仅AIDT表和既有run nullable immutable marker。snapshot scope trigger核真实human/run/thread/project/marker；application三列FK绑定正确snapshot hash；两表FORCE RLS且运行时仅SELECT/INSERT、UPDATE触发拒绝；调用既有组织冻结与项目归档策略安装器。尚不据源码宣称迁移已在真实PG重放成功。

`GET /agent-runs/:runId/aidt-context`只返回来源修订/hash/应用状态，private/no-store，不改ordinary GET run。receipt操作只透出合同允许的404不可用/503不可用；AGUI受理保留其精确闭码。全局Filter只登记单源封闭枚举，未知码/私有材料继续剥离。既有`agent-runs/:path*`rewrite已覆盖新子路径，无新origin。

最终reference message仍受128KiB cap。冻结role/content块先预留1024字节给native id等envelope；provider再校实际序列化消息字节，不能二次剪裁或改旧hash。prepared、assembled、首次messages派发和checkpoint继承分别记录；没有派发事实不能标模型已接收。无额外模型调用、栈启动、部署、权限变更或commit。
