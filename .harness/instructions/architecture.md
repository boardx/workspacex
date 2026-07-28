# 参考技术架构（reference stack）

> 渐进式披露第 3 层。这是本项目的**参考栈**——每层给出默认选型 + 选型理由 +
> 可替换点。硬约束只有一条：**架构必须可移植**——同一套代码要能部署到不同云平台与
> 私有环境，禁止把业务逻辑绑死在单一云的专有原语上。
>
> 两篇配套文档：
> - **产品域的上下文底座** → `docs/architecture/context-engine.md`（Artifact/Segment/Claim/ContextPack）
> - **harness 自己的元本体** → `docs/architecture/knowledge-ontology.md`
>   （developer/agent/feature/ADR，服务开发过程，**与产品域不共用表**）

## 分层总表

| 层 | 默认选型 | 为什么 | 可替换点 |
|---|---|---|---|
| 前端 | Next.js（App Router）+ Tailwind + shadcn/ui | SSR/RSC；组件可控 | 任意 SPA 框架，但保留「设计单源门控」 |
| **后台** | **NestJS**（模块化 + DI + Guard/Pipe/Interceptor/Filter 四层管道） | 见下方「为什么换 NestJS」 | 换回轻框架的条件：三条触发条件全部消失 |
| **摄取/研究 worker** | **独立 NestJS 进程**（与 API 同代码库不同入口） | OCR/ASR/批量导入/深度研究是**分钟级长任务**，不能占 HTTP 生命周期 | 可拆独立服务，但必须与 API 共用领域层 |
| **任务队列** | **PG outbox + job table 起步**；规模化后 NATS JetStream / 托管持久队列 | 摄取**不可丢失**，与「Redis 可丢失」矛盾 | 队列实现可换，**持久语义不可换** |
| 缓存 | Redis **仅缓存**（与队列彻底分开） | 事实只在 PG；Redis 挂了降级不损数据 | 任意兼容实现，或小规模不用 |
| AI（单轮） | gateway 抽象层 + sanctioned stub + **model registry** | 模型必然更换；e2e 必须能在无真实 key 时确定性通过 | 任意 provider，一适配器一文件 |
| Agent 编排（多步） | **LangGraph**（StateGraph + Postgres checkpointer），**仅限深度研究/HITL/多阶段生成** | 见下方「编排引擎的边界」 | 先量化「是不是真的多阶段流水线」再选 |
| 数据库 | PostgreSQL = **元数据/状态 canonical** + 显式 SQL 迁移 + **RLS 强制隔离** | 单一事实源；迁移可审计 | 任意托管/自托管 PG；迁移文件必须显式 SQL |
| **对象存储** | S3 兼容 = **原件 canonical** | **PG 无法从指针恢复丢失的文件**；灾备须同时恢复 PG + 对象存储 + 事件日志 | 任意 S3 兼容实现 |
| 检索 | **PostgreSQL FTS + pgvector + 元数据 + 关系递归查询**，query-planned 并行融合 | 图与向量都不擅长精确原话/编号/姓名/术语 | 见 context-engine.md 第四节 |
| 图投影 | **阶段一不启用 Apache AGE**，先用 `ontology_edges + recursive CTE` | AGE 部署兼容性与托管支持风险高 | 有真实路径性能需求再上，须锁 PG 版本 + 自建镜像 |
| Agent UI / 实时 | CopilotKit v2 + AG-UI（SSE），**仅作 presentation protocol** | 服务端 run/event 才是权威；协作编辑另用 CRDT（Yjs） | 传输可换 WebSocket，state schema 不变 |

## 为什么换 NestJS（原文档自己的触发条件已全中）

上一版把后台定为 Next.js API routes，并写明换重框架的触发条件是
**「开放第三方 API / 强制模块边界 / 重型编排，三条有一再换」**。现在三条全中：

1. **开放第三方 API**——`21-mcp` 模块要注册外部 MCP 服务器、暴露工具调用面。
2. **强制模块边界**——21 个业务模块（含共享内核），模块间依赖必须被框架约束，
   靠自觉维持边界在这个规模上不成立。
3. **重型编排**——摄取流水线九态状态机、深度研究、多路 ASR/OCR，都是分钟级长任务。

NestJS 的四层管道与 harness 原有的三层中间件是同一套纪律，只是由框架强制：

| harness 要求 | NestJS 对应 |
|---|---|
| `withAuth` 鉴权层 | **Guard**（全局注册，handler 拿到非空 principal） |
| `withValidation(zod)` 校验层 | **Pipe**（全局 ValidationPipe + zod schema） |
| 错误边界只回 `internal_error` | **ExceptionFilter**（细节只进日志） |
| —— | **Interceptor**：统一 trace / 审计事件 / token 计量 |

**Next.js 的定位收缩为**：前端渲染 + 轻 BFF（会话、页面数据聚合）。
**所有领域逻辑、长任务、第三方接入都在 NestJS**。

⚠ 边缘部署形态相应调整：边缘只跑前端与静态资源，**NestJS 与 worker 留在可移植层**
（容器）。上一版「后台必须是纯 Web 标准以便跑在 edge」的约束随之解除——
换来的是模块边界与长任务能力，这是这个项目规模下的正确交换。

## 部署三形态（同一套代码）

1. **单机私有**：docker compose（PG + MinIO + Redis）+ NestJS API + worker 进程 + Caddy TLS。
2. **多云容器**：任意 k8s / 容器服务，镜像同一份。
3. **边缘混合**：前端走边缘平台，**NestJS API 与 worker 留守可移植层**。

规则：**有 CD 的目标不手动部署**；迁移先于部署且幂等；冒烟带漂移探针。

## 编排引擎的边界（三层不要混）

| 层 | 载体 | 生命周期 | 典型场景 |
|---|---|---|---|
| **摄取流水线** | **持久任务系统**（PG outbox + worker） | 秒~分钟，**不可丢失、必须幂等** | OCR / ASR / 解析 / 切片 / 索引 |
| **产品内多步 AI** | **LangGraph**（PG checkpointer） | 秒~分钟 | 深度研究、多阶段生成、**人工确认后继续** |
| **开发者协调** | `docs/coordination-protocol.md` | 小时~天 | 多个开发 agent 认领任务、心跳、交接 |

**最常见的误用**：把摄取流水线塞进 LangGraph。摄取要的是**幂等、可重放、可重试、
背压**，那是任务队列的职责；LangGraph 要的是**条件边、检查点、人工中断**，
那是编排的职责。混用会让两边都难以推理。

HITL 用**动态 `interrupt()`**（不是 `interrupt_before/after`），且
**节点恢复时副作用必须幂等**。

## 三个必须建立的机械门控

1. **鉴权层**：NestJS Guard 全局注册；**且租户/项目隔离在 PG RLS 层强制**，
   应用层过滤只是第二道。⚠ 应用连接**不得使用表 owner 身份**——
   PG 中表 owner 默认不受 RLS 约束。
2. **校验层**：全局 ValidationPipe + zod。校验层「根本不存在」是最常见的静默缺陷。
3. **错误边界**：ExceptionFilter 只回 `internal_error`；**lint 门控**响应体里的
   `String(err)`/`err.message`。

同理前端：**设计 token 单源** + lint 拦超出比例尺的硬编码值。
原则：**能机器判定的一致性，绝不交给人肉抽查**。

## 不变量（实现必须遵守）

- 仓库即唯一事实来源；所有状态可从 **PG + 迁移 + 对象存储**重建。
- **原件不可变**：写入对象存储后永不覆盖，更新走新 `artifact_version`。
- **能保存成文件的数据一律成文件**，且在项目文件浏览器可见可下载
  （见 context-engine.md 第 2.0 节）。
- **AI 引用必须可定位**到页码/时间码/消息，无锚点的引用视为不合格。
- 任何「看起来能跑」都不算数：feature 完成 = verification 退出码 0 + 证据落盘。
- 多 agent 并行的资源互斥走协调协议，禁止各自发明锁。
