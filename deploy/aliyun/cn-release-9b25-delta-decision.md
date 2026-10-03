# 固定 9b25 发布：新增差异决策包

本包仅提出方案，没有执行许可、生产变更或新审批。原 `wsx_release_backup_ro` 许可继续有效，不重复请求。应用固定 `9b25bfa65662b96c0826fe67506b562ea46aa6d0`，基线 `ba6343199f3c834d6a198f83d0c771614292c82b`；源码迭代 #5247，最新已推送工具源码 aa67c2894c3a234aad2797f8e2bf6e7a9fbb1eee，尚未合入 main，CI 尚待终态。#5237 是独立 tooling 身份，不替代本次精确工具 pin。

## 给用户的一次决策短版

建议选择以下最小方案：**复用现有私钥续签备份证书，不轮换 key；接受固定备份角色继承的现有 PUBLIC 能力，不改共享 ACL；允许在技术门完整后安装精确哈希工具并进行一次三库串行加密备份。** 这不是迁移、停写或切流许可。

请一并指定：**备份保管责任人，以及已批准的离机密钥保管位置/保管方式**。建议证书有效期 30 天，备份与解密 key 至少保留 14 天；到期只复核，不自动删除。没有真实托管回执与恢复验证不得导出业务数据。

此选择接受的额外风险：临时角色还会继承 postgres/template1 的 CONNECT、业务三库及 postgres 的 TEMP、会话设置能力，以及五个固定 baseline 函数的 EXECUTE。其中一个 trigger 可通过误用造成业务行锁；工具限制凭据只交给固定 pg_dump，但数据库权限本身不能保证完全无副作用。若不接受，保持阻塞；不能对角色单独 REVOKE 来抵消 PUBLIC，也不能悄悄改全局 ACL。

**当前可决定上述安全边界；安装和导出是有条件许可，不能立刻执行。** password-null 的窄证明路径和安装 backup-profile 接线必须先实现、独审、CI 绿，并冻结 exact manifest/旧文件身份/私有计划/托管回执。隔离恢复因尚无实际目标身份，本包仅授权准备方案，不授权恢复写入。技术缺口不让用户以批准代替。

## 已有事实及新鲜度

目标 ECS `i-uf6ga92ewloganobbln6`，RDS `pgm-uf6rg214cp381l49`，cn-shanghai；业务库 `workspacex`、`workspacex_agent`、`workspacex_memory`。只复用现有 .40/32 到 .44:5432 的已批准私网传输例外，不改 SSL、白名单、实例、账号稳定凭据或网络。

本轮整理读取的是仓库回执，**不是新一次线上观测**：证书/密钥 metadata 于 2026-10-03 19:56:12Z 实测，ACL 于 20:01:36Z 实测。执行前必须重新只读核验，任何漂移都拒绝，旧回执不能充当当前 host 安装 inventory。详见 [证书回执](cn-backup-existing-recipient-evidence.json)、[跨库 ACL 与 pg_authid 回执](cn-backup-acl-input-gap-evidence.json)、[函数 ACL](cn-release-backup-public-acl-detail.json)、[精确函数体](cn-release-backup-public-function-bodies.json)。不读取业务行，不输出秘密。

## 1. 证书、key 与托管差异

现有 `/etc/workspacex-cn/rehearsal/backup-recipient.pem` root:root 0600，SHA256 `187a5ca17f52f796e330c3f570978cee8ec99e6d819b686046b677abc02c1099`，已于 2026-10-03T05:46:41Z 过期。现有 `/etc/workspacex-cn/rehearsal/keys/backup-key.pem` root:root 0600，key 文件 SHA256 `92d03251a8634835119672b10eb8d2af86287d405de08fb62270f4447c399507`，公钥 SHA256 `22d79453dc797c7b97d46cb298d73c95e6924c18ca6adf2733b3f352be009421`，与证书匹配。现有 key 未证明泄露；不主动新建或轮换。

推荐新增动作：在同一受控 ECS、root 私有目录生成**同一 key 的新自签 CMS 收件证书**，只作离线备份加密用途，不是服务 TLS/CA。有效期从执行日起 30 天，保留原证书；新证书用唯一 attempt 文件名，root600，保护父目录 root700，不覆盖旧文件或稳定部署配置。精确新路径、openssl 二进制/参数、输出 SHA 与实际 key 公钥必须进入私有签核 manifest 后才能被执行器采用。生成/托管步骤尚无完整受控执行源码，本次文件不是可运行命令。

保管：现有 key 留在原 root600 路径，至少保留至备份 retention 到期且责任人确认无需恢复；不自动删除任何历史密钥/密文。新增离机托管只允许用户指定的已有批准位置，独立于生产 ECS；不能以本包擅自上传 Library、仓库、聊天、未知对象存储或新建云服务。真实责任人、位置/访问范围、回执 ID、key SHA、到期时间和恢复步骤必须形成 root600 custody/escrow/recovery 记录，不能用自填 hash 冒充托管已完成。

验证：先用随机无业务内容做 CMS 加密/解密 roundtrip 并比对 hash；随后在受信隔离恢复方验证托管副本能解密同一 canary，回传仅 hash/成功证据，私钥不出现在 argv、日志、PR 或聊天。仅同机 roundtrip 不能证明离机灾备。失败即不导出；回退为继续引用原文件但原证书已过期，所以仍阻塞，不能回退后宣称可执行。新增证书不影响线上应用。

## 2. PUBLIC 最小能力差异：接受现状而非共享 ACL 变更

显式新增 GRANT 仍只有原三库 CONNECT、fresh 用户 schema USAGE、已有表/序列 SELECT、BYPASSRLS；不授其他库对象、CREATE、管理权、未来默认权限。新增接受的**有效继承能力**精确如下：

| 范围 | 已有 PUBLIC 能力 | 本方案动作 |
| --- | --- | --- |
| 三业务库 | TEMP；pg_catalog.pg_settings UPDATE（会话设置） | 接受继承，禁止工具使用 TEMP/任意 SQL |
| workspacex.public | kernel_org_is_writable、kernel_project_is_writable、kernel_stale_queued_agent_run_orgs、kernel_user_org_ids、wave2_skill_file_insert_before_publish 的 EXECUTE | 只接受证据中精确 baseline 定义 hash；不主动调用 |
| postgres | CONNECT + TEMP | 接受角色有效继承；工具禁止连接该库 |
| template1 | CONNECT，无 TEMP | 同上，禁止工具连接 |
| template0 | CONNECT，但 datallowconn=false，无 TEMP | 不改连接禁用状态；若状态漂移拒绝 |
| rdsadmin | 无 PUBLIC CONNECT/TEMP | 保持，无新增授权 |

四个函数源码只 SELECT，trigger 含 SELECT FOR UPDATE：未见持久业务 DML，但会锁行。PGOPTIONS/read-only 不是不可覆写的权限隔离。密码只能进入固定 producer 的私有 stdin/tmpfs；精确 backend/clientIP/port/PID/start/container/image/执行文件 hash 必须观测并绑定。固定消费者只允许三个业务库，角色有效权限仍能跨库——审批短版已明确这项差异，不混称原三库权限完全隔离。

不做全局 REVOKE；因此没有共享 ACL 回退动作，也不会影响其他应用角色。到期按原精确角色清单撤销本次显式权限，NOLOGIN/PASSWORD NULL/NOBYPASSRLS，join 自有进程与精确后台会话，删除临时凭据；PUBLIC 原有能力不变。角色租约仍最长一小时；当前运输 freshness 300 秒与 120 秒清理预留更短，不因此放宽。

## 3. password-null 证明：技术缺口，不请求全 pg_authid 权限

现有 migration_admin 无 pg_authid SELECT。当前固定查询要求只返回 `wsx_release_backup_ro` 的 `rolpassword IS NULL`，严格 gate 在 CREATE 前就阻塞。**本方案不授 migration_admin 全 pg_authid SELECT，也不增加 superuser，不读取其他账号 password verifier。**

推荐实现一条可信窄元数据路径：由已有、实际证明有该读取能力的管理身份拥有固定无参数函数，只查询常量角色名，仅返回角色存在及 password_null 两个布尔值，固定安全 search_path、撤 PUBLIC EXECUTE、只 grant 现有 migration_admin EXECUTE，禁止返回 rolpassword/接受任意角色参数；exact DDL/owner/签名/body hash、调用者授权、前后读回和撤销 SQL 必须独审。不要假定 RDS 管理身份可用或可创建这种函数。

**尚缺该 privileged owner 的实际可用性与安装方案；没有可执行 DDL/主体 pin，所以本包不请求执行它。** 若 RDS 不提供这条能力，继续阻塞并另提等强窄证明方案；不自动弱化 password-null gate。该问题与已获批 CREATE ROLE/BYPASSRLS 能力不同，不重复请求原角色许可。

## 4. 受控工具安装：对象、回退与待冻结条件

拟安装目标是本文附录的 52 个固定路径，仅现有 ECS；另有 6 个 source-only 输入不作为安装目标。禁止扩大 sudoers/权限、凭据、服务定义、应用镜像、部署配置、数据库 schema。目标文件必须按 reviewed manifest 的 root UID/GID/mode 与新旧 bytes/hash/inode CAS 更新；这 52 个名字是源码范围，不是已安装回执。

先完成 backup/runtime/transport profile 的受控 transaction 接线。目前 installer 仅支持 base-profile create，不能直接补写 backup profile。新增 profile 的精确路径/content/mode 必须由源码单一事实源导出，并与工具目标一起 journal/读回/回退；未完成前禁止安装。需要 merged reviewed tool SHA、完整 offline Git artifact、fresh actual inventory/provider receipt、root 私有 manifest SHA、唯一 attempt、已有 canonical FD9 lock。不能从 aa67 未合入提交直接 root 热导入。

回退使用现有 [exact reviewed recovery 协议](cn-tool-install-recovery.md)：备份根 `/var/lib/workspacex-cn/trusted-install-backups`，root700；对应 `exact-` basename、原始 manifest SHA、journal SHA 和原 admittedAt 都匹配，目标只来自 manifest。恢复旧 bytes/metadata，新增目标仅在 inode 属于本 transaction 时移除；遇到 foreign inode/锁持有者/未知 journal 保留并停止，不覆盖。回退仅恢复工具，不恢复数据库、不证明服务健康。不自动重启生产服务。

执行时限推荐安装主体最多 10 分钟，含校验/回退预留，超时进入精确恢复；**当前源码未证明具此 wall-clock watchdog，完成前不得把建议时限当已实现保证**。磁盘预算须由 fresh target/旧文件/offline bundle 大小推导并冻结，不以此前其他任务的 5Gi 预算代替当前 manifest。

## 5. 一次备份与隔离恢复的范围

有条件允许：原角色许可 + 本包新增能力差异 + 以上技术门全部关闭后，对三个业务库各一次串行 pg_dump custom-format，复用缓存 image `sha256:eac621400b7b7ff52493883e41e930e3d104695fea5b68cc0c42370cf7880067`，不 pull。只在 ECS 固定私网连接，直接内存流加密，无落盘明文，无业务行输出。每流硬上限 16GiB，三库最多 48GiB 密文，不能超量自动扩容；实际可用磁盘必须覆盖此上限及工具回退/清理余量，否则先提交更小 fresh 可证明预算。主任务截止取 transport notBefore+300、角色 expiry、plan notBefore+timeout 的最早值，再提前 120 秒进入清理。慢任务失败并清理，不自动延长 freshness/租约或重试新 attempt。

独立 watchdog 在 CREATE 前启动；先 join 精确自有 admin session，避免晚 COMMIT，随后 NOLOGIN/自有容器 stop/session absence/PASSWORD NULL/NOBYPASSRLS/精确 revoke/读回；未知状态保持阻塞。失败密文留 root600 待责任人决定，不删除唯一备份或 key。没有 schema DDL、停应用、普通 writer NOLOGIN 或业务停写动作。

三个库分别是独立快照，不能宣称同 epoch 或作为收缩迁移的完整恢复许可。隔离恢复仅可向**另行冻结的既有非生产目标**写入，必须提供 target ECS/container/DB/volume identity、网络阻断生产出口、凭据与 app9b25/baseline pin、空间/时限/所有权/清理 manifest。当前仓库没有可确认的新鲜 exact 隔离目标，所以本包不授权 restore 写入、建新 DB/实例、云费用或删除数据。目标未冻结先做恢复源码/清单；随后可在本迭代包补 exact appendendum，无新 feature PR。

恢复验证必须实际解密+restore、catalog/对象/数据 fidelity、六核心流程、错误零和完整证据；不能用 archive TOC 或 canary 代替。任何生产迁移、writer fence、流量切换或恢复生产仍须独立 bounded 执行计划，本次不捆绑。

## 完成程度与责任边界

已源完整且独审：固定 backup entry/SQL private channel/backend identity/串行加密流/child join/独立 watchdog/晚 COMMIT quiescence/到期清理，full pure runner 通过；3 个 bundle --check 与新 snapshot 3 tests 通过；正常 hooks 9/9。真实生产链未跑。

仍是技术缺口：窄 password-null privileged metadata path、installer 事务内 backup-profile 接线、证书生成/真实离机 custody 流程、full A-route/current common epoch/隔离恢复验收 producer 和实际 candidate writer activation。前两项是导出前硬阻塞，后面正式迁移缺口不靠本包消除。CI exact aa67 仍需终态。

## 附录：52 个工具目标（源文件 → 目标；文件 hash）

此表来自当前 aa67 的 FILES 单点源码；执行时以合入后的 exact manifest 为准。

| 源文件 | 目标 | 当前源 SHA256 |
| --- | --- | --- |
| `.harness/scripts/vm/cn_backup_package.py` | `/usr/local/lib/workspacex-cn/cn_backup_package.py` | `8e0f2f540b3a075c137622965d5e9bcf4a333fbaf4f088d0dfbb7e89cd219072` |
| `.harness/scripts/vm/cn_backup_stream.py` | `/usr/local/lib/workspacex-cn/cn_backup_stream.py` | `abe3b05ece6282dc3fbc00b6ffa52ddfe3ec481bc354afa9144ae0bfcf09ec26` |
| `.harness/scripts/vm/cn_backup_sql.py` | `/usr/local/lib/workspacex-cn/cn_backup_sql.py` | `0399ab0dedfc4685dea06255afab66f762bff7388f2ca4412216b35827ebd7c9` |
| `.harness/scripts/vm/cn_backup_channel.py` | `/usr/local/lib/workspacex-cn/cn_backup_channel.py` | `b7b57d0d1d03fa9dd3c9cd57d1dc00f10559becd5671b46b0ed10e33648d11de` |
| `.harness/scripts/vm/cn_backup_host.py` | `/usr/local/lib/workspacex-cn/cn_backup_host.py` | `00cab6ceae70f52b045954664a9289c965a32e3fbee4b1ad8fabbd0ecf700061` |
| `.harness/scripts/vm/cn_backup_backend.py` | `/usr/local/lib/workspacex-cn/cn_backup_backend.py` | `70e78cc0f0b4c3bb3b1852352a0b8cab78fa93ef5f81c580ac924f2d46b4d371` |
| `.harness/scripts/vm/cn_backup_profile.py` | `/usr/local/lib/workspacex-cn/cn_backup_profile.py` | `66260ae218c7301390f5eb023e248e5c0706eced9f4d635c514aaebf205da591` |
| `.harness/scripts/vm/cn_backup_profile_host.py` | `/usr/local/lib/workspacex-cn/cn_backup_profile_host.py` | `cc5a5afc8f332e471bc0c40c0ff4e02ac3db160dd0aa99df0e34862a1e207b73` |
| `.harness/scripts/vm/cn_backup_watchdog.py` | `/usr/local/lib/workspacex-cn/cn_backup_watchdog.py` | `61a4a46ccf41d4978aa464f4fba6efee4cd3320342b851058d42f017ad0571eb` |
| `.harness/scripts/vm/cn_backup_run.py` | `/usr/local/lib/workspacex-cn/cn_backup_run.py` | `1b0ac0a996ae366f163f9896a26bc07daea13ce9f2cb29bbde356117ba372645` |
| `.harness/scripts/vm/backup_connection.cjs` | `/usr/local/lib/workspacex-cn/backup_connection.cjs` | `734369dbbc1ad38bcb883f540048a63c6c1f5345f374a47e4dc5b77e1337ac76` |
| `.harness/scripts/vm/backup_profile_transport.cjs` | `/usr/local/lib/workspacex-cn/backup_profile_transport.cjs` | `b518023bf06d054b524cd64148c75ea581e9fe8ee33efe5afac2ae2b78ddf217` |
| `.harness/scripts/vm/cn-backup-fixed-queries.json` | `/usr/local/lib/workspacex-cn/cn-backup-fixed-queries.json` | `11031c9550b22d8dfc187c3af818303723eaf4f4cbf9422b248857487e26696c` |
| `.harness/scripts/vm/candidate_writer.py` | `/usr/local/lib/workspacex-cn/candidate_writer.py` | `8b49766c7c447d7889abd2eb7f3e49d68d053037278d28d30cc8640cba7b486f` |
| `.harness/scripts/vm/candidate_backend_collector.py` | `/usr/local/lib/workspacex-cn/candidate_backend_collector.py` | `08a4628ee1623933f4f98b04e490f8d8ef419eac9e80c290045ed72507d86c85` |
| `.harness/scripts/vm/cn-maintenance-migrator.cjs` | `/usr/local/lib/workspacex-cn/cn-maintenance-migrator.cjs` | `914424385531db97c301f0780e0c1632b44f144f7de6bad7aa8c4c1bae54c997` |
| `.harness/scripts/vm/cn-maintenance-drain.cjs` | `/usr/local/lib/workspacex-cn/cn-maintenance-drain.cjs` | `00fe4e4ba036377d55ce47ea313f6dbd84fedb1ac8877c54744fb01614fd228b` |
| `.harness/scripts/vm/cn-maintenance-canonical.cjs` | `/usr/local/lib/workspacex-cn/cn-maintenance-canonical.cjs` | `e92707868ced09c36c81b934a11c8c929846c47e6c0404735ec40a7280cfe84d` |
| `.harness/scripts/vm/cn-maintenance-browser.cjs` | `/usr/local/lib/workspacex-cn/cn-maintenance-browser.cjs` | `3aa186d48cc524703e14088cc5aeab5604b80c27482a167f523118715b2342e6` |
| `.harness/scripts/vm/collect-cn-migration-snapshot.py` | `/usr/local/lib/workspacex-cn/collect-cn-migration-snapshot.py` | `9d3a5a84820bab7967f68f3fc19a93607bfa370069410bd0301d233456076844` |
| `.harness/scripts/vm/cn-migration-snapshot-query.cjs` | `/usr/local/lib/workspacex-cn/cn-migration-snapshot-query.cjs` | `8995281996a1e015a228e65ffd1dc3d297ca3e489c2b8bc48598c7efa025337a` |
| `.harness/scripts/vm/cn-maintenance-activation.py` | `/usr/local/lib/workspacex-cn/cn-maintenance-activation.py` | `acd10e3b975ed27ba746df7fdc91d4da9c9523fdffee4f7e595bedab17ce2f8f` |
| `.harness/scripts/vm/cn-tool-install-transaction.py` | `/usr/local/lib/workspacex-cn/cn-tool-install-transaction.py` | `0940fbf37b13029ca05a2b165b18b411ff980b461d2630eb03e3db3139e8a47b` |
| `.harness/scripts/vm/prepare-cn-tool-install.py` | `/usr/local/lib/workspacex-cn/prepare-cn-tool-install.py` | `3e23a85ed47ccdffdf3b9ee4b7822b8571df66875341258d7c220be0a9595495` |
| `.harness/scripts/vm/cn-maintenance-recovery-evidence-verifier.py` | `/usr/local/lib/workspacex-cn/cn-maintenance-recovery-evidence-verifier.py` | `f03dbd2a8f10f0a37659ccf91b4501f232e81779dbb10a878baf75ee71c64121` |
| `.harness/scripts/vm/writer_fence.py` | `/usr/local/lib/workspacex-cn/writer_fence.py` | `ee8313c17a88c175b87c5569e805ad8cba7e10652edaa47710b23072495b18e5` |
| `.harness/scripts/vm/host_transport.py` | `/usr/local/lib/workspacex-cn/host_transport.py` | `9965fa1d7bffd3ee47590fdcd5ac1a86cc660ebc451a6bc1902f08469fa7cb67` |
| `.harness/scripts/vm/fixed_probes.py` | `/usr/local/lib/workspacex-cn/fixed_probes.py` | `a670b78924663f6e9cb9ac049cb32194dabc302f547f318fc10ff8d74357f5ff` |
| `.harness/scripts/vm/control_connection.py` | `/usr/local/lib/workspacex-cn/control_connection.py` | `b2286f77c538bd484944c87a8bc5ff28369e0b42b075f4729092c2c53b0af8ef` |
| `.harness/scripts/vm/control_connection.cjs` | `/usr/local/lib/workspacex-cn/control_connection.cjs` | `cc70d06c1e2a96fac5ae39a5850fe9a39ea31c75a42dc2d44f3bf53f76073eb6` |
| `.harness/scripts/vm/cn-production-rds-identity-probe.py` | `/usr/local/lib/workspacex-cn/cn-production-rds-identity-probe.py` | `ad8cf6a5fd521df4bfb91d7fceeb1fea2ef7de127e1e9778eac05a8fc54970ab` |
| `.harness/scripts/vm/cn-production-recovery-executor.py` | `/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py` | `d14967835d30b5d902ffc3a39f1d79fdd4a276171fb50587b029a345dc14e27a` |
| `.harness/scripts/vm/cn_production_recovery_executor.py` | `/usr/local/lib/workspacex-cn/cn_production_recovery_executor.py` | `f69f1dc549fa0650feb7df02448f03385a7d0db9b82f6e7912c864dd8cbe1b3d` |
| `.harness/scripts/vm/cn_production_recovery_stream.py` | `/usr/local/lib/workspacex-cn/cn_production_recovery_stream.py` | `cf481dfeba75f8ccf25486c458716d8d6f8d767e0a94221bf5bebf09d742543f` |
| `.harness/scripts/vm/cn_production_recovery_transport.py` | `/usr/local/lib/workspacex-cn/cn_production_recovery_transport.py` | `88d4d5f55f06b2049dfe77bff591ffa81e868106e6b9dea089d113c74a858260` |
| `.harness/scripts/vm/cn-production-recovery-readback.cjs` | `/usr/local/lib/workspacex-cn/cn-production-recovery-readback.cjs` | `5aa60385c7d7bfed6fb489d9de9cc9571b6592f4b694ad36024d28fb89260681` |
| `.harness/scripts/vm/cn-production-recovery-catalog.cjs` | `/usr/local/lib/workspacex-cn/cn-production-recovery-catalog.cjs` | `5e7c86740531ba675f886aaacc793e5f69445160411644ead81b3a082fb9363d` |
| `.harness/scripts/vm/cn-production-recovery-fidelity.cjs` | `/usr/local/lib/workspacex-cn/cn-production-recovery-fidelity.cjs` | `f8936775460d233871e5453c20deb32f7740f690c152a95bc152ce345e745afd` |
| `.harness/scripts/vm/cn-maintenance-host-launcher.py` | `/usr/local/lib/workspacex-cn/cn-maintenance-host-launcher.py` | `172156e8d366f8aae24dcd011ad5a0356ddb0cfe17fa88241536c2a8767afbd5` |
| `.harness/scripts/vm/cn-maintenance-host-controller.cjs` | `/usr/local/lib/workspacex-cn/cn-maintenance-host-controller.cjs` | `9d6e5a5bc9285c35bc0449596884084f7de5ea3b7c98beea3ae09164b44ac876` |
| `.harness/scripts/vm/cn_tool_profile.py` | `/usr/local/lib/workspacex-cn/cn_tool_profile.py` | `17daffbd18092381a833082530affcf68f912b7119892230cfb069da90fc5dac` |
| `.harness/scripts/vm/cn_maintenance_admission.py` | `/usr/local/lib/workspacex-cn/cn_maintenance_admission.py` | `b66d92d3fadcecd09d770cda29b18f2d6feb37d05aff184cb56f9452489943fb` |
| `.harness/scripts/vm/cn_maintenance_hold.py` | `/usr/local/lib/workspacex-cn/cn_maintenance_hold.py` | `322e1d8342c787a282fe4a41093e3a9925d4c0ca20010b68f824e83b2691a230` |
| `.harness/scripts/vm/build-cn-release-candidate.sh` | `/usr/local/bin/workspacex-cn-build-candidate` | `98c9b635ae61b8401aa10e26be5ba50a43a4dfe3db47932a26da065731f2bbb7` |
| `.harness/scripts/vm/deploy-cn-production.sh` | `/usr/local/bin/workspacex-cn-deploy` | `a5d9bc982e7f8cf2838dbf9f70ed341cbb772b0a4297817d8ed7440c2c648f7d` |
| `.harness/scripts/vm/publish-cn-release.sh` | `/usr/local/lib/workspacex-cn/publish-cn-release.sh` | `fd4efec814efbcf53db1f2558096ceee24392fbba83d75854861ecb999162c48` |
| `.harness/scripts/vm/verify-cn-release-preflight.sh` | `/usr/local/lib/workspacex-cn/verify-cn-release-preflight.sh` | `860968614021bfacf015f247f53f996d9d31099788c7fd8e5deba8f3a0ade075` |
| `.harness/scripts/vm/collect-cn-release-preflight.sh` | `/usr/local/lib/workspacex-cn/collect-cn-release-preflight.sh` | `04dc0de04d99a3c7d1181eedabad7e5b94e8ee4cad3a86710651e77e755c1614` |
| `.harness/scripts/vm/cn-release-preflight-evidence.mjs` | `/usr/local/lib/workspacex-cn/cn-release-preflight-evidence.mjs` | `e3da87a69bc2aeb7f8350425d3c99112f9d103e59ddca6a96686eb9658065bfd` |
| `.harness/scripts/vm/cn-release-orphans.py` | `/usr/local/lib/workspacex-cn/cn-release-orphans.py` | `13b0b12e66e0f4f0633dab717d77216c4a297e04383c808026243c2ccc9063c9` |
| `.harness/scripts/vm/cn-bootstrap-source-probe.mjs` | `/usr/local/lib/workspacex-cn/cn-bootstrap-source-probe.mjs` | `5942445bb668b9be84919b3fef714a2b52b25db034582c97155eaccd8c8e6d2e` |
| `.harness/scripts/vm/cn-build-tool-identity.py` | `/usr/local/lib/workspacex-cn/cn-build-tool-identity.py` | `d9ad19610f11e3eaeadbc02ed10bfb8ea61e84fe55baa879f5ad94b195d5a8c8` |

## 新增实际只读 owner 核验（不授予可用性）

2026-10-03T21:02:18Z invocation `t-sh06yykvo9rohz4` Success/exit0/Dropped0：[元数据回执](cn-backup-password-state-owner-evidence.json)。migration_admin OID16408 无 pg_authid 的 rolname/rolpassword SELECT；当前 workspacex 没有 body 引用 pg_authid 的 SECURITY DEFINER 函数。可读身份为 provider 管理角色 alicloud_rds_admin/replicator/aurora，以及 nologin pg_read_all_data；migration_admin 对它们均不能 SET ROLE。没有尝试登录这些身份或读取密码值；账号存在及 privilege 布尔值不能证明有获准可用的安装主体。不申请 pg_read_all_data membership，因其会扩大到全库读取且可能暴露认证 verifier。窄函数的 provider 管理安装路径仍是具体访问依赖，不能在源码内假装已存在。

## 最新独审与方案选择纠正

[#5247独审](https://github.com/boardx/workspacex/pull/5247#issuecomment-5973208084)的watchdog capture-before-containment反例未关闭，本地没有修复；前文整体已独审结论被本节明确撤回。用户问更好方案及成本仅授权只读调查，不批准证书/PUBLIC/安装/导出。本次优先[原生快照/PITR比较](cn-native-backup-path-comparison.md)，定制扩张停止。
