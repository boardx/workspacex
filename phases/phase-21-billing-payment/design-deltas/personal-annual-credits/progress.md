# 按购买日逐月发放 — 进展

Issue6091，worker/cn-us-annual-credits，最终集成基线为实际develop d886e24310ae50e8f7c6a74bbceb87c052514025（充值PR6098已于2026-11-01T21:24:25Z正常合入、6090关闭）。从原base48剥离四提交，重基到85fee5c6f；range-diff四项完全相等，旧b766与重基85fee完整源码树git diff退出0。证据final-base-*；本次只更新交接文档，未借重基改运行时。

已实现原始购买UTC锚点和月份偏移，月付一个窗口/年付十二窗口；短月后恢复原日。可信付款期限持久化，金额/币种/SKU/所有者/付款身份不可改配，重叠和未来付款期限拒绝。钱包读取及个人AI准入先补齐到期月份；已处理年付窗口不会反复进入十二次授予，永久充值与负债保留。

后台有界调度已注册BillingModule，next_check_at是可重建提示；逐账户事务隔离、跨实例幂等、失败游标轮转、关闭等待在途任务。PG覆盖101账户分页、双实例、错误隔离、强制提前提示不发额度和迟到月份回收。两份新增SQL已准确登记恢复fixture reviewedSuffix，未知/缺失/重复拒绝不变。

同一源码树本轮既有实测证据：provider60/60、隔离PG45/45、API type/lint7/7（5缓存）、恢复scope2/2；refreshed-*及migration-scope-*。重基源码完全相同，无意义重复测试未当作新证据。最终独立exactSHA复核、正常推送门禁与单issue PR/CI仍待，尚未标passing。

本项是个人已验证付款的授予基础，尚无公开支付商新checkout入口；后续个人支付6093接线。原先基础init快速路径已通过，当前不将其冒称为后续P5新源码的最终baseline。没有生产迁移、reset或epoch激活。
