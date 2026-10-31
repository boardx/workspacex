# Billing Overview Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in the current session.

**Goal:** 简洁地区分充值与订阅额度，并提供真实订阅历史。
**Architecture:** 复用钱包、订阅和收银台；新增本人订阅历史只读契约，付款完成时保存金额快照。列表分页不依赖支付商在线。
**Tech Stack:** TypeScript / React / NestJS / PostgreSQL / Zod / Vitest.
**Spec:** docs/superpowers/specs/2026-10-31-billing-overview-design.md

## Global Constraints
仅合入develop；复用本会话worktree；不改历史SQL、不伪造旧费用、不改支付扣费规则。

## Review Focus
账号切换取消旧请求；历史严格按principal.userId；未知金额不等于零；待发放不等于零；到期/续费停止不误判Pro。

### Task 1: 历史数据与API
- [x] 写契约/存储隔离/金额缺失测试，运行确认失败。
- [x] billing-subscription契约增加GET /billing/subscription/history，limit/offset分页；只返回展示字段。
- [x] PgBillingSubscriptionRepository按本人查询已付费周期、月度订单、无周期旧订阅；避免同一周期重复。
- [x] 新增monthly订单金额/币种可空快照SQL；付款验真成功时记录实付值，旧金额保持null。
- [x] service/controller复用现有认证与错误映射；运行测试、API类型检查。

### Task 2: 简洁页面
- [x] 写100充值+15000订阅=75%分区断言及历史异常/分页测试，确认失败。
- [x] personal-menu移除独立购买入口；billing-overview左侧仅permanentBalance与购买/usage按钮。
- [x] live-subscription显示Pro状态、本期余额与剩余百分比；历史组件按本人接口显示日期/实付费与空/失败状态。
- [x] 保留现有支付渠道、二维码、回调刷新与账户切换取消；运行相关前端测试/typecheck/lint和浏览器验收。

### Task 3: 交付
- [ ] 独立review、提交issue证据、创建develop PR，修复CI/review至绿后合入develop。
