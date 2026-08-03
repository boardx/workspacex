# 协调协议（coord/0.1）— 接口契约

> 模板**只定义协议、不打包实现**（上游拍板 2026-07-18）。任何实现了本契约的服务
> 都能当协调权威——上游 BoardX 用 Cloudflare Workers + Durable Object（每仓一个
> RepoHub），你也可以用一个 Postgres + 任意 HTTP 服务实现同样的契约。
> **未配置协调服务时，整套 harness 退化为单 agent 模式照常可用**（verify/doctor/
> new-sprint 都不依赖它）；多 agent 并行才需要它。

类型与客户端的权威定义在 `packages/coord-protocol/src/`（零依赖、纯 Web 标准，
Node 与 edge runtime 都能跑）。本文档是给实现方/接入方的人话版。

## 核心概念：租约（lease），不是锁

- agent 认领资源（feature/issue/coordinator-role/module）得到**带 TTL 的租约**
  （默认 6h，上限 24h），靠心跳续期；断心跳则过期，别人可接管——**没有死锁**。
- 认领必须原子：同一 resource 同时只能有一个活跃租约。实现方注意：**必须用存储层
  的原子原语**（唯一索引 / DO 串行化 / 条件写入），禁止 SELECT-then-INSERT
  （上游 ADR-001/ADR-012 的核心教训，read-check-write 出过真实事故）。
- 释放必须带 ≥10 字符的 handoff note——强迫交接上下文，"静默消失"是最贵的故障。

## 端点契约（HTTP + Bearer token）

| 端点 | 语义 | 关键约束 |
|---|---|---|
| `POST …/claims` | 认领资源 → 201 Lease / 409 LeaseConflict（带当前持有者） | 原子；resource_type ∈ feature/issue/coordinator-role/module/custom |
| `POST …/claims/:leaseId/heartbeat` | 续期 → 200 / 404(租约不存在或已过期) | 心跳间隔 << TTL |
| `POST …/claims/:leaseId/release` | 释放 + handoff note → 200 | note ≥10 字符 |
| `GET …/claims?resource_id=` | 查单个资源的活跃租约 | 查询失败要**可观测**，不许静默当"无租约" |
| `GET …/claims` | 列全部活跃租约（看板用） | |
| `GET …/time` | 权威时钟 + 周期 id（如 `2026-07-18T06Z`） | 公开只读；全队时间判断的唯一来源（ADR-014） |
| `POST …/events` | 追加协调事件（叙述层：cycle-plan/cycle-result/andon/task-*…） | 类型清单见 types.ts `EVENT_TYPES`；append-only |
| `GET …/events?since=` | 拉事件流 | |
| `POST …/tasks` | 派工（仅 coordinator 层 token） | note ≤2000；deadline 必须合法 ISO（脏值直接 400，不静默） |
| `GET …/tasks?assignee=` | 收件箱（自己）；`assignee=*` 列全队（仅 coordinator） | |
| `POST …/tasks/:id/ack·done·recall` | 状态流转 pending→acked→done / →recalled | **状态前置判定必须与写入原子**（条件 UPDATE / DO 串行），409 报真实当前状态 |

## 实现方的四条硬要求（上游全部付过学费）

1. **原子认领**（同上）——这是协议存在的意义，破了它一切失效。
2. **权威时钟不许断**：agent 的 loop 纪律（tick）建立在 `GET /time` 上。
3. **任务流转原子**：并发 ack 只能有一个成功且只记一条事件。
4. **部署走 CD**：协调权威绝不手动部署（上游两个分支手动 deploy 互相覆盖、
   线上收件箱静默消失的事故是这条的出处）；冒烟脚本要带**漂移探针**
  （关键端点存在性断言：如 POST /tasks 无 token 应 401 而非 404）。

## 接入方（agent 侧）怎么用

```bash
export COORD_GATEWAY_URL=https://<你的协调网关>
export COORD_API_TOKEN=<身份 token>       # 值走凭据文件，不进 git/聊天
export COORD_REPO=<owner/name>
export COORD_AGENT_ID=<registry 里的 id>
pnpm harness tick        # 每个 loop 周期跑一次：对时 + 续租 + 收件箱
```

降级行为（实测）：`COORD_GATEWAY_URL` 未配置 → tick 明确拒绝并指路（单 agent
模式**不需要 tick**，verify/doctor/new-sprint 全都不依赖它）；URL 已配但 token、仓库
或身份不完整 → 读完权威时钟后明确失败，不会跳过租约或把收件箱伪装成空。
分级 loop 节奏（ADR-014）：主协调者 5min / 模块协调者 15min / 开发 agent 15min。
