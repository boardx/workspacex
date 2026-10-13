---
bundle: billing-credits
phase: "21"
covers: [F01, F-TBD-billing-config, F-TBD-credit-order-core, F-TBD-wallet-ledger-query, F-TBD-wechat-notify, F-TBD-order-close-task, F-TBD-mock-paid, F-TBD-admin-grant, F-TBD-org-billing-setting, F-TBD-cashier-ui, F-TBD-admin-ui, F-TBD-org-billing-ui]
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-10-01T03:23:47Z"
confirmed_via: "人类对话确认（2026-10-01；agent 按人类指示代为回填）"
---

# 契约束 `billing-credits` 设计签核

> 签核状态只由人类填写（ADR-023 决策五，CODEOWNERS + CI 保护）。agent 不写 `confirmed_*`。
> `covers:` 待 requirement-author 产出 feature 编号后填写——它是**束↔feature 映射的权威**（ADR-023 决策三），
> 本文件下方任何覆盖表都只是它的派生视图。

覆盖意图（派生视图；权威是 frontmatter `covers:`；占位 id 在 claim 取号时由工具原子改写为正式编号）：

| feature | 能力边界 |
|---|---|
| F01 | 六表迁移与套餐种子（共享表 `billing_webhook_events` 单源） |
| F-TBD-billing-config | 渠道配置读模型 + 旧骨架收敛（未配置不阻塞启动） |
| F-TBD-credit-order-core | 套餐列表 / 创建订单（无金额入参）/ 订单查询归属 |
| F-TBD-wallet-ledger-query | 钱包与流水查询（账实相符的查询侧） |
| F-TBD-wechat-notify | 回调验签解密 / 原子抢占 / 幂等入账（含 CLOSED 兜底） |
| F-TBD-order-close-task | 15 分钟过期关单任务（CLOSED 唯一触发者） |
| F-TBD-mock-paid | 非生产 mock 通道（复用同一入账内核） |
| F-TBD-admin-grant | 管理端查钱包 + 人工发放（原因必填、留痕） |
| F-TBD-org-billing-setting | 组织计费开关 + 下单 I-12 校验分支 |
| F-TBD-cashier-ui | 收银台弹窗（套餐 / 二维码 / 轮询 / 五终态） |
| F-TBD-admin-ui | 计费管理端 UI（钱包卡 / 流水表 / 发放二次确认） |
| F-TBD-org-billing-ui | 组织计费区块 UI（钱包 / 购买入口 / 开关） |

## 一、材料清单

- ① UI：`ui.md`（收银台 11 张 + 计费管理端 8 张 + 组织计费区块 3 张 + 菜单入口 2 张 = 24 张截图，目录 `ui-preview/billing-credits/`）。
- ② 用例：`usecases.md`（UC-BC-1～UC-BC-12 对外 + 内部端口 UC-BC-I1～I5，失败模式穷举）。
- ③ API 契约：`packages/contracts/src/billing-credits.ts`（12 个 operations + 封闭枚举 + 订单快照/幂等/入账不变量）。
- 支撑·领域模型：`domain.md`（I-1～I-14）。
- 支撑·覆盖证明：`coverage.md`（V1–V19 双向核对，无孤儿操作）。

## ① UI — 人看到的界面对不对

- [ ] 收银台五态语义可分：待支付（二维码 + 每秒倒计时）/ 成功 / **过期 = warning 非错误红 + 遮罩防误扫 + 重新生成** / 失败 = destructive + 用户可读原因 + 重试 / 空态不编造套餐。
- [ ] E1/E2：渠道未配置时不出现"永远扫不成功"的假二维码；下单失败可重试且不落假订单。
- [ ] 权限投影：组织普通成员整窗 denied（不泄露余额/流水）；管理端非平台角色 denied；组织区块对普通成员隐藏。
- [ ] 资金动作显式：发放二次确认列四项影响（主体 / 额度 / 原因 / 发放后余额）——重点核对 `04-admin-grant-confirm`。
- [ ] 组织开关关闭的后果呈现：购买禁用 + 说明条 + **已购余额仍可见**（只影响新建，I-12）。

## ② 用例 — 业务流程对不对

- [ ] 订单状态机五条边各自有触发者；`CLOSED` 由**定时关单任务**驱动（参考实现没有此任务，本阶段必须有）。
- [ ] 回调链路：先验签（**不得跳过**，参考实现的缺陷禁止照搬）→ 解密 → 金额一致 → 事件幂等 → 原子抢占 → 入账；失败留痕。
- [ ] 已关闭订单收到成功回调：资金优先，入账 + 告警留痕（E5）。
- [ ] 至多一次入账：重复 / 并发回调不双记（I-2 / I-6 / I-7）。
- [ ] 失败模式穷举（见 usecases.md 各 UC 的 `err`）。
- [ ] mock 通道：非生产可用、生产硬拒绝（403）且不改状态。

## ③ API 契约 — 接口形状对不对

- [ ] 12 个 operations 的路径与方法（`/billing/config`、`/billing/packages`、`/billing/orders`、`/billing/orders/:orderNo`、`/billing/wallet`、`/billing/transactions`、`/billing/webhooks/wechat`、`mock-paid`、`/billing/admin/*`、`/billing/org-settings/:orgId`）。
- [ ] `BillingErrorCode` 枚举成员够用且不多余；错误语义与 subscription 束一致（未配置 = `payment_provider_not_configured`；验签 = `signature_invalid`）。
- [ ] 订单快照不可变（I-5）；订单视图含 `paidAt`/`notifyAt`/`expiredAt`/`closedAt`/`lastErrorCode`；金额为整数分、服务端唯一计算源。
- [ ] webhook 的 raw-body 表示与 `{code: SUCCESS|FAIL}` 两值应答语义。

## 待签核人裁决的开放问题

见 `usecases.md` 末节 **Q1–Q6**：额度整数、订单查询形态（GET 路径 vs POST status）、关单任务通道与周期、发放限额/审批、组织钱包成员可见性、webhook 事件表保留策略。

**已裁决（2026-10-01 对话）**：Q5 = 组织钱包/流水仅 owner/admin 与平台管理员可读；其余按契约默认。
