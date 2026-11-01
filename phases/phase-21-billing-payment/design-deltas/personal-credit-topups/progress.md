# 中美永久充值进展

Issue #6090，分支 worker/cn-us-credit-topups。已剥离旧父41cf12014，对齐已合入目录的 develop 6a1a3c62efa31d78cfd5337eccecb672ddb6dd0a；业务差异仅本项充值。沿用已确认UI及个人支付设计。

真实订单链路支持CN CNY与US USD三档永久充值；服务端过滤部署市场，外区SKU无法下单，微信限CNY，Stripe请求和回调均核对订单币种快照。前端收银台接受受支持的USD订单，继续校验支付地址。新套餐SQL从domain目录生成，重复应用不改变已有订单，遇到冲突快照报错。旧参考套餐停用；完整旧计费数据重置属于后续独立交付。

DevApp默认CN市场可测试两渠道，可由可信服务端BILLING_CATALOG_MARKET=us切换USD测试（仅Stripe test）；生产CN/US忽略该覆盖，非法DevApp市场关闭新购渠道。凭证读取保留，避免新购开关阻断已创建订单的结算。

验证：provider51项、隔离Postgres27项、前端cashier51项通过；API/Web类型检查、完整API lint通过。SQL生成一致性与diff检查通过。红测先证实旧Stripe与前端会拒绝USD。测试证据在evidence/。

边界：PG测试使用真实数据库、真实签名加密微信测试通知及Stripe fixture，不代表在线商户实付。完整新checkout、权益与新UI接线由后续支付阶段承接；Team、Enterprise及全量旧数据清理另阶段执行。既有独立审查通过，市场配置缺失放行已红→绿修复；对齐后provider51、隔离PG27、cashier51及SQL生成一致性均复验通过，证据rebased-*。当前准备精确SHA复审和单issue PR，未合入、不标passing。

PR #6098 的 billing-cashier-glue 首次失败定位为浏览器用例仍选择已停用的旧一元 SKU pkg-cn-100。修订为从权威目录选择 CN 10,000 credit 产品，断言旧 SKU 不可选、订单金额/币种/额度精确匹配，并保留真实取消请求、支付商关单、PG CLOSED 及零入账断言。隔离真实浏览器两文件共11项通过（117.96秒），峰值连接7、清理成功；见 evidence/browser-current-package.txt 与 customer-cancel-current-package.png。该截图含测试专用历史 fixture；不作为最终定价 UI 签核材料。修正待精确SHA审查和CI，未合入。
