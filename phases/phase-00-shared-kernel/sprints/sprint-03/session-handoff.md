# 会话交接 — Sprint 00/03

## 当前已验证

- **F01 两层角色本体 = `passing`**。八条 verification 全过；证据 `evidence/F01.verify.log`。
- phase-00：**3 passing / 15 not_started**（F01 F14 F18），18 features / 101 点。
- 全仓门控绿：doctor 0 FAIL / 0 WARN · validate-fl · verify-uc-coverage · verify:base（12 tasks）。
- GitHub issues 已投影（milestone `Phase 00: 共享内核` + `sprint:00-0N` / `area:*` / `status:*` label）。

## 本轮交付了什么

`apps/api` 从骨架变成有业务的后端。迁移 `0003-identity.sql` 建七张表
（organizations / teams / projects / groups / org_memberships / project_memberships /
acl_bindings），**全部 FORCE RLS + 租户策略**；I-1「绑定的 subject 与 object 必须同组织」
由触发器强制——留给应用层就是「直到第一个人忘了为止」，而跨组织绑定**读的时候不会报错，
它会静默授权**。

判定链：`domain/identity/permission-decision.ts` 的 `decide()` 是纯函数，两层交集 +
可解释拒绝；`application/identity/authorize.ts` 提供 `authorize` / `authorizeBatch` /
`authorizeDerived`；`infrastructure` 的 `PgIdentityRepository` 把批量绑定查询压成**一次往返**
（B-2 的理由：逐条查会让正确路径变成慢路径，而慢的正确路径没人走）。

## ⚠ 本轮抓到的三件事，都是机器抓的不是人读出来的

### 1. 契约表达不了它自己声明的拒绝态（B-7）

`PermissionDecision.orgLayer.role` 原为**非空**，可失败枚举第一条就是 `NO_ORG_MEMBERSHIP`
——**没有角色可填**。`projectLayer.role` 同理，而 `usecases.md` 明写 `NO_PROJECT_ROLE`
「**是正常状态不是异常**」。

怎么发现的：`lint-contract-source` 报「后端用 interface 重定义了 `PermissionDecision`」。
改成 `z.infer` 派生后类型当场对不上。**门控本来是防副本的，顺手证明了契约本身不成立。**

### 2. 响应体从未被契约校验过（B-8）

全局 ValidationPipe 校验**进来的**请求，**出去的没有任何东西校验**。
即 ADR-020「同一份 zod → 前后端」这条链，**返回方向是断的**——
服务端返回契约没描述的结构，所有门控照样绿，因为前端类型也从同一份契约生成，
它只会**对现实的判断是错的**，不会报错。

不是假设：契约的 `Organization` 带 `team` 字段，仓储层漏了它。
**在 `contract-response.test.ts` 存在之前，没有任何东西会失败。**

⚠ 刻意**不做**响应校验管道：那会把一次 schema 疏漏变成生产 500。构建期失败才是正确位置。

### 3. NestJS 陷阱：方法级 `@UsePipes` 会作用于每一个参数

包括 `@CurrentPrincipal()`。于是契约 schema 被拿去校验 principal，**所有请求一律 400**，
症状看起来像「客户端请求体不对」，第一反应会去查调用方。
⇒ 校验管道一律挂**参数**上：`@Body(new ZodBodyPipe(SCHEMA))`。

## 需要人类做的（唯一阻塞下一步的事）

**复签 `contracts/identity/design-signoff.md`** —— 上面 B-7 / B-8 两条是对**已签契约束**的修订，
完整记录在 `design-coherence.md` 第八节「修订 B」。顺带确认一条推论：
**「响应必须被契约校验」应当成为所有束的通用要求**，而不只是 identity 补了。
若认可，它该写进 `contract-design.md` 的硬规则。

## 仍未做 / 已知边界

- **acl_bindings 的 artifact / segment 对象未做 I-1 校验** —— 那两张表随 F04 到来。
  触发器已按「加一行即可」的形状写好。**这是已知缺口，写出来而不是留给人发现。**
- **凭证形态未定**（属 phase-01 `01-auth`）。session / 鉴权缓存是**进程内**实现，
  不跨副本、不跨重启——形状对了，换 Redis 只动一个文件。
- **角色矩阵单源在 `domain/identity/project-role-matrix.ts`**。前端要用时必须**迁移**到
  `packages/contracts`，**不是复制**——已有测试守着。没放进契约是因为契约把 `action`
  定成开放 string，收紧成闭合枚举属于签核决定，不是实现决定。
- 合规/法务 Q-1（法定留存清单）仍是真阻塞。

## 下一步最佳动作

**F02 RLS 强制隔离 + 权限沿数据链路传播**（5 点）。它的两半现在都有着落：
RLS 基线来自 F18、判定函数来自 F01，F02 要证的是**六条路径共用同一个判定**
（检索 / Context Pack / embedding / 图遍历 / 文件浏览器 / 缓存）。

```bash
pnpm harness new-sprint --phase 00 --id 04 --features F02
```

⚠ **不要动的东西**：`rls_probe` 表、`kernel-probe` 路由、`lint-arch-deps` 的
`COMPOSITION_ROOT` 白名单、任何 signoff 的 `status` 字段。

## 命令

- 起依赖：`pnpm --filter api run dev:deps`
- 起 API：`pnpm --filter api run dev`
- 验证：`pnpm harness verify --sprint 00/03`
- 体检：`pnpm harness doctor --phase 00`
