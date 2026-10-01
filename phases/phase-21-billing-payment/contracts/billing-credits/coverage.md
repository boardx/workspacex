# 契约束 `billing-credits` — UC 覆盖证明（支撑材料）

> 需求单一事实源：`requirements/01-credits-topup.md`、`02-payment-order-notify.md`、`04-billing-admin.md` 的 R12 节
> （各行键 V1–V19 按"01 → 02 → 04"的出现顺序编号）。
> API 操作名均为 `packages/contracts/src/billing-credits.ts` 的 `billingCredits.<op>`；内部端口见 `usecases.md` 第二节。
> 前端消费点写的是**功能区域**（UI 先行截图的 `data-testid` 定稿后在此补齐精确锚点，见 ui.md）。

## 一、R12 → API 操作 → 前端消费点

| 行键 | 验收线索（来源） | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 01-R12 成功态：选套餐 → 生成二维码 → 回调 → 轮询显示成功 → 余额与流水更新 | `listPackages`、`createPaymentOrder`、`getPaymentOrder`、`getWallet`、`listTransactions` | 收银台弹窗（套餐卡 / 生成二维码 / 二维码区 / 轮询）；钱包与流水入口 | 契约闭合；待实现 |
| V2 | 01-R12 E1：渠道未配置时入口隐藏/明确失败（不是永远失败的二维码） | `getBillingConfig`（`enabledProviders=[]` 时 UI 隐藏） | 收银台入口（隐藏态） | 契约闭合；待实现 |
| V3 | 01-R12 E2：微信下单失败可重试、无"假二维码"订单（I-13） | `createPaymentOrder`（`wechat_upstream_failed`，失败不落库） | 收银台错误提示 + 重试按钮 | 契约闭合；待实现 |
| V4 | 01-R12 E3：超时（15 分钟）关单与提示、可重新生成 | `getPaymentOrder`（`CLOSED`）+ 内部 UC-BC-I3 关单任务（定时） | 收银台"已过期"态 + 重新生成按钮 | 契约闭合；待实现 |
| V5 | 01-R12 E5：轮询接口失败不误报成功/失败 | `getPaymentOrder`（纯读；失败仅表现为请求失败） | 收银台轮询容错提示 | 契约闭合；待实现 |
| V6 | 01-R12 E7/E8：组织越权拒绝、套餐下架拒绝 | `createPaymentOrder`（`forbidden` / `package_disabled`） | 组织购买入口权限态、错误提示 | 契约闭合；待实现 |
| V7 | 01-R12 权限：他人订单不可查（按订单号也校验归属） | `getPaymentOrder`（一律 `order_not_found` 收敛） | —（API 层验收） | 契约闭合；待实现 |
| V8 | 01-R12 权限：未登录全部不可用；组织入口对普通成员不可见 | 全部 operations（登录前置；管理接口另判角色） | 菜单入口按登录/角色渲染 | 契约闭合；待实现 |
| V9 | 02-R12 成功态：合法回调 → 订单成功 + 钱包增加 + 流水两条（基础/赠送）+ 时间戳齐全 | `wechatNotify` → 内部 UC-BC-I2；`getPaymentOrder`、`getWallet`、`listTransactions` | 收银台成功态；钱包/流水更新 | 契约闭合；待实现 |
| V10 | 02-R12 E1：验签失败不入账 | `wechatNotify`（验签失败 → ack FAIL + 审计，不写钱包） | —（API 层验收） | 契约闭合；待实现 |
| V11 | 02-R12 E2：金额不符拒绝入账（I-5） | `wechatNotify`（`amount_mismatch` 审计路径） | —（API 层验收） | 契约闭合；待实现 |
| V12 | 02-R12 E4：重复回调不双记（I-7 事件幂等） | `wechatNotify`（`provider_event_id` 去重） | —（API 层验收） | 契约闭合；待实现 |
| V13 | 02-R12 并发：同一订单并发回调只入账一次（I-6 原子抢占） | `wechatNotify`（PENDING→PROCESSING 条件更新） | —（API 层验收） | 契约闭合；待实现 |
| V14 | 02-R12 E7：处理进程崩溃/重启不丢单（微信重试 + 幂等键） | `wechatNotify`（重试到达后按幂等继续） | —（API 层验收） | 契约闭合；待实现 |
| V15 | 02-R12 状态机：五状态每条合法边可复现；`CLOSED` 有真实关单任务驱动 | `getPaymentOrder`（状态可观察）+ 内部 UC-BC-I3；合法边见 domain.md I-1 | 收银台各状态呈现（待支付/成功/过期/失败） | 契约闭合；待实现 |
| V16 | 02-R12 E6：mock 端点在生产返回 403 且订单不变 | `mockCompletePaymentOrder`（`mock_forbidden`） | —（测试环境专用） | 契约闭合；待实现 |
| V17 | 04-R12 成功态：发放后余额与流水一致；操作者与原因可查 | `adminGrantCredits`、`adminGetWallet`、`listTransactions` | 管理端钱包卡 / 流水列表 / 发放表单 | 契约闭合；待实现 |
| V18 | 04-R12 异常与权限：无权 403、非法参数拒绝、并发发放不丢笔、不存在主体 404；组织管理员仅限本组织；发放仅平台管理员 | `adminGrantCredits`、`adminGetWallet`、`updateOrgBillingSetting` | 管理端各错误态与角色可见性 | 契约闭合；待实现 |
| V19 | 04-R12 组织开关生效于购买入口（只影响新建，I-12） | `getOrgBillingSetting`、`updateOrgBillingSetting`、`createPaymentOrder`（`org_billing_disabled`） | 组织管理页开关 + 组织购买入口可用性 | 契约闭合；待实现 |

## 二、反向核对：API → UC（无孤儿操作）

| API 操作 | 被哪些行需要 |
|---|---|
| `getBillingConfig` | V2（入口可用性） |
| `listPackages` | V1 |
| `createPaymentOrder` | V1、V3、V6、V19 |
| `getPaymentOrder` | V1、V4、V5、V7、V15 |
| `getWallet` | V1、V9 |
| `listTransactions` | V1、V9、V17 |
| `wechatNotify` | V9、V10、V11、V12、V13、V14 |
| `mockCompletePaymentOrder` | V16 |
| `adminGetWallet` | V17、V18 |
| `adminGrantCredits` | V17、V18 |
| `getOrgBillingSetting` | V19 |
| `updateOrgBillingSetting` | V18、V19 |

无孤儿操作。内部端口（UC-BC-I1～I5）不对应 HTTP 面，但被 V3/V4/V9–V15 的验收路径依赖（见 usecases.md 第二节）。

## 三、开放问题

见 `usecases.md` 末节 Q1–Q6（额度整数、订单查询形态、关单任务通道、发放限额、成员可见性、webhook 事件保留策略）。
