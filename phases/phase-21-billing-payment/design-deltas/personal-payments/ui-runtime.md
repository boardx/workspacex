# 个人定价 UI 接线与验证边界

沿用已采用界面及个人支付签核。正式 `/billing` 由服务端运行时 `BILLING_PERSONAL_PRICING_UI_ENABLED=true` 选择新个人界面，默认关闭；Team 分支仍由后续阶段接线。该开关只选界面，不能启用计费代际、修改价格或放宽鉴权。本次没有修改任何部署环境变量。

新界面读取版本化目录、本人钱包与权益；金额、币种、有效期和月额度均由服务端返回。未知永久余额/赠送/权益不能伪装成0。付款前本地保存原请求的幂等键，模糊结果保留原购买，仅用户动作重试；状态必须由本人订单GET核实。回跳参数只是打开恢复界面的提示，不是支付证明。已存在真实地址的终态也必须先查状态，不能再次导航付款。

新销售关闭不删除恢复指针。正常待支付有真实二维码/Stripe地址；本地超时隐藏支付入口，但不视为商户关单；人工复核不显示成功或重新购买；已核实关闭后才由用户重新选套餐。地址与门户校验由`payment-url.ts`统一维护。客户端从不写余额，React回调只刷新真实账户读模型。

本次隔离浏览器使用真实Next、BillingModule、PrincipalGuard、PostgreSQL与签名支付商HTTP fixture；仅身份显示和托管支付商网页受控，计费HTTP未拦截。不代表在线商户实付或生产验收。标准入口为API的`vitest.billing-cashier.config.ts`，拥有的Next进程组、端口、Chromium与隔离数据库必须完整释放。

缺失支付页终态恢复修订已获本次人工确认并实现，独立恢复增量审查与真实浏览器异常链路通过。上线前仍须完成整功能审查/CI、前置年付/赠送顺序集成、全量旧计费清理与外部旧续费处理。由独立发布步骤同时核对新界面开关和计费epoch，禁止把这个界面开关当成reset/激活授权。本文件不授权生产部署。

本次恢复修订验证：完整browser17、React107、contracts1254、provider166、真实PG/HTTP39、旧PG42、local parity12、API/Web/local-runtime类型lint11及受影响25任务通过。见evidence/order-outcomes/；paid-without-binding.png为真实API/PG及独立Stripe HTTP/HMAC fixture的成功恢复画面，不是在线商户实付。

此前UI运行时检查点的移动端补测1项（2项过滤）与PGlite迁移/注册3项另见evidence/ui-runtime/，不是本次重跑结果。移动端历史刷新截图为请求中画面，不作为历史到账内容断言。
