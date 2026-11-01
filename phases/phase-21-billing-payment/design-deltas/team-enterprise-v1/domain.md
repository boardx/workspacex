# Team / Enterprise 领域约束

## 源码事实与归属

- `apps/api/migrations/0003-identity.sql`：`organizations` 与组织内 `teams` 分开；真实成员关系为 `org_memberships(user_id,org_id)`，四种组织角色见 `packages/contracts/src/identity.ts`。
- `packages/contracts/src/platform-organizations.ts`：已有 `Plan=ordinary|enterprise`、乐观版本、操作者和审计；`apps/api/src/interface/controllers/platform-organization.controller.ts` 已复用 `PlatformOperatorGuard`。该 guard 接受既有平台管理员或超管；普通组织 admin 不是平台管理员。
- 额度精度复用 `billingCredits.CreditBalance/CreditLedgerAmount` 和现有整数账务工具；组织钱包、真实用量及权限仍由现有模块维护。钱包余额允许为负不等于订阅有效。
- 价格及基础／增员额度取已确认定价输入，运行时统一扩展版本化服务端目录；本束不复制一份客户端价目表。个人与组织的购买、Stripe customer、付款历史和恢复指针分开绑定。

## 期限、席位和周期

1. 保存不可变组织付款期限和原购买 UTC 锚点。月付一个额度窗口、年付十二窗口，每月独立从原锚点算边界，短月后恢复原日；不预发全年额度。连续 Stripe 续费保留锚点；到期后的微信新购买以本次实际付款为新锚点。
2. `purchasedSeats` 来自已核实付款的基础容量和有效增员，不来自当前成员数；`usedSeats` 来自当前组织成员。删除成员只释放使用量，不能减价、退费或改支付商续费数量。首次购买不足以覆盖已有成员时拒绝付款创建，并给出所需容量；不得静默多扣钱或踢人。
3. 增员仅接受正增量；报价绑定 org、generation、已付期限、商业版本、SKU、渠道、币种、增量、折算时刻和过期时间。相同 org 同时只有一项未解决的付费变更；相同 key 不改参数、不换购买身份。请求模糊失败保留原操作，恢复不重新下单。
4. 微信金额以剩余付费期限／完整付费期限算有界整数比例并向上取分；Stripe 使用服务端权威 preview，冻结相同 `proration_date`。预览不是付款证据；遇到不支持的折扣、税项、余额抵扣或不匹配账单，拒绝创建或进入明确人工核对，不能偷偷改变报价。
5. 增员额度从权威 `paidAt` 起算当月剩余比例，向下到 0.01 credit；先前已发生的时间不补发。独立追加来源批次和流水，不改已有批次的历史授予值。后续完整月按有效已购增员发放；所有新增容量与该已付期限共同到期。窗口过期才收到回调时不得复活过期额度。
6. Stripe 增员采用付款成功才应用的 pending update；仅对支持的自动扣款方式开放，保持原周期及 billing anchor，核实成功账单和更新后的全部数量后入账。续费 invoice 必须覆盖所有已购数量。失败、需验证或 pending update 过期时不先加席位／额度，也不默认改成另一次 Checkout。
7. 邀请核销、共享链接、现有账号加入、项目邀请带来的组织成员创建及平台添加成员，全部在实际成员 INSERT 事务内获取同一组织容量锁再计数。并发最后一席只有一个成功；失败不消耗 token／名额／赠送或 outbox。纯角色修改不改变占位，既有双人复核和最后管理员规则保持。

Stripe 技术依据：[固定 Clover 的更新接口](https://docs.stripe.com/api/subscriptions/update?api-version=2025-09-30.clover)、[固定折算时刻的账单预览](https://docs.stripe.com/api/invoices/create_preview?api-version=2025-09-30.clover)、[pending updates 的付款及方式限制](https://docs.stripe.com/billing/subscriptions/pending-updates)。这是拟议集成方案，仍需实现时协议反例和真实签名 fixture 验证，不代表已接通。

## AI 准入与账务边界

- 在实际组织 AI 准入事务中核对当前 generation 的 Team 付费期限或 Enterprise 标记，再按既有权限和用量准入。Team 到期有余额、永久充值或负债透支政策也不能放行新的团队 AI。
- 已准入请求持久化原准入事实，跨到期／计划变更仍完成并结算；登录、资料读取和必要管理不挂 Team 期限守卫。禁止在所有组织 API 外统一加付费墙。
- 付费确认、席位授予、月度额度、消费、迟到用量 replay 和定时发放在各自实际事务持有 epoch 共享锁；最终 reset 持排他锁。沿用支付链约束，统一为 epoch → paymentRef（有时）→ subscription（有时）→ organization → 购买／操作／计划／期限行 → 钱包；某路径不需要前面的锁就跳过，不得在拿到后面的锁后反取前面的锁。邀请仅需 epoch／组织容量锁。不能外层连接持锁后内层另取同一锁；实际实现须将所有参与路径放入死锁／并发测试核对。
- verified receipt、不可变报价、原 org/订阅/customer/price 绑定、到账和流水必须一致；并发回调／补账／用户刷新只授予一次。失败不得丢弃已付款事实，也不能错误归到个人钱包或另一组织。

## Enterprise 的单源和升级

- 扩展既有平台组织套餐记录携带当前计费 generation，不增加独立 `isEnterprise`。Enterprise 生效由该记录及当前 epoch 推导；旧 generation 的 enterprise 元数据不恢复旧权益。计划版本只在原子商业变更中推进。
- 组织 Team 付款可将该组织标为当前代际 ordinary，但不得覆盖已经生效的 Enterprise。普通计划仍须真实已付期限才有 Team AI 权益。既有 `PlanState.enforcement=pending` 将在契约签核后扩展为能表达实际门控状态，不继续对已启用账务谎报 pending。
- 升级先持久化幂等操作，再在事务外核实本应用拥有的 Stripe 绑定、收敛待支付变更并停止未来 Team 续费；上游失败保留可恢复操作。最终在组织锁内核对原版本并原子写计划／generation／操作者／原因／时间／升级收据。外部取消成功而本地失败时重试同一操作，现有已付权益仍保留。
- 旧 setPlan 路径在新 epoch 下不能绕过上述步骤直接授予 Enterprise 或降回普通计划；复用同一写入器或明确拒绝并引导新操作。未激活时代保留既有 metadata 管理行为。本次不开放降级或自动退款。
- Enterprise 不自动发额度／账单，不继承旧 Team 的到期阻断；已有批次继续按原规则到期，后续 Team 月度 worker 不继续授予未来批次。升级与在途付款冲突必须先权威核对；无法收敛则保留处理中／人工核对，不能覆盖为普通计划或丢失付款记录。
- 手动添加额度允许平台运营给指定真实组织加正数永久 credit；同组织／generation／幂等键只记一次，绑定原操作者、数量和原因，参数变更冲突。额度、账本、审计和收据同一事务；溢出或审计失败全部回滚。加额度本身不激活／延长 Team，也不改变 Enterprise 标志。

## 实施范围

只准备设计。个人支付缺失原支付页绑定的终态恢复仍由其独立待签增量管理；本束不改变它。旧计费全量重置及生产切换由后续独立工作完成，本束不执行或另定义一份清表清单。
