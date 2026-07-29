# 契约束 `api-kernel` — ① 领域模型与不变量

> 洋葱最内层。**但这个束没有业务领域**——它是**后端内核**，与 `web-kernel` 对称。
> 覆盖 feature：**F18**（phase-00，13 点）
> 依据：`uc-0-6 后端内核与运行时门控`
> 裁决：ADR-020（洋葱分层 + `lint-arch-deps` 强制）· `architecture.md`「三个必须建立的
> 机械门控（运行时）」· UC-0.3 R7（RLS 强制隔离）· `architecture.md` 不变量
> 「所有状态可从 PG + 迁移 + 对象存储重建」

---

## 零、这个束为什么和 identity / artifact / context-pack 不一样

那三束的领域模型是**会落库的业务数据**，不变量是「数据损坏」意义上的。

`api-kernel` **不建任何业务表、不写任何业务逻辑、不产生任何业务权限判定**
（UC-0.6 R1「核心数据对象：无业务数据对象」）。它的「领域」是**后端运行时的结构性契约**：

- **依赖方向**（洋葱只能向内）
- **迁移体系**（显式、前向、幂等、可从空库重建）
- **RLS 的「强制」二字**（应用角色非 owner + FORCE + 可反证）
- **三道运行时门控**（鉴权 / 校验 / 错误边界）
- **契约单源直达后端 DTO**

违反它们不会立刻损坏数据，但会造成：**跨租户泄漏被误以为已隔离**、
**校验层根本不存在**、**错误响应泄露内部细节**、**洋葱退化成四层空文件夹**。
每一条都仍然**能写成机械断言**——这个束的第 ③ 件就是那些断言本身。

⚠ 与 `web-kernel` 的一处关键不同：`web-kernel` 的门控**已经在跑**，它的四件套是
「把既成事实固定成契约」。`api-kernel` 的门控**一个都还没跑起来**——
`lint-arch-deps` 此刻对不存在的 `apps/api/src` 打印「跳过」并 exit 0。
**这个束是在为尚不存在的东西立契约**，签核时请按这个前提读。

---

## 一、值对象（后端内核的结构单位）

### `Layer`（值对象）—— 单一事实源：`lint-arch-deps.mjs` 的 `ALLOWED` 表

| 层 | 可以 import | 不可以 |
|---|---|---|
| `domain` | 无 | application / infrastructure / interface |
| `application` | domain | infrastructure / interface |
| `infrastructure` | domain / application（**实现其端口**） | interface |
| `interface` | domain / application | **infrastructure**（绑死实现，DI 失去意义） |

⚠ `infrastructure → application` 是**刻意放行**的：控制流向外、依赖向内，这正是依赖倒置。
⚠ 目录名即层名。**层的判定来自路径**，不是来自装饰器或命名约定——
路径可被静态检查，装饰器不能。

### `Migration`（值对象）—— 单一事实源：`apps/api/migrations/NNNN-*.sql`

显式 SQL、前向单向、**幂等**（连跑两次 schema 摘要一致）、
可从**空库**重建全部结构。已应用版本记录在迁移版本表。

> 依据 `architecture.md` 不变量：「所有状态可从 PG + 迁移 + 对象存储重建」。
> 迁移不可审计 ⇒ 这条不变量无从谈起。
> ⚠ **不得靠「重建库」绕过幂等失败**——生产不会给你重建库的机会。

### `DbRole`（值对象）—— RLS 的成立前提

| 角色 | 用途 | 硬约束 |
|---|---|---|
| 迁移角色 | 执行 DDL | 拥有表；**只在迁移时使用** |
| 应用角色（`app_rw`） | 运行时读写 | **非表 owner** · 无 `BYPASSRLS` · 无 DDL |

⚠ **PG 中表 owner 默认不受 RLS 约束**（`architecture.md` 明写）。
用 owner 身份连库 = RLS 写了但没生效，且**表面上一切正常**。
这是「以为开了 RLS 其实没开」的头号成因，故单列为不变量 I-4。

### `TenantContext`（值对象）—— RLS 策略的输入

租户上下文经 `SET LOCAL app.current_org` 传入，策略据此过滤。
`SET LOCAL` 的作用域是**事务**——连接池复用连接时，未设上下文的查询必须**读不到任何行**
（fail-closed），而不是读到全部（fail-open）。

### `RlsProbe`（值对象）—— 内核资产，不是脚手架

`rls_probe` 表内含两个租户各若干行，唯一用途是**证明 RLS 生效**。
⚠ **它必须长期存在。** 将来任何人改动策略或连接角色，反证脚本会立刻红。
删掉它 = 删掉「RLS 真的在强制」的唯一证据。

### `RuntimeGate`（值对象）—— 三道门控，全部在 `interface` 层

| 门控 | NestJS 载体 | 契约 |
|---|---|---|
| 鉴权 | Guard（全局注册） | handler 拿到的 principal **非空**；无凭证 **401，不得降级为匿名放行** |
| 校验 | ValidationPipe（全局） | schema **来自 `packages/contracts` 的 zod**，后端不得另写 DTO 定义 |
| 错误边界 | ExceptionFilter | 响应体**只含 `internal_error` + traceId**；细节只进日志 |

⚠ 三者是**协议适配不是业务规则**，故属 `interface` 层。
鉴权的**判定逻辑**在 `application`（`identity` 束的 `Authorize`），**强制**在 PG RLS。
三个位置各司其职，不可互相顶替。

---

## 二、不变量

> 判据同 `web-kernel`：**违反即隔离失效 / 校验缺失 / 内部细节泄露 / 分层退化**。
> 每条都能写成断言。右列是**将要落地**的门控（本束尚无一道在跑——见第零节）。

| # | 不变量 | 断言方式 |
|---|---|---|
| **I-1** | 任何 `.ts` 文件的 import 方向**只指向内层**（`infrastructure→application` 除外） | `lint-arch-deps.mjs`，违规 exit 1（V3 反证） |
| **I-2** | `lint-arch-deps` **实际扫描到文件**（扫描数 > 0） | V2 断言扫描数，**不是退出码**——对空目录它 exit 0 |
| **I-3** | 全部迁移可从**空库**重建结构，且**连跑两次摘要一致** | `migrate:check`（V6） |
| **I-4** | 应用角色**非表 owner**、无 `BYPASSRLS`、无 DDL 权限 | `verify-rls.sh`（V4） |
| **I-5** | 启用 RLS 的表均为 `FORCE ROW LEVEL SECURITY`（owner 也受约束） | 同上 |
| **I-6** | **绕过应用层过滤**直接查询，跨租户仍读到 0 行 | `verify-rls.sh`（V5，**本束最重要的断言**） |
| **I-7** | 未设 `app.current_org` 的查询 **fail-closed**（读到 0 行，不是全部） | 同上 |
| **I-8** | 无凭证请求受保护路由 → **401**；有凭证 → principal 非空 | `verify-runtime-gates.sh`（V7） |
| **I-9** | 违反契约 zod 的请求体 → **400 + 字段级错误**；合规 → 通过 | 同上（V8） |
| **I-10** | 异常响应体**只含 `internal_error` + traceId**，无堆栈/表名/敏感串 | 同上（V9） |
| **I-11** | 同一 traceId 在日志里能找到详情 | 同上（V9 后半） |
| **I-12** | 后端校验 schema 与前端类型**同源于 `packages/contracts`**，无第二份定义 | `lint-contract-source.mjs`，**扫描范围须含 `apps/api`**（V10） |
| **I-13** | `rls_probe` 表存在且被反证脚本使用 | `verify-rls.sh` 找不到它即失败 |

### 为什么 I-2 单独成条

`lint-arch-deps.mjs` 对不存在的目录**打印「跳过」并 exit 0**。
若验收只写「脚本退出码 0」，这条**永远为真且永远没在测**。
本项目已五次撞到「门控看起来在跑，其实是空转」（详见 `web-kernel/coverage.md` 末尾的三版
响应式断言），**I-2 就是把那条教训写进契约**。

### 为什么 I-6 / I-7 要求「绕过应用层过滤」

`architecture.md` 写「隔离在 PG RLS 层强制，应用层过滤只是第二道」。
若验收在应用层过滤仍在的前提下做，**第一道漏了也测不出来**——
两道都在时的通过，不能区分「RLS 生效」与「只是应用层挡住了」。

---

## 三、③ 件为什么**不是** zod 契约文件

与 `web-kernel` 同理，但理由不同，需分辨：

1. **`web-kernel` 不产 zod 是因为「没有后端消费者」。`api-kernel` 恰恰相反——
   它是 zod 的消费者，不是生产者。** 它的职责是把 `packages/contracts` 已有的 27 个操作
   **接到后端 DTO 上**（I-12），而不是再定义新契约。
2. 本束的契约对象是**依赖方向、迁移、DB 角色、RLS 策略、HTTP 管道**——
   它们的执行者分别是 **node 脚本、SQL 文件、PG 系统目录、NestJS 全局管道**，
   **没有一个能 import zod schema**。硬造 `api-kernel.ts` 会制造第七次「同一事实两处声明」。
3. 真正的机械单源是：`lint-arch-deps.mjs` 的 `ALLOWED` 表（分层）· `migrations/` 目录（结构）·
   迁移里的 `GRANT`/`ALTER ROLE`（角色）· `packages/contracts` 的 zod（校验）。

⇒ **结论：`api-kernel` 的第 ③ 件是「迁移文件 + 四道门控脚本」本身**，
不新增 `packages/contracts/src/api-kernel.ts`。

> 反面自检：若哪天出现「多个 TS 消费者都需要那份分层表 / 角色约束」，
> 正确的收敛是把它做成 `lib/` 里的纯 TS 常量单源并让脚本读它，**仍不是 zod**。

---

## 四、这个域不负责什么

- **任何业务表与业务逻辑**——`acl_bindings`（F01）、Artifact 六表（F04）、
  Context Pack（F09）各属其 feature。本件只建**迁移体系本身**与**探针表**。
- **真实身份认证**（登录/邀请/会话/凭证形态）——属 phase-01 `01-auth`。
  本件的 Guard 只保证「principal 非空」这条结构约束。
- **鉴权的判定逻辑**——属 `identity` 束的 `Authorize`。本件只提供**强制执行的位置**。
- **worker 进程入口 / LangGraph / 模型网关**——各属后续阶段。
  但洋葱目录从一开始就不得写成 API 专属（worker 与 API 共用领域层）。
- **出网 deny-all 的实现**（X-3）——本件只**认领落点**（`docker-compose.dev.yml` 与
  部署清单的网络策略位），断言留给 F16。义务是让 X-3 有明确文件位置，不再悬空。
