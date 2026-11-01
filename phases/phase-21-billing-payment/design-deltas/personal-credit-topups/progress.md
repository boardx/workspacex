# 中美永久充值进展

Issue #6090，分支 worker/cn-us-credit-topups，父提交41cf12014。沿用已确认UI及个人支付设计。

真实订单链路支持CN CNY与US USD三档永久充值；服务端过滤部署市场，外区SKU无法下单，微信限CNY，Stripe请求和回调均核对订单币种快照。前端收银台接受受支持的USD订单，继续校验支付地址。新套餐SQL从domain目录生成，重复应用不改变已有订单，遇到冲突快照报错。旧参考套餐停用；完整旧计费数据重置属于后续独立交付。

DevApp默认CN市场可测试两渠道，可由可信服务端BILLING_CATALOG_MARKET=us切换USD测试（仅Stripe test）；生产CN/US忽略该覆盖，非法DevApp市场关闭新购渠道。凭证读取保留，避免新购开关阻断已创建订单的结算。

验证：provider51项、隔离Postgres27项、前端cashier51项通过；API/Web类型检查、完整API lint通过。SQL生成一致性与diff检查通过。红测先证实旧Stripe与前端会拒绝USD。测试证据在evidence/。

边界：PG测试使用真实数据库、真实签名加密微信测试通知及Stripe fixture，不代表在线商户实付。统一幂等checkout、Pro订阅、Free赠送、Team、Enterprise及全量旧数据清理尚未完成。独立只读审查已通过；配置缺失放行问题已按红测修复并复审51/51，未创建本项PR，未合入develop，不标passing。
