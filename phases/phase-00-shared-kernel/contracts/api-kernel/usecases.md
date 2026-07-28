# 契约束 `api-kernel` — ② 用例接口（门控面 + 运行时管道契约）

> 与 `web-kernel` 同构：这个束**没有业务用例**，它的「接口」是
> **① 四道门控命令**（契约的可执行形式）与 **② 三道运行时管道的行为契约**。
>
> ⚠ **失败模式必须穷举**——对本束而言，「失败」= **门控在什么输入下必须 exit 1**。
> 只验「脚本能跑」不验「脚本能抓到违规」等于没有门控（UC-0.4 V5 已确立的纪律）。

---

## 一、门控面（第 ③ 件的可执行形式）

### `lint-arch-deps` —— 依赖方向

```
cmd: node .harness/scripts/lint-arch-deps.mjs
in:  apps/api/src/**/*.ts
out: 扫描文件数 + 违规清单
ok:  exit 0 且 **扫描数 > 0**
err: exit 1，报出 from→to、行号、以及**为什么这条被禁**（`WHY` 表）
```

⚠ **验收断言的是扫描数，不是退出码。** 对不存在的目录它打印「跳过」并 exit 0——
这是本束继承的一个**现存空转门控**（domain I-2）。

**必须 exit 1 的输入（反证 fixture）**：

| fixture | 违规 | 理由 |
|---|---|---|
| `domain/leak-app.ts` import `../application/*` | `domain→application` | 业务规则被技术细节污染 |
| `domain/leak-infra.ts` import `../infrastructure/*` | `domain→infrastructure` | domain 不该知道数据库存在 |
| `application/leak-infra.ts` import `../infrastructure/*` | `application→infrastructure` | 用例层只依赖自己定义的端口 |
| `interface/leak-infra.ts` import `../infrastructure/*` | `interface→infrastructure` | 绑死实现，DI 失去意义 |
| `infrastructure/ok.ts` import `../application/port` | —（**必须放行**） | 依赖倒置：控制流向外、依赖向内 |

最后一行是**反向反证**：门控如果把它也拦了，就是**过度触发**，同样是坏门控。
（本项目已有先例：`lint-omission-reason` 首版误判 42 处自由文本、
`lint-contract-source` 首版误判 5 处正确的 `z.infer` 派生。）

---

### `verify-rls.sh` —— RLS 的「强制」二字

```
cmd: apps/api/scripts/verify-rls.sh
pre: 空库 + 已跑迁移
out: 角色属性检查 + 跨租户读取实测行数
ok:  exit 0
err: exit 1
```

**逐条断言**：

| # | 断言 | 对应不变量 |
|---|---|---|
| 1 | 应用角色**不是任何业务表的 owner** | I-4 |
| 2 | 应用角色 `rolbypassrls = false` | I-4 |
| 3 | 应用角色**无 DDL 权限**（CREATE 被拒） | I-4 |
| 4 | 启用 RLS 的表均 `relforcerowsecurity = true` | I-5 |
| 5 | `SET LOCAL app.current_org = A` 后**直接 SELECT**（无应用层过滤）→ 0 行属于 B | **I-6** |
| 6 | 换成 B → 只看得到 B 的行（**不是 0 行**，否则可能是策略写死拒绝，那也不算隔离成立） | I-6 |
| 7 | **不设** `app.current_org` → 0 行（fail-closed，不是 fail-open） | I-7 |
| 8 | `rls_probe` 表存在 | I-13 |

⚠ 第 6 条是容易漏的**反向断言**：策略若写成「一律拒绝」，第 5 条也会绿。
**「读不到别人的」和「读得到自己的」必须一起断言**，否则无法区分隔离与瘫痪。

---

### `verify-runtime-gates.sh` —— 三道运行时门控的双向断言

```
cmd: apps/api/scripts/verify-runtime-gates.sh
pre: API 进程已起（测试端口，独立于 dev）
ok:  exit 0
```

| # | 输入 | 期望 | 不变量 |
|---|---|---|---|
| G1 | 无凭证 → 受保护路由 | **401**（不是 200、不是匿名放行） | I-8 |
| G2 | 合法测试凭证 | 200 且 handler 的 principal 非空 | I-8 |
| G3 | 违反契约 zod 的请求体 | **400 + 字段级**错误（不是笼统 400） | I-9 |
| G4 | 合规请求体 | 通过 | I-9 |
| G5 | handler 抛出携带敏感串的异常 | 响应体**只含** `internal_error` + traceId；**不含**该敏感串、堆栈、表名 | I-10 |
| G6 | 同一 traceId | 在日志里能找到详情 | I-11 |

⚠ G2 / G4 是**反向断言**：只测「违规被拦」不测「合规放行」，
一个「一律拒绝」的实现会全绿。

---

### `migrate:check` —— 迁移幂等

```
cmd: pnpm --filter api run migrate:check
step: 空库 → 跑全部迁移 → 记 schema 摘要 → **再跑一次** → 比对摘要
ok:  两次摘要一致 且 migrations/ 每个文件都进了版本表
err: exit 1（**不得靠重建库绕过**——生产不会给你重建库的机会）
```

---

## 二、运行时管道的行为契约

### Guard（`interface` 层，全局注册）

```
in:  HTTP 请求
out: principal（**非空**）注入请求上下文
err: 无凭证 / 凭证无效 → 401
     鉴权依赖不可用 → **拒绝，不降级放行**
```

⚠ 最后一条与 `identity` 束的 `AUTH_SERVICE_UNAVAILABLE`（「一律拒绝不降级」）**是同一条纪律**，
在两个位置各自成立：`identity` 定判定语义，本束定 HTTP 层不得放水。
⚠ **凭证形态不在本束**（JWT / session / mTLS 属 phase-01 `01-auth`）。
本束只要求「principal 非空」这条结构约束，凭证来源可先用测试注入。

### ValidationPipe（`interface` 层，全局）

```
schema: 来自 packages/contracts 的 zod —— **唯一来源**
err:    400 + 字段级错误（哪个字段、为什么）
```

⚠ **后端不得另写 DTO 定义。** 这是本项目「同一事实声明在两处」在后端的**第一个高危面**：
后端 DTO 与契约同形，最容易被顺手抄一份。
`lint-contract-source.mjs` 是那道锁，且其**扫描范围必须扩到 `apps/api`**（I-12 / V10）——
它此前只覆盖前端侧。

### ExceptionFilter（`interface` 层）

```
out: { error: "internal_error", traceId }
log: 完整异常（含堆栈）+ 同一 traceId
```

⚠ `err.message` 常含 SQL 片段与表名，**不得进响应体**。
⚠ traceId 必须能把响应与日志对上——否则「只回 `internal_error`」会让线上问题无法定位，
那是把安全性换成了不可运维性。

---

## 三、健康 / 就绪端点

```
GET /healthz
out: { migrationVersion, rlsForced: boolean, appRoleIsOwner: false }
```

⚠ **运维可见，不是用户可见**；**不得泄露**连接串、角色名、迁移 SQL（UC-0.6 R5）。
`appRoleIsOwner` 恒为 `false`：它是 I-4 的运行时自检，
让「哪天有人把连接改成 owner」在健康检查里就暴露，而不是等到泄漏发生。

---

## 四、失败模式穷举（本束的「异常态」）

| 失败 | 表现 | 处置 |
|---|---|---|
| `lint-arch-deps` 打印「跳过」 | 目录不存在 | **判本件未完成**（不是通过） |
| 反证 fixture 未被拦 | 门控空转 | 修门控，不是删 fixture |
| 合规 fixture 被拦 | 门控过度触发 | 收紧规则（已有两次先例） |
| 跨租户仍能读到 | RLS 未强制或用了 owner 身份 | **回策略与角色，禁止在应用层补过滤了事**（UC-0.6 E2） |
| 自己的行也读不到 | 策略写成一律拒绝 | 隔离不成立，判失败 |
| 未设租户上下文能读到全部 | fail-open | 判失败：连接池复用会让这条随机泄漏 |
| 迁移两次结果不同 | 非幂等 | 判失败，不得重建库绕过 |
| 响应体含 `err.message` | 错误边界漏 | lint 拦响应构造里的 `String(err)` / `err.message` |
| 后端出现第二份 DTO 定义 | 契约漂移 | 以契约为准删后端副本 |
