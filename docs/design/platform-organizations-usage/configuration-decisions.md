# 最小生产启用决策表

这张表只列启用时需要决定的值；源码配置、权限、计量和并发实现不等待填写。当前没有配置值，未执行生产写入。企业免本产品 Token 配额，不等于授权无限供应商费用。

| 决策 | 单位与作用域 | 无配置安全行为 | 当前实现/候选来源 |
|---|---|---|---|
| 组织套餐 | ordinary / enterprise；正式组织 | 显式未配置；不猜套餐、不改 kind | 已有审计/版本控制 API 与后台；两种套餐 |
| 普通用户 Token 额度 | 整数 Token；组织 × 用户 × 窗口；输入+输出总量，缓存/推理子集不另加 | 未激活前显示 pending；进入强制 admission 后拒绝新付费调用 TOKEN_LIMIT_UNCONFIGURED | 可空 token_limit；企业仅跳过这一项 |
| 额度周期/边界 | 明确 start inclusive / end exclusive UTC 时间戳及 IANA timezone；每用户窗口 | 不推断月度、不自动生成窗口；无有效窗口拒绝 | 当前支持显式窗口；日/周/月循环生成需明确选择后配置，不以 30 天冒充自然月 |
| 授权费用上限 | 整数微货币单位；明确 currency；组织 × 用户 × 窗口 | 强制 admission 无有限上限则拒绝；企业同样需要有限授权 | cost_limit_micros；不把未知价当 0 |
| 模型价格版本 | immutable version + currency；provider × model；input/output/cache 各微货币/百万 Token | 未知价拒绝成本报价；实际记录 cost=null，不推算实际费用 | 显式整数价格；现有 model pool 的展示 unitPrice 不自动变成结算权威 |
| 单次安全输入/输出上限 | 输入/输出 Token 整数；已授权具体模型与用途 | 不支持可靠输入界或 provider 输出 cap 的路径不开放强制付费 admission | 配置需要模型已知 context/output 能力；字符串长度不能假装精确 Token |
| 允许的 fallback | 组织、用途、机密/工具/视觉能力范围内的有序具体模型 ID | 空名单即拒绝降级；未知能力、未启用、非路由注册、未知价拒绝 | 仅来自该组织正式 model pool 的非秘密 ID/名称、已启用状态、已知 capability/context 及现有 router；不添加 provider |
| 每调用 fallback 次数 | 有界整数；原请求最多候选数与费用授权内 | 0；禁止失败后自动无限重试 | 每次真实重试是独立请求/预留；未知旧费用保持 hold |
| 持久终态存储 | 明确部署提供的持久介质/保留期；组织隔离的 receipt metadata | 缺少可靠存储时不声称 durable coverage；强制全链路启用受阻 | DB start/terminal 已有；补偿/原生单位链路仍在实现 |

## 当前可支持候选的事实边界

仓库没有全局硬编码正式模型名单；`PgModelPoolRepository.listForOrg` 和 `selectableModels` 是组织候选的权威。当前开发环境不启动数据库、不读取生产 credentials，也未从正式池取到当前可用具体名称，因此**这里没有可确认的 fallback 型号**。默认 `qwen-plus` 等代码占位或 mock/fixture 型号不能作为生产候选。启用界面应只投影正式池的 modelId/displayName、status、capabilityTags、contextWindow，经过现有可选/机密路由检查与具体 provider 能力检查；不投影 endpoint、credential 或 secret。

已知路由类型是现有 `RoutingModelCallPort` 注册的 configured chat、deep-agent、deep-research；类型存在不代表该部署具备相应能力、价格或费用授权。候选为空时给出可操作的未配置状态，不能自动注册/选择替代供应商。
