# 9b25 发布：原生恢复与逻辑备份，一页决策与成本

**推荐先走现有 RDS 原生快照/PITR → 临时隔离 Serverless 恢复演练，暂停扩张自制逻辑备份工具。** 这是基于本实例实际回执的建议，不是“产品支持所以已经可恢复”。应用仍 9b25、生产基线 ba634；未创建账号/key/实例、未改备份策略、未恢复或迁移生产。

实际只读调查日期：2026-10-03 UTC。全部 API RequestId 和原始非秘密字段见 [证据](cn-native-backup-cost-evidence.json)。

| 已核事实 | 结果 |
| --- | --- |
| 实例 | 上海 pgm-uf6rg214cp381l49，PostgreSQL16，serverless_standard / pg.n2.serverless.2c，general_essd 100GB，主/备两节点，ScaleMin0.5/ScaleMax4，Running |
| 原生数据备份 | 每天自动快照，7份 Success/IsAvail1/MetaStatusOK，BackupScale=DBInstance；最近 BackupId3184466733，19:41:16开始、19:44:53结束（3分37秒，仅备份历史实测，不是恢复耗时） |
| 日志与PITR | BackupLog=Enable，数据/日志各保留7天；actual DescribeLocalAvailableRecoveryTime=2026-09-27T19:45:46Z～2026-10-03T21:05:27Z |
| 备份用量 | BackupSize41,392,465,408bytes≈38.55GiB，其中快照≈8.75GiB、日志≈29.80GiB；PaidBackupSize=0。不要把7个100GiB标称快照容量简单相加成付费用量 |
| 当前库 | DescribeDatabases实际列出workspacex、workspacex_agent、workspacex_memory；BackupScale全实例支持覆盖它们的判断，但BackupDBNames空/DescribeBackupDatabase返回[]，不是逐库恢复验证 |
| 已有隔离资源 | 同一当前授权账号/上海DescribeDBInstances只有生产实例，总数1；未发现可复用隔离RDS。其他账号/地域/本地容器未证实，不能宣称全部不存在 |

[官方恢复说明](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/restore-data-of-an-apsaradb-rds-for-postgresql-instance)明确Serverless源只能恢复到新的Serverless实例，并需费用。可按上述snapshot ID或覆盖内时间点申请clone；不直接覆盖现有生产。现ACL/角色数据会随历史恢复，云盘白名单/安全组不会自动复制，需精确隔离配置许可。未验证Clone权限、售卖可用性、实际目标或实际restore完成。

| 路径 | 省下/仍需的步骤 | 当前硬缺口 |
| --- | --- | --- |
| A 原生快照/PITR（推荐） | 可跳过临时备份角色、PUBLIC差异、password-null额外helper、CMS证书/密钥托管和逻辑导出安装链；数据库实例级同一恢复时间点优于三个独立逻辑快照 | 用户批准一个精确短期付费clone；最终售卖报价/可用规格、现身份Clone权限、隔离网络及临时应用接线；真实三库/AGE/vector/对象和六流程恢复验收；正式迁移前固定可恢复检查点和恢复回生产路径 |
| B 固定helper串行逻辑备份 | 复用已缓存PG16镜像、已有私网和已获批backup role；适合移植到既有自建隔离PG（若其身份/容量/AGE/vector兼容性证明齐全），原生快照不能直接当pg_restore归档使用 | 同key新证书/真实custody和PUBLIC审批；可用窄password-null主体不存在；installer绑定backup profile未接线；actual export/隔离restore/共同epoch/候选writer尚未闭环 |

B 的backup host/stream/watchdog核心有实现和先前独审/pure runner证据，但最新独审仍有未关闭安全反例：watchdog cleanup先capture三库，capture异常可跳过NOLOGIN/owned-container清理；现5871dcf和本地没有修复。详见[#5247独审](https://github.com/boardx/workspacex/pull/5247#issuecomment-5973208084)。因此撤回整体backup源码已完整独审的结论；生产链没有执行，21:02角色元数据没有该临时角色，实际没有本次role lease，不是生产事故。额外密码探针草稿仅35个fixture通过、未接入Node/host，已停止并保存到/tmp，未混入稳定分支。installer本轮仅设计无代码。不能把“测试快”推成“再几分钟就发布”；没有可信主动工时数据，B尚至少跨越权限证明、安装接线、托管与真实演练四个独立闭环。A仍有演练/迁移安全工作，不承诺30分钟可发布，也不再为这个首版造备份平台。

## 一次演练的成本

[官方上海Serverless公开价](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/pricing-of-serverless-apsaradb-rds-for-sql-server-instances)：每节点0.333元/RCU小时，存储0.0017元/GB小时，按小时出账。以保守沿用源100GB、同高可用两节点、0.5～4RCU/节点、使用2～4小时为**规划假设**：

`每小时 = 2 × (0.333 × 实际RCU + 0.0017 × 100) = 0.673～3.004元`

`一次RDS计算+存储 = 1.346～12.016元，约1.35～12.02元。`

不是账户最终总价，也未批准花费。RCU/耗时未实测、税是否已含未知，页面促销不重复再打5折。最小兼容目标暂按同源规格估算，**未证实可换基础单节点或更小盘**；早期DescribeAvailableClasses返回InvalidCondition.NotFound；新成功可售回执详见下文，仍不能从20GB售卖下限推断snapshot可缩盘。早期账户DescribePrice两次返回InvalidSaleComponentFault（非RAM授权拒绝）；官方参数核对后已成功：专用商品码rds_serverless_public_cn与MinCapacity/MaxCapacity，RequestId01A1039F-1F6D-5C56-ACCC-E00599E26966，actual0.337～1.502元/小时，2～4h计算存储0.674～6.008元。不要再乘节点或再打折。此次可售规格也实际成功列出pg.n2.serverless.2c/20GB起，但快照缩盘恢复兼容性未验证，保守仍100GB。原公开价scenario保留为历史保守对照，已不是账户报价不可得。见[最新精确clone计划](cn-native-clone-execution-decision.md)和[账户回执](cn-native-clone-account-quote.json)。

[官方备份费用](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/billable-items-and-pricing-for-the-backup-storage-of-an-apsaradb-rds-for-postgresql-instance)：未压缩云盘免费额度存储的200%，现100GB对应200GB规则值，且API PaidBackupSize=0支持当前无超额。上海快照超额价0.00025元/GB小时；公式`max(0,新实际备份量−新免费额度)×0.00025×小时`。不改源保留策略/备份频率，不从当前零超额承诺演练未来所有费用为零。

完整增量总成本还要加：源端额外负载、目标超过100GB的自动扩容、目标备份超额、应用/Redis/其他新资源，以及外网下载/跨地域流量等。推荐同VPC私网、不下载或跨地域搬备份、不新增ECS，目标app只复用已验证可隔离的现有执行资源；这些额外项目未获账户报价，故**不能给有保证的一次全链总价**。无新增资源路径可以保留现自动备份和完成只读源核查，但不能完成原生clone演练；逻辑备份复用已有隔离PG也仍要完成B的硬缺口，不算免费且现成。

2～4小时是演练预算假设，不是恢复SLA。建议后续精确批准包限定仅1个隔离clone、首轮4小时到期需复核、不自动续时/扩容/加资源；计费最小整小时是否向上取整、账户折扣/税费仍未确认。达到时限先停止测试，保留审计与target身份，不能擅自删除唯一恢复数据。[官方释放规则](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/release-or-unsubscribe-from-an-apsaradb-rds-for-postgresql-instance)允许Serverless释放并停止相关计费，但会删除实例数据；若将来用户明确批准销毁，只删exact本次clone，原生产/备份不动。仅暂停仍收存储费，不能冒充已释放。

**覆盖边界：**实例级备份预期包含三库的持久对象及AGE/vector数据；扩展版本/库对象/图与向量查询须真实restore验证，不能用备份API替代。它不保护Redis、OSS上传对象、外部依赖、ECS/app镜像/稳定secret/配置，也不保证跨系统同一epoch。收缩迁移的生产回退需另列恢复时长、endpoint/凭据/流量/兼容性和新写入损失边界；nativeclone演练不等于批准生产恢复或切流。

实际扩展与副作用核查补充：21:17:27Z三库foreignServers0、enabledSubscriptions0、无cron.job；主库vector0.8.0.2，agent/memory只有plpgsql，三库没有AGE。当前源元数据不是历史snapshot同epoch证明，须真实目标复核；不宣称已有AGE数据恢复。用户已选native路线，尚无付费预算/target-only网络例外审批；15元/4h精确clone草案不执行采购。
