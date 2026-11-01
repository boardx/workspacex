# 新用户赠送进展

Issue6092，基线a1d5cbf93，分支worker/cn-us-welcome-credits。依据personal-pricing-v1已确认设计；ADR126 Proposed记录封闭类型及来源。

已实现credentials AFTER INSERT事务触发器，SECURITY INVOKER；所有真实新建账号入口共用一次赠送，不改邮件/邀请/项目角色逻辑。默认未激活的会计代际标记仅供app读取，正式激活留待旧计费重置发布窗口；会计代际独立于未来商品目录版本。

欢迎赠送保留独立批次及授予/到期来源，复用旧钱包、到期优先分配和不可改流水。永久余额扣除两类未消费周期额度，付费配额排除欢迎赠送。welcome-only钱包可被原定时器回收，读取及AI准入仍按既有规则归一化。内部welcomeCreditGrant读取组件返回真实到账/到期和余额；符合资格却缺少记录时报错，不补赠或假装0。

已验证：contracts1248项、provider61项、真实注册HTTP2项、五文件PG56项及历史UI5项通过；API/Web类型与API lint通过，生成DDL一致性通过。真实HTTP使用Nest/PG/实际bcrypt，邮件worker禁用，只证明durable outbox；未验证线上邮件投递。PG覆盖默认不激活、存量不补、1000/30天、权限、同事务回滚、并发唯一、债务、永久余额、两类批次及迁移重放。旧auth未激活回归六文件56项通过。

独立只读审查未发现需改具体缺陷，独立provider61/61；尚未绑定本项提交SHA。完整个人权益HTTP路由和新UI数据接线留待支付集成，不伪造未实现Stripe订阅事实。没有生产清理或激活，未标passing。
