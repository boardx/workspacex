---
bundle: billing-subscription
phase: "21"
covers: [F-TBD-subscription-backend, F-TBD-stripe-webhook-sync, F-TBD-subscription-ui]
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-10-01T03:23:47Z"
confirmed_via: "人类对话确认（2026-10-01；agent 按人类指示代为回填）"
---

# 契约束 `billing-subscription` 设计签核

> 签核状态只由人类填写（ADR-023 决策五，CODEOWNERS + CI 保护）。agent 不写 `confirmed_*`。
> `covers:` 待 requirement-author 产出 feature 编号后填写——它是**束↔feature 映射的权威**（ADR-023 决策三）。

覆盖意图（派生视图；权威是 frontmatter `covers:`；占位 id 在 claim 取号时由工具原子改写为正式编号）：

| feature | 能力边界 |
|---|---|
| F-TBD-subscription-backend | 订阅状态 / 升级链接 / 管理链接 + `billing_subscriptions` 迁移 |
| F-TBD-stripe-webhook-sync | webhook 验签 / 事件幂等 / 唯一写者 upsert / 未知事件 ignored |
| F-TBD-subscription-ui | 订阅弹窗五变体 + 菜单 Pro 徽标 / 升级与管理入口 |

## 一、材料清单

- ① UI：`ui.md`（订阅弹窗 7 张 + 菜单入口 2 张 = 9 张截图，目录 `ui-preview/billing-subscription/`）。
- ② 用例：`usecases.md`（UC-BS-1～UC-BS-4 对外 + 内部端口 UC-BS-I1，失败模式穷举）。
- ③ API 契约：`packages/contracts/src/billing-subscription.ts`（4 个 operations + 封闭枚举）。
- 支撑·领域模型：`domain.md`（I-1～I-7）。
- 支撑·覆盖证明：`coverage.md`（V1–V8 双向核对，无孤儿操作）。

## ① UI — 人看到的界面对不对

- [ ] 五变体可分：free（升级按钮）/ active（管理入口）/ trialing（按已订阅语义 + 试用说明）/ canceled（**两处**讲清生效时点，E5）/ syncing（回跳早于 webhook 的诚实呈现，**不得把已订阅显示为免费**，E2）。
- [ ] E1：未配置时不跳无效地址（入口不可用或明确报错）。
- [ ] 入口投影：免费用户菜单显示「升级订阅」；已订阅显示 Pro 徽标 + 「我的订阅」。
- [ ] 不加戏：不做乐观假状态（订阅状态唯一权威是 webhook）。

## ② 用例 — 业务流程对不对

- [ ] webhook 是**唯一写者**（I-1）：用户侧接口只读，回跳不写状态。
- [ ] 事件幂等（I-3）：重复 / 重放 webhook 不产生重复写入。
- [ ] 验签失败不写任何状态（I-7）。
- [ ] 链接按状态单义（I-5）：`already_subscribed` / `not_subscribed` 不静默互发。
- [ ] 未配置渠道**不阻塞启动**（I-6；参考实现因 STRIPE_* 强制必填导致启动失败，禁止照搬）。
- [ ] 失败模式穷举（见 usecases.md 各 UC 的 `err`）。

## ③ API 契约 — 接口形状对不对

- [ ] 4 个 operations 的路径与方法（`/billing/subscription`、`upgrade-link`、`management-link`、`/billing/webhooks/stripe`）。
- [ ] `SubscriptionStatus` 枚举（含 `none` = 无记录不是错误）；`SubscriptionErrorCode` 与 credits 束错误语义一致（未配置 = `payment_provider_not_configured`）。
- [ ] `SubscriptionInfo` 字段（`planRef` / `currentPeriodEnd` / `cancelAtPeriodEnd`）够用且不多余；展示名映射归 UI 层。
- [ ] webhook raw-body 表示与 `{received: true}` 应答；未知事件 200 + ignored 审计（不是错误码）。

## 待签核人裁决的开放问题

见 `usecases.md` 末节 **Q1–Q4**：计划展示名与是否维护计划目录、webhook 事件最小集（`invoice.payment_failed` 是否覆盖）、管理门户形态（静态 URL vs 运行时 session）、`trialing` 是否按"已订阅"呈现。

**已裁决（2026-10-01 对话）**：Stripe 订阅状态原样落库（含 past_due / incomplete / unpaid），webhook 覆盖 `invoice.payment_failed`；其余按契约默认。
