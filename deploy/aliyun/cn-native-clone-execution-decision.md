# 固定 9b25：一次原生 clone 的精确审批草案

状态：用户已选原生路线，**不再请求方向审批**；尚未批准付费资源预算或下面的 target-only 安全改动。没有创建资源/订单，没有执行恢复/改网络。推荐批准对象收窄为**1个原生clone + 只读恢复核验**，先证明恢复能力；尚未冻结的候选应用/六流程/迁移不捆绑。完整字段见 [proposal JSON](cn-native-clone-review-proposal.json)，实际账户报价与能力回执见 [quote JSON](cn-native-clone-account-quote.json)。

## 可直接交用户的一句决定

建议批准：**在上海现VPC创建仅1个固定快照3184466733的Serverless隔离恢复副本，100GB、高可用、0.5～4RCU，首轮4小时、总预算上限15元；只调整这个新副本的私网白名单并做固定只读核验，不开放公网、不接业务writer、不追加付费资源、不动生产。** 完成/失败/到期均先报告，删除恢复副本需用户当时确认。若保留副本会继续收费，15元是执行预算限制，**不是云账单硬封顶**；到期仍未决定不能静默续测试或宣称零费用。需用户确认预算及这项新副本安全变更后才能采购。

## 固定对象与可售规格

- Source `pgm-uf6rg214cp381l49`，snapshot **3184466733**，Automated/FullBackup/Snapshot/Success/IsAvail1/MetaStatusOK，2026-10-03 19:41:16～19:44:53 UTC。不创建新backup、不修改源7天策略、不跟随新快照。提交前只读复验该ID仍可用；失效即停，不换ID冒用原批准。PITR备用能力已实际返回截至21:21:09Z，但**本次不同时请求PITR，不使用moving-now**。
- 实际`DescribeAvailableClasses` RequestId `01A1039F-14A0-55D7-840D-E20FC7C708B3`只列一个规格 **pg.n2.serverless.2c**，存储20～64000GB/步长5。20GB是售卖下限，不能据此证明100GB快照可缩盘恢复，因此本次保持100GB。源serverless_standard高可用两节点，Category省略按API继承，不改成未证实可恢复的基础单节点。
- CloneAPI使用`PayType=Serverless`，`ServerlessConfig={MinCapacity:0.5,MaxCapacity:4}`；不要将实例属性ScaleMin/ScaleMax错误用作请求字段。目标关闭BPE/IO burst，不开启DAS/代理/新增付费服务；若API拒绝该关闭配置，停下来，不去掉边界继续下单。名称`workspacex-cn-native-9b25-rehearsal-3184466733`，唯一ClientToken=`wsx-native-9b25-s3184466733-first`，同token仅恢复查询，不重复生成token创建第二个。
- 上海 VPC **vpc-uf6e7vt902oid0p1mwd6q**；主cn-shanghai-e/vswitch **vsw-uf6rqwne9b3cp48diptx1**，备cn-shanghai-g/vswitch **vsw-uf6epcojpvdltooni86u8**。21:21实际二者Available、剩余IP246/251；不建新VPC/vswitch/SG/NAT。target ID/endpoint/privateIP必须由这一个create响应及fresh Describe实际回填，当前未分配，不能伪造。

## 费用与4小时窗口

官方参数核对后账户DescribePrice成功，RequestId **01A1039F-1F6D-5C56-ACCC-E00599E26966**，CNY，专用商品码`rds_serverless_public_cn`，0.5～4RCU/100GB返回**TradeMinRCUAmount0.337、TradeMaxRCUAmount1.502元/小时**；促销rule20797498已反映。不要再次乘节点数或再打五折。4小时计算+存储上界**6.008元**，2小时低端0.674元；原公开价1.35～12.02是此前保守scenario，已由本账户成功报价补充，非最终账单或税费证明。

建议总首轮预算**15元**，不以余量扩大范围；预算覆盖本次clone计算/存储、可能目标backup超额和同范围不可避免计费，不包含获准开新ECS/Redis/OSS或付费服务。当前源PaidBackupSize0；目标backup必须fresh查询不能照搬源值。存储自动扩容是风险，初始100GB/actualsource diskused≈3.85GiB，首轮只读不新增测试数据；出现扩容/额外计费项立即停止核验并报预算决策，不改费率/配置来隐藏账单。跨地域、下载备份、OSS搬运、外网或新付费integration不在批准中。

计费每小时出账；最小整小时是否向上取整、税费字段没有证明。账户优惠须创建前重新只读复验，消失/返回范围超预算即停；不使用AutoPay=false试建未支付订单“验证报价”。源码引用：[DescribePrice](https://help.aliyun.com/zh/rds/developer-reference/api-rds-2014-08-15-describeprice)、[Serverless计费](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/pricing-of-serverless-apsaradb-rds-for-sql-server-instances)。

T0从首次create请求开始计4h，包含provider恢复排队。目标running前只观察状态不启动服务；第3小时或累计预算估计10元即报告剩余与结束/释放决策，不自动续。4h到期stop/join仅本次自有probe，关闭自己的DB连接、销毁自己的临时非秘密配置，保留副本和审计；通知用户确认exact目标释放或继续保留付费。后者不是默认授权。保持DeletionProtection=true避免误删；用户当时确认释放后，才对该exact新ID关保护并Delete，源ID永不允许。保留期间仍收费；[官方释放说明](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/release-or-unsubscribe-from-an-apsaradb-rds-for-postgresql-instance)说明释放后停止相关计费且会删目标数据。没有实际资源就没有这套清理动作。

## 网络与凭据：只读阶段的明确边界

1. 新clone仅VPC私网，不申请公网连接。源安全组、白名单、路由、部署配置全部不改。CloudAPI不自动复制源白名单，实际默认deny状态、无公网和target endpoints未证明前不进行SQL。拟只对这个返回的exact新ID设置允许既有操作ECS **192.168.100.40/32** 的独立目标白名单组，需本包明确批准；禁止0.0.0.0/0、全VPC或复制provider内部服务组到业务allowlist。新cloneSG若存在以fresh实际关联为准；不把prodSG当隔离SG，不无授权附加/修改它。
2. 同VPC **不等于出站隔离**；现VPC无NetworkACL/NAT且三个交换机属于production网络。本次禁止启动任何恢复后的业务app/writer、scheduler或outbound integration，只允许source-owned fixed READ ONLY driver连接clone；driver固定新target identity，source `pgm-uf6rg214cp381l49`/192.168.100.44一律拒绝。初次恢复后先读回subs/cron/FDW，发现意外自动外联风险就停，不开始业务核验。**物理egress隔离未建立，不能声称已经网络阻断生产。** 完整六流程前另冻结独立sandbox应用网络，只准clone及sandbox依赖，拒绝prodRDS/Redis/OSS/writers；当前无可审的网络namespace/SG出站清单，不把未知方案纳入采购包。
3. 21:17:27Z actual metadata invocation`t-sh06yym8bx9cfsw` Success0/Dropped0：三个业务库foreignServerCount0、enabledSubscriptions0、无cron.job。这是当前源观测，不是19:41snapshot的历史同epoch保证；restore后实际复核，不能靠当前零值假定历史绝无任务。
4. native恢复会复制历史账号/密码验证器及所有租户数据，敏感级别等同生产。只借既有受信私有credential引用供固定只读连接，不新角色/新key，不导出密码，不把历史验证器或用户行写入日志/PR/聊天。原production Serverless-noTLS例外固定旧RDS ID，**不能直接套给clone**；需要本包明确同VPC/source.40/新target固定peer/4h的目标特定传输条件并实际canonical验证。若只读consumer尚不能绑定新target，停，不以insecure=true代替。

## 验收与不覆盖项

第一步记录create请求hash/CloudRequestId/newID、新目标状态和实际服务版本；确认只有1个owned clone、原生产identity/health未改、三库存在；固定只读查询catalog/对象/角色/RLS/序列/large-object元数据与snapshot/base ledger能够绑定的范围，不能与当前source变化后的行数假称同epoch一致。三库成功能读、vector安装与索引/函数可用只是数据库恢复证据，不是发布成功。

actual源扩展：**workspacex vector0.8.0.2 + plpgsql1.0，agent/memory只有plpgsql1.0，三库均未安装AGE**。所以不能宣称已备份AGE数据；clone要恢复这些真实扩展，9b25候选若需新增AGE/graph migration，属于后续兼容性测试，失败须具体报功能/迁移阻塞，不能临时换数据库方案。

完整后续验收仍需：exact9b25候选迁移与固定manifest在这个副本上的有界演练、三库数据/对象fidelity、六核心流程、异常/取消清理与恢复证据。此包不授权这些未冻结的写入/应用网络，不把clone成功当完成。RDS原生备份不覆盖Redis、OSS上传对象、ECS/image、稳定secret、外部服务或跨系统epoch；演练禁止接生产Redis/OSS。可以另提已有免费本地sandbox资源复用清单，不默开新付费资源。

现存逻辑备份watchdog capture-before-cleanup反例仍OPEN，定制helper扩张已停；原CMS/Public审批暂缓，不再以它们作为nativeclone采购前置。Clone实际权限目前只读无法完全证明：API不是dryrun，缺权限时按确切拒绝停止，不擅加RAM/IAM。准备schema/报价成功不代表有create权限。用户仅需决定这一个固定clone及15元预算、target-only私网/传输边界；不是重复选择路线。
