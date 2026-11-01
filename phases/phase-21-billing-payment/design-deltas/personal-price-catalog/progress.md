# 真实商品目录进展

Issue #6089。实现真实 GET /billing/catalog，金额只存在服务端 domain 目录，市场从不可变部署配置获取；CN CNY、US USD、DevApp CN。部署渠道关闭时仍可查看价格，未知市场503，非法查询400，PrincipalGuard未绕过。

验证：先运行因目标service未实现退出1；新增目录6项通过（含真实HTTP，使用隔离PrincipalResolver fixture与实际PrincipalGuard）；provider专项41项通过；API typecheck与完整API lint通过。独立只读审查再次运行6/6，无需修问题。证据在 evidence/。

边界：没有接收款、写余额、发订阅额度或清数据；此为个人支付阶段的目录基础交付。新旧入口的完整产品浏览器验收在支付接线阶段完成，不以此HTTP fixture冒充生产身份链路。

依赖：UI PR6087和个人支付契约issue6088需先正常集成develop，再对齐本分支以保持本项PR只包含#6089差异。复用同一worktree，不能另建。
