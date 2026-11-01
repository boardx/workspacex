# 个人支付闭环在建交接

唯一 worktree /Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui；共享 checkout 不切分支、不新建第二个worktree。当前 worker/cn-us-personal-payments，已推送检查点 c517aabf6（父1d2411a2fa769756efd28175c59fb6aee8441dea）。本项 #6093 尚未完成，不创建未完成PR，不标passing。

前置契约PR #6094 当前head b296e1385e03c8f215f573756727261f9c967126，等待新CI。此前 fa09 已source READY并正常入队，候选40f63ce5因Turbo自测默认1MiB stdout溢出退队；b296仅补有界8MiB和assert.ifError，21项自测红→绿、独立exact SHA ACCEPT、推送前20/20通过。父协调会话明确要求最小修复后正常重入队。旧候选剩余backend run41329227728已提交取消（确认新head且queue空），不要取消其他会话的run。用户已授权本次定价任务逐PR检查/独立审查通过后正常集成develop，无admin bypass，无生产权限。

c517证据：provider15文件129项、API type/lint、PG意图7项、真实回环HTTP2项通过；HTTP PrincipalResolver与支付商为fixture，不能说生产登录或在线扣款已验证。新控制器仍未注册BillingModule。

当前增量：billing_personal_payment_receipts迁移、人工复核标记、原子到账Repository、微信新代际查单与回调Store。已补渠道引用前缀防混用；支付事务10项、签名回调HTTP/PG5项最终15/15通过，意图7项和HTTP2项另已通过；provider131/API类型/lint通过。正式BillingModule仍未接线，Stripe Pro绑定/自动续费仍待实现。
财务事务：epoch共享锁 → provider paymentRef锁 → subscription锁（Pro）→ user锁 → purchase行 → 钱包。recordPaidPersonalTerm会取subscription再user锁，调用前必须相同顺序，避免反向锁。核心settle目前支持微信Pro和中美充值，明确拒绝Stripe Pro（personal_stripe_binding_required），后者仍需完整绑定与invoice流程。到账资金、付款快照、账本、fulfillment同一事务；额度容量与已付期限重叠用savepoint回滚授予后保留receipt人工复核，重试不能在余额变化后自动恢复发放。paidAt可null用于无法确定实际付款时刻的Stripe充值，不猜时间；微信Pro必须有权威paidAt并以此锚定月/年期限。

后续顺序：先修guard并验证当前支付事务；再实现微信真实验签/AES解密→带代际标记权威查单→到账的回环HTTP/PG证据；随后Stripe持久化绑定、paid invoice与续费、正式DI接线及过期/超时恢复。Stripe绑定必须核实原始Checkout、客户、订阅、价格、SKU、金额、币种、generation；invoice先到也不能凭事件metadata选用户。续费保留原始billing anchor与月偏移；subscription active事件本身不发额度。保存真实确认的status/cancel_at_period_end，不给权益读模型猜自动续费事实。新entitlement HTTP必须组合实际付款期限、月度credit、welcome批次。

旧事件屏障：激活后未知/旧generation通知不得回落旧入账路径。最终cutover还需给旧财务事务加epoch屏障，先停止销售、关闭旧可支付订单/Checkout、取消app-owned旧Stripe续扣、排空旧应用，再全清旧订单/订阅/余额/流水并激活；本项尚未执行生产操作。Wechat time_expire不足下单后1分钟会被上游延长，创建前留余量；本地过期和关单失败不证明上游已关闭，付款与关单竞态必须重读。

所有新PR仅develop。契约合入后依序剥离前置：目录旧父499c22a20、充值旧父41cf12014、年付旧父d5c6539c6、Free旧父a1d5cbf93；最后本项剥离旧父1d241。每个PR只含对应issue。原契约subject里的括号issue号已在新契约分支改为Refs，避免merge queue误当PR号。每次开发先fetch main/develop，强推只用自有分支精确force-with-lease。

保留备份stash 61a9667d79b2d7fed0ec3ced0e8ba17064b9cd59 已应用且后续c517保存；旧ba557b9372293e2755363dba3bc29cb2596a9917也已全部提交。共享stash有别人的条目，不碰。当前没有自有浏览器/Next server；隔离数据库测试wrapper负责栈清理，结束后确认结果与cleanup。不要动发布会话的Chrome/服务器。

契约6094 b296再次正常入队，当前候选a2d305d11cac86df01737461b5b241bbac3c430e，队列位置2。候选可能含队列前序PR，不取消其工作流；用check-runs per_page=100完整核对，并以实际mergedAt/mergeCommit判断合入。
