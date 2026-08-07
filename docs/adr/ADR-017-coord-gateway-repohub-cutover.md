# ADR 017: 协调权威载体从 coord-service (D1) 迁移到 coord-gateway（RepoHub DO）

> ⚠ **本文件是本地重建，不是上游 BoardX 原文**。同 ADR-009 头部说明——
> `docs/adr/README.md` 已记录 ADR-006~009/013/015~017 是上游未分发的项目实现层
> ADR，本文件是本仓对"ADR-017"每一处引用的现场取值综合，不是猜测上游原文。
> 文件名本身也是重建——本仓引用点没有任何一处像 ADR-009 那样直接写出文件名，
> `coord-gateway-repohub-cutover` 是从内容（迁移到 coord-gateway 的 RepoHub DO）
> 推出的描述性 slug，**不保证与上游真实文件名一致**。如果发现出入，改这份
> 文件，不要改代码去迁就它。

- 状态：Accepted（已生效，2026-07-18 起，项目编号 p29-F10 stage-1/stage-2）
- 适用层：项目实现（专属于本仓真实跑过的协调基础设施迁移）
- 关联：只换 ADR-009 确立的协议**载体**（D1 → coord-gateway 的 RepoHub
  Durable Object），**不改**其确立的协议**语义**（claim/heartbeat/TTL/机械
  回收、fail-closed）；与 ADR-014（权威时钟）共同要求 agent 读
  `GET /api/coord/time` 而非本机时钟

## 背景

`packages/coord-protocol/src/client.ts:11` 引用的"ADR-017 背景 §1"指出
coord-service 有一个结构性缺陷：客户端把 401/403/429/5xx 等多种失败状态
静默折叠成 `null`，造成事实上的 fail-open（看起来像"没有认领"而不是"判定
失败"）。这是本次迁移的动机之一，不是单纯的技术栈偏好。

## 决策

1. **协调权威的载体迁移**：`role:coord-main`、`role:coord-<module>` 等租约的
   唯一跨机器权威从 coord-service (D1) 切到 **coord-gateway**——每仓一个
   **RepoHub Durable Object**。原子性来自 DO 单线程串行执行 + `uq_active_lease`
   部分唯一索引双保险；所有租约判定都在 DO 内部发生，禁止任何调用方
   SELECT-then-INSERT。
2. **协议语义不变**：ADR-009 确立的 claim/heartbeat/TTL/机械回收、fail-closed
   拒绝语义原样保留，本决定只换实现载体。
3. **资源命名对齐协议规格**：`role:coord-<module>` 改为 `module:<name>`
   （对齐一份本仓未随附的协议规格文档，引用点写作 `lease.md`，同 ADR-006~017
   一样只存在于上游）。
4. **凭据体系整体更换**：`COORD_SERVICE_URL`/`COORD_SERVICE_TOKEN`/
   `COORD_BROKER_TOKEN`/`COORD_DISPATCH_TOKEN` 全部退役，改为
   `COORD_GATEWAY_URL`/`COORD_API_TOKEN`/`COORD_REPO`；token 改为按仓 scoped
   token，走 devportal 自助领取（p29-F08）。
5. **消灭静默 fail-open**：鉴权矩阵改为显式 fail-closed——缺配置 503，无
   Authorization/非 Bearer 401，不再把失败状态折叠成"看起来正常"。
6. **迁移分两阶段落地**：p29-F10 stage-1（coordinator/module-coordinator 租约
   载体切换）、stage-2（周期计算等纯函数从已退役的
   `packages/coord-service/src/lib/cycle.ts` 逐行搬到 `coord-gateway`，
   ADR-014 语义零变更）。
7. 附带产出 **PlatformDirectory**（平台级身份，与 RepoHub 的按仓工作原语互补）
   ——引用点里对这部分的归属标注不完全一致（`packages/coord-directory/
   src/directory.ts:2` 称其"ADR-017 风格"而非直接归入本决定，`coord-gateway.ts:
   176` 的 `/api/coord/directory/*` 又标注为 p30/F01 + ADR-017 并列），如实
   记录这处边界模糊，不替上游拍板它到底算不算本决定的一部分。

## 后果

正面：结构性消灭了 coord-service 的静默 fail-open 缺陷；DO 单线程模型让原子性
证明更直接（不再依赖单独一张表的唯一索引 + 应用层重试）。

负面/需注意：`lease.md` 协议规格文档本身不在本仓——`module:<name>` 这类命名
约定的完整定义只能从代码行为反推，不能对着规格文档核对。

## 引用来源（现场取值，file:line）

`.harness/scripts/coordinator-lock.ts:3-9,43-45,109`、
`.harness/scripts/module-lock.ts:4-11,80`、`.harness/scripts/tick.ts:54`、
`packages/coord-protocol/src/client.ts:5,11`、
`packages/coord-repohub/package.json:5`、`packages/coord-repohub/src/repohub.ts:1`、
`apps/coord-gateway/src/cycle.ts:4-10`、`apps/coord-gateway/src/auth.ts:4`、
`apps/coord-gateway/src/index.ts:81`、
`.github/workflows/deploy-coord-gateway.yml:1`、
`apps/coord-gateway/wrangler.toml:1`、
`apps/devportal/{my-tokens,agents,coordination,pulse,my-home}/route.ts`、
`apps/devportal/lib/{coord-gateway,dispatch}.ts`、
`apps/devportal/wrangler.toml`、`apps/devportal/README.md`（均含
"2026-07-18 割接（p29-F10 stage-2，ADR-017）"同一表述）、
`packages/coord-directory/src/directory.ts:2`。
