# 恢复与接线待办（实现规划，不是完成证据）

当前已有 `confirmClosed` 原子释放与 `PersonalPaymentReconciler` 权威查单组件；后者还未接定时调度。原始未绑定意图返回 unbound，不生成新商户身份；仍需原幂等身份恢复或持久人工复核，禁止超23小时重建Stripe支付。

后续调度要有界批次、游标公平、单进程不重叠、单项失败隔离、shutdown drain。pending购买与到期Stripe绑定均可重建待查提示；所有选择后的实际财务事务重验epoch。上游创建/普通查询不持DB事务；可变订阅快照在金融绑定锁内限时重读。不能伪造evt或signature_verified审计，复用新 `reconcileCheckout` / `reconcileSubscription`。

只同步 latest_invoice 不足以恢复多个月的漏通知。实现前核对固定Clover官方invoice list API；按subscription查已付账单，分页受限，完整校验原Checkout/订阅/客户/价格/金额币种/原锚点，每张invoice独立幂等到账。页中失败不能跳过账单，游标仅在该页处理成功后推进；扫到尾部重置游标使下轮能发现新账单。查询结果大小和每轮网络操作均有限，不能单次扫完无限历史。

资料：官方 [List all invoices](https://docs.stripe.com/api/invoices/list) 可按subscription/status过滤并使用starting_after/limit分页，按创建时间倒序。此次web工具无法直接打开固定Clover版本URL；搜索读取到官方通用参数说明，尚不能宣称固定版本列表协议已完成验证，写代码前再核对官方版本资料/结构。

订阅状态提示宜至少每5分钟重读，不能仅等到年度付款到期，避免漏取消通知后长时间展示旧状态。状态同步不等于付费额度，未付账单不能发额度。

管理/历史仍需适配新表：管理入口只使用当前用户真实Stripe客户绑定，外部portal调用在事务外，关闭新销售仍保留管理和到账；active epoch旧升级/旧订单创建入口须拒绝旧价格支付，不能创建新订单再被新回调忽略。优先核对并复用已签核的既有订单查询/订阅历史schema，按真实新购买快照和付款期限映射，避免增加未经设计的新HTTP契约；不得给未知事实猜值。

正式UI复用已获采用的视觉与交互，替换mock事实为已签核API。Pro付款期限、月额度期限、Free30天批次、永久充值及欠款分开显示；支付和授权状态由服务端读取，不以回跳或余额单次变化冒充指定订单已付款。

最终清理独立实施：冻结旧销售、关旧未付订单/Checkout、取消app-owned旧自动续费、排空旧应用/AI任务及durable消费重放；所有实际财务mutator持同事务shared epoch锁，清理exclusive。不要跨连接嵌套epoch锁。当前没有生产清理或激活动作。
