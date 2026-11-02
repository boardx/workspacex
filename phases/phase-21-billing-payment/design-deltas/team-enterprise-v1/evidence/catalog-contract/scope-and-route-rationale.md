继续补第③件目录材料。现个人 GET /billing/catalog 的 PricingCatalog 是 strict 且subscription固定个人20,000额度，直接混Team商品会破坏已确认的个人响应。草案将组织目录改为 GET /billing/organizations/:orgId/catalog，由真实目标组织管理员读取；底层目录版本、市场和永久充值SKU/价格仍共用服务端事实。公共目录结构及市场/币种/唯一性约束提取复用，不复制价格或另造个人契约；本阶段只准备schema和mock消费，无路由/SQL/支付接线，最终完整材料仍待人工签核。

同时原型在直接以US打开增员/在打开状态切换CN->US时，先前可用旧WeChat状态构造USD报价导致strict解析抛错。新增组件反例真实2红2绿，现按当前市场同步选择受支持渠道，UI16绿；真实browser增加US增员回归，待与目录消费一并执行。
