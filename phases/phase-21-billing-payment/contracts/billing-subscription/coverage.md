# 契约束 `billing-subscription` — UC 覆盖证明（支撑材料）

> 需求单一事实源：`requirements/03-subscription-stripe.md` R12 节（行键 V1–V8 按出现顺序编号）。
> API 操作名均为 `packages/contracts/src/billing-subscription.ts` 的 `billingSubscription.<op>`；
> 内部端口见 `usecases.md` 第二节。前端消费点写的是**功能区域**（UI 先行截图的 `data-testid` 定稿后在此补齐，见 ui.md）。

## 一、R12 → API 操作 → 前端消费点

| 行键 | 验收线索（来源） | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 03-R12 成功态：免费用户取链接 → 跳转 Stripe → 回跳后显示已订阅 | `getUpgradeLink`、`getSubscriptionInfo` | 升级弹窗（升级按钮 + 回跳后状态） | 契约闭合；待实现 |
| V2 | 03-R12 成功态：已订阅用户进入管理页并可回跳刷新 | `getManagementLink`、`getSubscriptionInfo` | 用户菜单「管理订阅」入口 | 契约闭合；待实现 |
| V3 | 03-R12 成功态：webhook 更新状态后界面可见 | `stripeWebhook`（唯一写者）→ `getSubscriptionInfo` | 用户菜单计划标识 / 升级弹窗状态 | 契约闭合；待实现 |
| V4 | 03-R12 E1：未配置不跳无效地址（入口隐藏或明确报错） | `getUpgradeLink` / `getManagementLink`（`payment_provider_not_configured`）+ 与 billing-credits 同源的 `getBillingConfig` | 入口可见性 | 契约闭合；待实现 |
| V5 | 03-R12 E3：webhook 验签失败不更新任何状态（I-7） | `stripeWebhook`（400 + 拒绝审计） | —（API 层验收） | 契约闭合；待实现 |
| V6 | 03-R12 E4：重放 webhook 不产生重复写入（I-3） | `stripeWebhook`（`provider_event_id` 去重） | —（API 层验收） | 契约闭合；待实现 |
| V7 | 03-R12 E6：已订阅不重复售卖（按钮切换为管理入口） | `getUpgradeLink`（`already_subscribed`）、`getManagementLink`（`not_subscribed`） | 升级/管理弹窗按钮态 | 契约闭合；待实现 |
| V8 | 03-R12 权限态：他人订阅不可见、未登录不可用、管理员无代改能力 | `getSubscriptionInfo` 等全部 operations（登录前置；按用户维度天然隔离，无管理员代改操作） | 菜单入口按登录态渲染 | 契约闭合；待实现 |

## 二、反向核对：API → UC（无孤儿操作）

| API 操作 | 被哪些行需要 |
|---|---|
| `getSubscriptionInfo` | V1、V2、V3、V8 |
| `getUpgradeLink` | V1、V4、V7 |
| `getManagementLink` | V2、V4、V7 |
| `stripeWebhook` | V3、V5、V6 |

无孤儿操作。内部端口 UC-BS-I1 不对应 HTTP 面，被 V3/V5/V6 的验收路径依赖（见 usecases.md 第二节）。

## 三、开放问题

见 `usecases.md` 末节 Q1–Q4（计划展示名、webhook 事件最小集、管理门户形态、trial 展示语义）。
