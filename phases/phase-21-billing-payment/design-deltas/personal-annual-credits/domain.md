# 个人付款期限与月度额度

依据已确认 `../personal-pricing-v1/design-signoff.md` 和本次定价设计；本项不新增公共购买API。

- 付款期限保存在 billing_personal_terms，余额和月度额度仍只有既有 credit_wallets / credit_transactions / credit_subscription_periods 一套。
- 每笔可信付款绑定 provider/payment_ref、user、subscription_ref、目录版本、SKU、金额/币种、付款起止时间。重放参数不同拒绝，跨用户不可改配，付款期限不重叠。
- 原始 purchase_anchor 与 month_offset 单独保存；续费即使从短月份末日开始，下一个边界仍从原始锚点计算。每个边界保留UTC时分秒及毫秒。
- 年付包含十二个月度窗口，月付包含一个窗口；以已验证付款起止核对原始锚点和偏移，不接收浏览器计算的发放日期。Stripe后续接线必须复用服务端保存的原锚点，不能把短月份的 current_period_start 重新作为购买日。
- 已开始窗口才发放；稳定的term_id与月内index组成批次身份。并发与重复调度使用个人订阅advisory锁及既有钱包锁。
- 迟到调度逐笔留下发放/过期流水，过期批次不会复活；未消耗的周期额度回收，永久充值与负余额保留。
- 内部函数允许显式时钟用于数据库时间边界测试，运行时默认为当前时刻；不存在客户端指定时钟入口。
- recordPaidPersonalTerm仅用于后续已验签/可信供应商读取、归属核对后的结算入口，不可直接暴露给客户端。该内部函数本身不能代替供应商收款证明。

当前实现阶段：先验证持久化/发放基础及钱包读取/AI准入接线；在线支付接线、UI新读模型、完整旧计费数据清理仍属于后续交付。
