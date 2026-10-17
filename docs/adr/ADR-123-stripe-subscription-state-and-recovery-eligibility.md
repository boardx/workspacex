# ADR-123: Stripe subscription state and recovery eligibility

- 状态: Proposed
- 适用层：项目实现（专属）
- 日期: 2026-10-17
- 关联：#5806

## 背景

已签 Stripe 束要求 webhook 原样保存状态、只有 active/trialing 展示有效权益、已有订阅不重复售卖。但封闭枚举未包括 paused/incomplete_expired；I-5 又以同一“已订阅”概念判定管理资格。照字面实现会让欠费用户无法处理原账单而获得新购买入口。参考仓库使用无约束字符串保存原状态，没有解决本仓封闭契约与入口资格的矛盾。

## 决策提案

采纳 [Stripe 状态与付款恢复契约补充](../../phases/phase-21-billing-payment/design-deltas/stripe-state-recovery/contract.md) 中的唯一状态/资格映射。有效权益、可创建新订阅、可管理已有账单分别建模，公开状态原样保存；枚举增补与 UI/用例/持久化约束同步。既有操作形状、错误码与 webhook 唯写者不变。具体状态集合和表格只在补充提案维护，本 ADR 不重复。用户级绑定代次防止已退休订阅的迟到事件覆盖新订阅；当前状态无法确认时保留历史快照但按补充提案503拒绝当前权益/链接，不能将旧 active 冒充当前确认状态。

当前为提案，不修改现有设计签核、契约或运行时。采纳记录不能由 agent 冒充人类签核。

## 后果

用户可从付款异常/暂停状态恢复账单，页面不会误授予 Pro 或再次售卖已知非终态订阅。需要更新 schema、数据库 CHECK、共享资格策略、UI 文案与覆盖测试；旧消费者必须明确处理新增状态。静态 Payment Link 的跨窗口多 Checkout Session 风险仍存在，opaque intent 解决绑定而不等于 provider 创建幂等，实施时不得混淆这些保证。

## 备选

沿用仅有效权益的单一分类虽省改动，却阻断付款恢复并可能重复售卖；将遗漏状态别名映射为 none/canceled 则违反人类原样落库裁决并掩盖真实状态。两者均不推荐。更换为可复用 Checkout Session 可增强跨窗口创建保证，但超出本次状态澄清，需独立评估配置与行为影响。
