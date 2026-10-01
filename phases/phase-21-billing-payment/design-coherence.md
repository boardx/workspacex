---
phase: "21"
covers_bundles: [billing-credits, billing-subscription]
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-10-01T03:23:47Z"
confirmed_via: "人类对话确认（2026-10-01；agent 按人类指示代为回填）"
---

# Phase 21 阶段一致性复核

> 待人类复核。只检查**跨束**问题：同一事实是否在两个束里各声明一次、不变量是否互相矛盾、
> 级联是否闭合、同一失败是否在不同束里给了不同错误码。
> agent 不修改本文件的 status / confirmed_by / confirmed_at 字段（ADR-023 决策五，CODEOWNERS + CI 保护）。

## 复核范围

| 束 | 核心不变量 | 主要交叉边界 |
|---|---|---|
| `billing-credits` | 订单至多入账一次；账实相符（余额 == 流水代数和）；无假二维码；五状态封闭且每条边有触发者 | `billing-subscription`（共用 `billing_webhook_events` 表与 `enabledProviders` 读模型） |
| `billing-subscription` | webhook 是订阅状态唯一写者；事件幂等；未配置渠道不阻塞启动 | `billing-credits`（同上；两束状态互相独立） |

## XC-01 · 同一事实只声明一次

- [ ] 渠道启用读模型（`enabledProviders`）：单源在 `billing-credits` 的 `getBillingConfig`；
      `billing-subscription` 只消费、不另定义（两束的入口可用性都读同一字段）。
- [ ] `billing_webhook_events` 表结构单源在 `billing-credits` 契约（`provider` 列区分 `wechat`/`stripe`）；
      `billing-subscription` 引用不重复定义。
- [ ] 额度 / 钱包 / 流水实体只存在于 `billing-credits`；订阅束不持有任何额度状态。

## XC-02 · 错误码一致

- [ ] 「渠道未配置」在两束同为 `payment_provider_not_configured`（2026-10-01 收敛：
      subscription 束原 `subscription_not_configured` 已改名对齐）。
- [ ] 「webhook 验签失败」在两束同为 `signature_invalid`，语义一致（拒绝 + 不写任何业务状态 + 审计）。
- [ ] 通用越权同为 `forbidden`；无归属/不存在的资源一律收敛为"找不到"语义
      （credits：`order_not_found` / `owner_not_found`；订阅按用户维度天然隔离、无此类场景）。

## XC-03 · 级联闭合

- [ ] 微信回调入账与 Stripe webhook **互不触发**（两束之间不存在写路径）——防"付款触发订阅升级"之类隐式级联。
- [ ] `enabledProviders` 变化（部署配置）同时影响两束入口，且两束都不持久化渠道状态（无迁移负担）。
- [ ] 组织计费开关（credits）不影响订阅可用性；订阅取消不影响既有额度余额——交叉影响必须为零。

## XC-04 · 权限语义一致

- [ ] 订阅按用户维度天然隔离（**不提供**管理员代改订阅的操作）；credits 的管理端能力（查询/发放）
      不扩展到订阅。
- [ ] 两束的未登录 / 越权 / 不泄露存在性语义一致（401 不可用、403 拒绝、无归属按 not_found 收敛）。
