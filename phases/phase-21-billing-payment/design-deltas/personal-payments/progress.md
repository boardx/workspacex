# 个人支付闭环进展

Issue #6093，执行已确认 personal-pricing-v1 设计；唯一工作区、worker/cn-us-personal-payments，父 1d2411a2fa769756efd28175c59fb6aee8441dea。前置 #6088 的 PR #6094 等待 CI；后续依赖分支按顺序独立集成，最终本项剥离旧父再提单独 PR。

实现前先固定支付商协议与购买绑定失败测试。Stripe API 固定沿用仓库 2025-09-30.clover，官方 Checkout 文档确认 subscription mode、recurring interval month/year、币种小写、expires_at 仅允许创建后30分钟至24小时；不照搬旧微信15分钟到 Stripe。

资料：https://docs.stripe.com/api/checkout/sessions/create?api-version=2025-09-30.clover；https://docs.stripe.com/api/checkout/sessions/create.md?query=line_items&api-version=2025-09-30.clover；https://docs.stripe.com/billing/subscriptions/webhooks。

Ruling: 单次购买意图使用服务端持久化报价与原始 provider 幂等身份，支付调用在事务外；重试不生成新支付身份。新入口默认受 dormant accounting epoch 约束，当前不执行真实清理或激活。

2026-11-02：Checkout 14项与到账绑定24项定向测试已红→绿。PG意图测试已在隔离wrapper中因repository尚缺而失败（6项待实现）；一次裸跑被标准环境保护拒绝，没有访问共享数据库，该环境错误不作为功能红证据。全API类型检查结束并指出3处测试fixture将价格推断为字面量联合，故故障注入的1不被允许；恢复后将fixture金额显式拓宽为number，再复验，尚无类型通过结论。当前切回契约分支修复 #6094；本项全部改动精确stash保存，恢复后继续持久化与支付闭环。

契约PR #6094 的精确代理修复 fa09a6c17 已推送并获独立ACCEPT，20项推送前门禁通过，当前等CI。本地附加 verify:harness:raw 的静态门已执行到末项且无失败；额外全harness测试阶段主动停止，不声明该整套命令通过。现在恢复本项，继续待实现的PG意图测试。

当前增量：服务端报价、持久化幂等意图、epoch关闭保护、Stripe协议与到账校验、独立HTTP控制器。provider 14文件113项、隔离PG意图7项、真实回环HTTP2项与API lint均通过。新增SQL约束测试先暴露NULL三值逻辑允许半绑定，补显式非空后7项全绿；应用角色不可修改原报价。HTTP使用真实PrincipalGuard/全局错误边界/PG，PrincipalResolver与上游支付为fixture，不能宣称完整生产登录或商户在线付款。

尚未将新控制器注册进BillingModule；微信适配器、支付到账持久化回调、Stripe续费状态与过期意图恢复仍待实现。只完成上述组件，不宣称 #6093 已完成，暂不创建未完成PR。API类型检查复验运行中。

检查点：新增微信一次性月/年/充值适配器、权威查单和关单后重读，配置平台公钥时拒绝未签名响应。provider全量15文件129项、API typecheck、API lint均通过；PG意图7项和HTTP2项的证据仍为此前对应实现。正式BillingModule接线、到账持久化、Stripe订阅续费/管理与异常恢复继续待实现，本检查点不等于feature完成。微信官方Native说明已核实：支付结束时间不足下单后1分钟会被上游调整，故创建前留1分钟余量；关闭结果只认权威重读，不能仅凭本地时钟。资料：https://pay.wechatpay.cn/doc/v3/merchant/4012791877。

微信到账检查点：真实RSA/AES回环HTTP与PG回调5项（含激活前旧路径、激活后旧订单忽略、未知generation拒绝）；支付事务10项。两文件最终15/15通过。此前意图7项/HTTP2项及provider131通过；本次API类型与lint通过。外部支付商仍为带真实签名的fixture，不代表在线扣款；正式BillingModule接线及Stripe Pro绑定/自动续费尚未完成。
