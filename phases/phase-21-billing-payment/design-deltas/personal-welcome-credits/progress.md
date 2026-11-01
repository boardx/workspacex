# 新用户赠送进展

暂存栈5dc026ce5获独立只读ACCEPT。首轮prepush实际24/25，Web typecheck退出137，不能称绿；宿主swap约13GB，仅处理本会话编译器，根因未确定。随后相同API/Web类型检查串行7/7（6缓存）通过，正常再次推送完整25/25（24缓存）通过，5dc已在自有远端。没有跳过hook。证据push-first-24-of-25、serial-types-7、push-final-25。P2充值旧候选聊天分片重跑65通过/1跳过，已按授权正常重新排队，尚未合入；本项仍等待P3实际集成后最终重基。

2026-11-02刷新依赖：P4原本b4ddf725的一提交已从旧base63d23剥离到P3暂存栈b766a58cc，重放后0cf4c071；当前P4剥离父应为b766，P5仍从其原父b4dd剥离，勿混用。P2充值尚未实际合入，P3/P4均未提前PR集成。精确追加本项welcome SQL至恢复fixture reviewedSuffix：先1失败/1通过，补清单后2/2通过，未知/缺失/重复拒绝不变。当前实际复验provider61/61、隔离PG/真实注册HTTP六文件58/58，peak7，清理3s完成；真实注册邮件worker禁用，仅验证durable outbox。证据refreshed-*及migration-scope-*。默认epoch仍关闭；没有存量赠送或生产激活。保存检查点后独立复审，最终仍须前置实际合入、重基到实际develop并复核SHA。

Issue6092，基线a1d5cbf93，分支worker/cn-us-welcome-credits。依据personal-pricing-v1已确认设计；ADR126 Proposed记录封闭类型及来源。

已实现credentials AFTER INSERT事务触发器，SECURITY INVOKER；所有真实新建账号入口共用一次赠送，不改邮件/邀请/项目角色逻辑。默认未激活的会计代际标记仅供app读取，正式激活留待旧计费重置发布窗口；会计代际独立于未来商品目录版本。

欢迎赠送保留独立批次及授予/到期来源，复用旧钱包、到期优先分配和不可改流水。永久余额扣除两类未消费周期额度，付费配额排除欢迎赠送。welcome-only钱包可被原定时器回收，读取及AI准入仍按既有规则归一化。内部welcomeCreditGrant读取组件返回真实到账/到期和余额；符合资格却缺少记录时报错，不补赠或假装0。

已验证：contracts1248项、provider61项、真实注册HTTP2项、五文件PG56项及历史UI5项通过；API/Web类型与API lint通过，生成DDL一致性通过。真实HTTP使用Nest/PG/实际bcrypt，邮件worker禁用，只证明durable outbox；未验证线上邮件投递。PG覆盖默认不激活、存量不补、1000/30天、权限、同事务回滚、并发唯一、债务、永久余额、两类批次及迁移重放。旧auth未激活回归六文件56项通过。

独立只读审查未发现需改具体缺陷，独立provider61/61；尚未绑定本项提交SHA。完整个人权益HTTP路由和新UI数据接线留待支付集成，不伪造未实现Stripe订阅事实。没有生产清理或激活，未标passing。
