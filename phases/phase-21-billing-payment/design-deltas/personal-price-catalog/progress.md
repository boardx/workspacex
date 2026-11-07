# 真实商品目录进展

集成验收：PR #6095 已于2026-11-01T18:58:35Z正常合入develop，mergeCommit6a1a3c62efa31d78cfd5337eccecb672ddb6dd0a，issue #6089于18:58:36Z由该PR关闭；source319d89d通过独立ACCEPT、provider41及20推送门禁，并经仓库READY及正常合并队列完成。此为代码集成，不表示生产支付启用或数据清理已执行。

Issue #6089。实现真实 GET /billing/catalog，金额只存在服务端 domain 目录，市场从不可变部署配置获取；CN CNY、US USD、DevApp CN。部署渠道关闭时仍可查看价格，未知市场503，非法查询400，PrincipalGuard未绕过。

验证：先运行因目标service未实现退出1；新增目录6项通过（含真实HTTP，使用隔离PrincipalResolver fixture与实际PrincipalGuard）；provider专项41项通过；API typecheck与完整API lint通过。独立只读审查再次运行6/6，无需修问题。证据在 evidence/。

边界：没有接收款、写余额、发订阅额度或清数据；此为个人支付阶段的目录基础交付。新旧入口的完整产品浏览器验收在支付接线阶段完成，不以此HTTP fixture冒充生产身份链路。

依赖已满足：UI PR #6087 和契约 PR #6094 均已正常合入 develop。本分支已剥离旧父499c22a20，对齐实际 develop a2d305d11cac86df01737461b5b241bbac3c430e，仅保留 #6089 目录差异；对齐后的 provider 41/41通过（evidence/provider-rebased.txt）。随后按精确SHA独立复核、仓库checks和用户已授权的正常合入流程处理。复用同一worktree，未新建。
