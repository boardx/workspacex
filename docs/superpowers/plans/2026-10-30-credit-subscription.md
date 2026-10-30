# Unified Credit Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 交付个人购买、每月 20,000 credit 订阅额度、企业透支和个人/组织用量查询。

**Architecture:** 扩展现有 credit 钱包、请求收据和 PostgreSQL 结算事务。订阅授予采用独立周期批次，实际消费仍走唯一消费账本；付款确认与周期发放共用可恢复、可重放的事务边界。

**Tech Stack:** TypeScript、PostgreSQL、NestJS、Zod contracts、Next.js、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-30-credit-subscription-design.md`（用户已在会话确认）。

## Global Constraints

- 复用本会话 `.worktrees/credit-subscription`；最新 `origin/develop` 为开发基线，PR 目标 `develop`，本次不直接合入 main。
- 个人在物理请求开始时有效余额 >= 0 可发起，< 0 禁发；企业允许负余额；已准入请求允许完成。
- 每个成功付款月周期 20,000 credit；未使用的当期额度到期清零；充值额度长期保留。
- 1 credit = 1,000 token，逐物理请求累计向上取整到 0.01 credit；流式片段扣累计应付与已扣之差。
- 钱包锁、请求/付款/周期幂等键和 RLS 不可绕过；准入与结算失败不静默免费。
- 用户要求跳过本会话 agent 身份接入；不冒用 registry 身份、不伪造租约或心跳。
- 每个实现交付一个 issue/PR；不得修改人类签核状态，不得手改 feature passing。
- 不更改支付价格、生产密钥、充值订单金额快照或原生单位费率。

## Review Focus

1. 同一用户跨个人 workspace 的钱包访问：共享余额但不能读取其他用户用量；任务 1、5 验证。
2. 周期边界遇到充值/消费/回调并发：到期只扣未消费赠送部分、每周期只发一次；任务 1、3 验证。
3. 零余额并发与请求途中负余额：已准入全部可完成，后续新请求禁发；任务 2 验证。
4. 重复、乱序流式收据：相同累计 token 不能因片段数量多而多扣；任务 2 验证。
5. 旧订阅与未核实套餐：先完成付款事实核验和当期补发再切换，不能把试用/年付当月付；任务 4 验证。

## 文件职责与接口

| 文件 | 责任 |
| --- | --- |
| `apps/api/migrations/20261030010000_credit_subscription_periods.sql`（新增） | 周期额度批次、授予/到期流水来源、请求分片唯一键、受控付款发放边界及权限 |
| `apps/api/src/infrastructure/billing/pg-credit-periods.ts`（新增） | 钱包锁内的周期归一化、授予、额度分配；金额以 bigint 百分之一 credit 运算 |
| `apps/api/src/infrastructure/billing/pg-credit-consumption.ts` | 准入和消费接入归一化；个人负余额判断；不以预留余额作为禁发门槛 |
| `apps/api/src/infrastructure/billing/pg-billing-wallet-repository.ts` | 返回有效余额、月度额度、到期时间、永久余额 |
| `apps/api/src/infrastructure/billing/pg-billing-stripe-webhook-store.ts`、`stripe-webhook-client.ts`、`billing-global-boundary.ts` | 核验成功账单事实、幂等发放、保留既有订阅状态恢复边界 |
| `apps/api/src/application/billing/billing-stripe-webhook-service.ts` | 支付提供方账单读取端口 |
| `apps/api/scripts/billing-credit-subscription-backfill.ts`（新增） | 旧订阅 dry-run/实际补发，复用相同周期幂等入口 |
| `packages/contracts/src/billing-credits.ts`、`billing-subscription.ts`、`ai-usage.ts` | 金额、月度余额和用量 credit 的唯一公开形状 |
| `apps/api/src/application/auth/ai-usage-ports.ts`、`infrastructure/auth/pg-ai-usage-repository.ts`、`interface/controllers/ai-usage.controller.ts` | 本人跨组织读取与组织管理员读取，关联实际结算 |
| `apps/web/components/billing/{billing-overview,live-subscription,team-billing-overview}.tsx` | 个人/组织计费状态与月度额度展示 |
| `apps/web/components/admin/ai-usage-{panel,ledger,overview}.tsx`、`apps/web/app/usage/page.tsx` | 个人与组织消费查询和付款归属展示 |

基础接口（仅服务端内部，不是第二份公开 DTO）：

- `normalizeCreditPeriods(session: TenantSession, walletId: string, at: Date): Promise<void>`：调用方先锁钱包；到期只冲销尚未清除批次的 remaining。
- `allocateCreditDebit(session: TenantSession, input: {walletId: string; requestId: string; hundredths: bigint; at: Date}): Promise<void>`：同事务优先消费有效批次，再扣永久额度；不独立提交事务。
- `grantPaidSubscriptionPeriod(session: TenantSession, input: {userId: string; subscriptionRef: string; invoiceRef: string; periodStart: Date; periodEnd: Date; planRef: string}): Promise<'granted'|'duplicate'>`：先验证付款事实与服务端绑定，写唯一周期、授予流水和余额；有效月周期恰好 2,000,000 百分之一 credit。
- `StripeSnapshotProvider.invoice(id: string): Promise<Record<string, unknown>>`：固定 Stripe 基址、版本和服务端凭据；沿用超时、响应体上限与安全错误规则。

## Task 1: 可到期订阅额度与钱包拆分（独立 issue/PR）

**Files:** 上述 migration、`pg-credit-periods.ts`、`pg-billing-wallet-repository.ts`、`billing-credits.ts`；新增 `apps/api/tests/billing/credit-periods-pg.test.ts`。

**Interfaces:** 产出 `normalizeCreditPeriods`、`allocateCreditDebit`、`grantPaidSubscriptionPeriod`；扩展钱包只读字段 `permanentBalance`、`subscriptionCredits`、`subscriptionExpiresAt`。

- [x] Step 1：写失败用例 `expires_only_remaining_subscription_credits`：永久余额 7 + 月度剩余 5，总额 12；到期后总额 7；重复到期仍为 7，只有一条到期流水。
- [x] Step 2：写 `debt_survives_expiry_and_recharge`：赠送 5、永久 2、消费 10 后为 -3；充值 2 后 -1；到期不清除 -1。再写月度/充值并发、跨 workspace 个人余额共享及越权拒绝。
- [x] Step 3：隔离运行新用例，确认失败是缺少新行为：`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/billing/credit-periods-pg.test.ts`。
- [x] Step 4：增加迁移和 helper，锁顺序始终钱包→批次→请求。保留现有钱包 balance 作为总额投影，永久净额从归一化后总额减有效批次剩余额得出，不再存第二份可漂移的永久余额。
- [x] Step 5：钱包读和写使用相同到期归一化；新增授予/到期事务类型采用契约枚举单源。执行 migration 两次并验证旧充值订单快照、原消费与 RLS 兼容。
- [x] Step 6：同一命令验证新用例与 `wallet-ledger-query.test.ts`、`schema-migration.test.ts`、`credit-consumption-pg.test.ts`；全部退出 0 后提交本项，自动建 PR 指向 develop，并跟进 CI。

## Task 2: 请求准入、完成后扣费与流式累计（独立 issue/PR）

**Files:** `pg-credit-consumption.ts`、真实流式计量入口及 `credit-usage-meter.ts` / `durable-credit-usage.ts`；测试 `credit-consumption-pg.test.ts`、`credit-model-gateway.test.ts`、新增 `credit-stream-settlement.test.ts`。

**Interfaces:** 消费 Task 1 helper；物理请求和分片收据必须保留 requestId/receiptId，内部累计结算只产生应付差额。

- [x] Step 1：新增 RED：个人初始 0 放行、实际 1,000 token 扣到 -1，同一请求完成/重放不再扣，下一个新请求 dispatchCount = 0；余额 0.01 同样允许花费超过余额。
- [x] Step 2：新增企业余额 -1 仍能 dispatch，以及个人多个请求都在余额 0 时准入、分别完成的并发断言。切换全局 preflight 不得绕过个人负余额禁发或阻止企业透支。
- [x] Step 3：新增累计快照 1→10→11 token，费用依次为 0.01→0.01→0.02；重复/乱序旧快照不多扣，真正新重试要重新判断余额。跨周期结算使用完成时有效额度。
- [x] Step 4：运行隔离账本测试和 runtime 单测确认 RED；修改准入只判断归一化总余额 `< 0`，保留独立组织配额、身份与账务故障判断；已准入分片使用原始可信付款身份。
- [x] Step 5：沿用 `tokenCreditHundredths` 单源，事务中按累计应扣减已扣结算；持久化分片去重和累计状态，终态后拒绝矛盾收据；取消/失败的真实用量仍计费，未知收据保留待核对。
- [x] Step 6：验证断网恢复/重放/缺失 usage/成员撤销后的在途完成；跑上述测试、`durable-credit-usage.test.ts` 和 `private-auxiliary-credit-pg.test.ts`。退出 0 后提交本项并跟进 develop PR。

## Task 3: 成功付款周期授予与订阅读模型（独立 issue/PR）

**Files:** Stripe 提供方 client/store/port、global SQL boundary、`pg-billing-subscription-repository.ts`、`billing-subscription.ts`；发放断言集中在真实签名 HTTP/PostgreSQL 的 `stripe-webhook.test.ts`，不再另建重复 fixture。

**Interfaces:** 服务端 `invoice(id)`，复用 Task 1 `grantPaidSubscriptionPeriod`；读模型新增当期额度状态，不把 active 或回跳当作发放事实。

- [x] Step 1：RED：已核实月付账单授予 20,000；同一账单两个事件、重复回调、并发重放只有一个周期授予；active/checkout 回跳/付款失败不自动授予。
- [x] Step 2：RED：续费新周期清零旧剩余，取消自动续费保留当期到期日，迟到的旧账单不得覆盖新账期；错用户/customer/subscription/plan/周期、未知套餐和不可信账单全部不发额度。
- [x] Step 3：读取并验证付款账单、账单订阅行和对应 price 的月付 interval；使用已验证的 user/customer/subscription 绑定。首次发票先于 checkout 绑定到达时返回可重试，不写永久 ignored ACK。
- [x] Step 4：事件接收和周期授予同事务提交；payment event 去重与周期去重分离。全局语句必须经过现有 allowlist 和受控函数边界，不新增任意 SQL/任意 userId 授予入口。
- [x] Step 5：补对账重放路径；错误返回可重试且不泄露响应/密钥。扩展订阅读模型，显示授予状态、20,000 上限、到期时间，响应契约正/反向验证。
- [x] Step 6：隔离运行 webhook/grant/订阅回归及支付全局边界测试，退出 0 后提交本项并跟进 develop PR。

## Task 4: 旧订阅迁移和统一准入切换（独立 issue/PR）

**Files:** 新增 backfill script、测试 `apps/api/tests/billing/subscription-credit-backfill.test.ts`、运维说明 `deploy/credit-subscription-migration.md`。

**Interfaces:** 仅消费已核验 invoice 和 Task 3 授予入口；CLI 默认 dry-run，显式 `--apply` 写入，输出统计和未映射 plan ID，不输出用户凭据。

- [x] Step 1：RED：真实付款的有效旧月订阅只补当前账期 20,000，重复运行与 webhook 并发不重复；原余额完整保留，不回溯历史费用。
- [x] Step 2：RED：年付/试用/赠送/无法核实付款的订阅列入待处理清单；任一阻塞未解决，不切换整个部署，不能假设它是月付；未付款订阅不补发。
- [x] Step 3：实现可分页、可恢复 checkpoint 和逐项错误统计，先对账/补发、再开启统一策略；列出套餐映射确认和回滚操作。回滚不删已发生的流水或欠款。
- [x] Step 4：测试 dry-run 不写库、失败重跑、账期边界、分页继续与旧账户切换顺序；实际生产 apply 作为独立发布动作，不从测试结果声称已迁移。
- [x] Step 5：测试退出 0，提交 migration runbook 与脚本并跟进 develop PR。

## Task 5: 用户/组织消费查询与 Billing UI（独立 issue/PR）

**Files:** 上述 ai-usage contracts/ports/repository/controller 与 Billing/usage UI；新增 `apps/api/tests/billing/personal-credit-usage.test.ts`，扩展 web `tests/ui/billing-overview.test.tsx`、`billing-subscription-live.test.tsx`、`ai-usage-panel.test.tsx`；真实浏览器扩展既有 API 驱动 `cashier-browser.integration.ts` 和 `credit-subscription-browser.ts`，复用真实 Next/API/PostgreSQL lane。

**Interfaces:** contracts 新增 `GET /billing/usage`、`GET /billing/usage/calls`，参数沿用时间/模型/分页过滤但禁止 caller 指定另一 userId；组织端复用现有 `/organizations/:orgId/ai-usage`，关联实际消费结果。

- [x] Step 1：RED：同一用户在个人和两个组织的调用可查，并区分付款方；另一用户记录不可见；组织管理员查组织总量与成员，普通成员不能查他人。
- [x] Step 2：新增服务端可信范围解析：跨组织读取先取现有身份系统验证过的成员组织范围，逐租户走 withTenant，再归并分页；不用 browser orgId 扩大范围或关闭 RLS。跨组织游标绑定时间过滤、身份和排序，返回稳定 asOf。
- [x] Step 3：消费列表按收据实际 debit 汇总，不能按总 token 再取整；未知 usage 作为待核对，不能记作 0 credit 已结算；同请求分片合并不重复统计调用数。
- [x] Step 4：RED UI：显示永久余额、当期剩余/20,000、到期时间；个人负余额显示充值入口，企业负余额提示欠款但不禁用模型入口；删除“订阅不自动增加额度”旧文案，订阅回跳只刷新读取。
- [x] Step 5：接线真实 contracts/接口，复用既有组件、token 和权限，不创建第二套 mock DTO；个人用量页切换为本人跨组织查询，付款方明确展示。
- [x] Step 6：隔离 API 用例及 `pnpm --filter web exec vitest run tests/ui/billing-overview.test.tsx tests/ui/billing-subscription-live.test.tsx tests/ui/ai-usage-panel.test.tsx` 通过；真实 Playwright 覆盖充值到账→扣费→到期、个人负余额禁发、组织负余额继续、查询越权。
- [x] Step 7：运行受影响包 typecheck/lint、支付回归与根 init；每个 PR 跟进 CI/review 至绿。按用户要求先合入 develop；普通 worker 按仓库合并权限交给有权者，不自行冒用 coordinator。

## 执行前与收尾检查

- [x] 设计文档已获用户确认；实施计划交付用户审阅并确定执行方式。
- [x] `./init.sh` 退出 0；若失败先修基础状态，不叠实现。
- [x] 以最新 develop 为基线，准备 issue、契约变更材料和验证断言，不修改人类签核状态。
- [x] 每次仅执行一个独立 feature；每个任务先 RED 再 GREEN，证据与具体 SHA 绑定。
- [x] 更新进度和交接，释放本会话数据库测试栈；未部署/未迁移/未验证边界明确保留。

## 当前状态

合入最后语音 PR 前的快照：用户确认设计、选择当前会话逐项实现、跳过身份接入并指定 develop 为目标。Task 1–5 已分别通过 #5998、#6008、#6009、#6015、#6017 合入 develop；实际祖先关系已核实，当前 develop 为 a158e865a5cbc186f031b13d9f1bcb7adad74549。Task 6 实现与独立审阅完成，仍须最终 PR 的当前 head 通过合并门禁并实际进入 develop；GitHub 的实时状态和祖先关系优先于此静态快照。未执行生产补发或部署。

最终本地综合回归 46 文件 / 406 测试、界面 114 测试和 typecheck/lint 通过；PR #6017 的当前 head f15db6041 在真实浏览器 lane 通过 8 测试。source/CI 证据见 `evidence/realtime-voice-credit-6007/`。旧的 feature-base 叠加 PR 不计作 develop 交付，替换与修复记录保留在进度、交接和对应 issue 中。

## Task 6: Actual realtime voice gateway accounting (necessary adapter follow-up, issue #6007)

- [x] Real WebSocket/PG RED proves the direct voice transport bypassed the generic meter.
- [x] Admit before provider connection; use trusted response.done token usage, distinct response IDs and cumulative billing receipts on one physical WebSocket request.
- [x] Preserve unknown/aborted usage as pending; expose typed credit errors without automatic reconnect; wire existing durable meter in main composition.
- [x] Same final reviewer addendum; admission/disconnect race reproduced then fixed with zero nondispatch settlement and replay slot cleanup.
- [x] Final combined payment/usage/voice regression: 46 files / 406 tests. UI114 and current-head actual browser CI8 pass; backfill review corrections pass PostgreSQL/checkpoint/webhook40 and independent source review. Unknown terminal retention and late terminal enrichment both retain their confirmed financial facts.
- [x] Final explicit-stop review edge: actual WS/PG RED pending/null; pre/post-admission hangingUp guards prevent dispatch after a stop. Focused gateway/durable/voice/transcript76 passes, covering stop and disconnect zero settlement with durable cleanup. Comprehensive406 is the earlier broader run, not an unrun407.
- [ ] Follow all integration PRs to green and integrate develop; no production cutover/apply/deploy in this task.
