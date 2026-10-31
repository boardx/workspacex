# 四种支付组合补齐进展

2026-10-31 用户直接交办，issue #6050，PR #6051，目标 develop。复用本会话工作树，已获取最新 main/develop 并从 develop 开发；不改 feature_list 或人工签核状态。

已补齐 Stripe 充值与微信月卡，复用永久充值和月度额度账本。新购按 BILLING_DEPLOYMENT 限制 CN 微信、US 正式 Stripe、devapp 微信及测试 Stripe；历史回调与新购开关分离。微信月卡商户号使用 bm 前缀，充值使用 bg，避免两种商品支付身份碰撞。

本地验证：支付协议及配置 35 项、Web 计费及菜单 99 项、API/PG 广泛回归 86 项及最终恢复专项 6 项通过。GitHub 当前支付专项已在提交 a4cef5236413fb8f9460fea0e61187118340e3e8 上通过 11 个真实浏览器/API/PG 场景。独立 feature reviewer 接受该提交。没有正式商户扣款、历史订阅变更或生产发布。

CI 后续发现新增迁移重放和旧原型请求体断言问题，本轮已修复；本地 migrate:check 证明空库重建、全部 SQL 强制重放及存量数据保持一致，billing-subscription-live 原型浏览器测试通过。最终 CI 必须按 PR 当前 head 重新检查，不能沿用旧提交通过结论。harness tick 因缺少 COORD_GATEWAY_URL 失败关闭，没有伪造 Directory 身份或租约。

关闭全部新购渠道后，带 credit_order 的付款返回仍可进入授权订单查询，不创建新单；新增页面回归通过。

Stripe 组织充值的成功及取消回跳保留 ownerType、ownerId 和收银台入口；个人付款返回不消费其 credit_order 查询参数。
