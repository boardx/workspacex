# 固定 9b25 发布：备份读取批准包与 TLS 纠正

状态：用户已明确批准指定临时备份身份的创建/使用；仍受本包最小权限及撤权条件约束。尚未创建角色、授权或凭据；无使用/失效时间，最长一小时窗口尚未开始。归属同一 source iteration PR #5247。
应用 9b25bfa65662b96c0826fe67506b562ea46aa6d0；baseline ba6343199f3c834d6a198f83d0c771614292c82b。

## 请求用户决定的唯一新增安全动作：专用备份读取身份

目标只限已有上海 RDS `pgm-uf6rg214cp381l49` 的 `workspacex`、`workspacex_agent`、`workspacex_memory`，从已有生产 ECS `i-uf6ga92ewloganobbln6` 私网执行；不新建数据库、实例、网络或放宽白名单。

拟定角色 `wsx_release_backup_ro`。现有七账号中没有这个角色；app_diag_ro 实测缺主库 237/238 表及 12 序列 SELECT、agent 7/7 表及 1 序列 SELECT、memory 2/2 表 SELECT，且不能跨过主库 212 张表的 RLS。其只读业务诊断范围不得扩大。已有 app/memory/owner/admin 身份具写能力，不把它们重新命名为只读账号，也不通过临时开放 migration_admin LOGIN 绕过全 writer 封锁。

用户可明确批准：创建仅本次维护使用的 wsx_release_backup_ro，授三库完整备份所需读取和 BYPASSRLS，允许受控备份连接，首次受理后最长一小时；未选定实际 attempt/起止时间、fresh 对象授权清单 SHA、执行主体与私有凭据路径前不得执行。该权限会读取三库全部租户数据，不能被称为单租户诊断权限。PostgreSQL pg_dump 默认要求完整 RLS 读取；--enable-row-security 只导出可见子集，不能用于本次完整恢复。[PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)

批准动作的边界：

- 角色初始 NOLOGIN、NOSUPERUSER、NOCREATEDB、NOCREATEROLE、NOREPLICATION、NOINHERIT、无其它角色 membership/SET ROLE 路径、CONNECTION LIMIT 1；仅明确的 BYPASSRLS 属性例外。不授对象所有权、任意管理权或其它数据库读取。
- 三库仅 CONNECT；逐个 fresh 用户 schema USAGE、已有表 SELECT、已有序列 SELECT。清单须包括 AGE 用户图 schema 等实际归档面；不授默认未来对象权限，不移交对象所有权。若发现 large-object 数据，必须另外列出实际 OID 的 SELECT 范围，不能宣称表权限已覆盖它们。
- 执行前后核有效权限，而非仅看显式 GRANT：无持久表 INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER、sequence USAGE/UPDATE、database/schema CREATE/TEMP、SECURITY DEFINER 写路径、server-file/program/signal 权限或特权继承。PUBLIC 继承权限无法靠对本角色 REVOKE 否定；若不能证明无写能力，停止并回报精确 ACL 差异，不擅自改全局 PUBLIC ACL。
- 在批准窗口内设置固定 VALID UNTIL；LOGIN 仅用于本次固定 pg_dump/custom-format 流程和有界只读能力回读。PGOPTIONS 的 read-only 是附加约束，不替代角色权限证明。不授迁移、恢复写入或应用运行权。
- 新随机凭据只存 root:root 0600 的本次私有输入，父目录 0700；仅 stdin/私有 tmpfs pgpass 传递，不进入 argv、环境回显、日志、PR 或应用配置；不轮换现有稳定凭据。实际工具安装和生产文件写入仍须对应执行批准，本文不是安装许可。
- 临时连接进入 held 观察闭包：实际 source IP、database/role、backend PID/start、固定 application_name、拥有的 helper/container 身份、read-only 事务与前后 fence 均验证。不能仅按角色名排除 writer。pg_dump 不并行，只有受控角色可新增只读连接，普通 writer 保持 NOLOGIN。
- 到期/取消：先停止并 join 自有备份子进程、核对其精确后台会话关闭，再 NOLOGIN、PASSWORD NULL、NOBYPASSRLS，撤销本次 CONNECT/USAGE/SELECT 并核回读，删除私有明文凭据/tmpfs；保留加密备份及已批准恢复所需审计证据。未知后台状态不盲杀别人的会话，保持 hold 并对账。不使用 DROP OWNED/CASCADE；不能自动续期。

正式动作包将先输出 reviewable 的角色 DDL 与逐库精确 GRANT/REVOKE 清单及哈希，敏感值留私有通道；批准不允许任意 SQL。CREATE ROLE/BYPASSRLS 的执行主体能力必须独立确认，不能只凭 RDS AccountType=Super 推断原生 PostgreSQL superuser。[PostgreSQL 16 CREATE ROLE](https://www.postgresql.org/docs/16/sql-createrole.html)

## TLS：撤回“必须开启 SSL”的要求

真实 provider 属性为 PostgreSQL 16、Category=serverless_standard、DBInstanceClass=pg.n2.serverless.2c、PayType=SERVERLESS、general_essd；当前 SSLEnabled=off。内网 endpoint `pgm-uf6rg214cp381l49.rwlb.rds.aliyuncs.com:5432`，peer `192.168.100.44`，VPC `vpc-uf6e7vt902oid0p1mwd6q`。应用源白名单仅 `192.168.100.40/32`；provider hidden 服务组单独保留，不混入应用授权范围。完整只读回执见 cn-release-existing-rds-transport.json。

17:44:02 UTC 实际生产 deployment.json SHA 为 `76a7f158cf939504439d6d4b08bf1ce990e6f2ab262017ff9f462799b8f7c4e0`，包含既有例外 kind=aliyun-postgresql-serverless-no-tls、allowedCidrs=[192.168.100.40/32]。仅这些非秘密元数据被输出；见 cn-release-existing-transport-config.json。

阿里云官方 SSL 文档明确排除 Serverless。故本次不请求、不执行 ModifyDBInstanceSSL，不改现有应用配置或增加网络例外；把 TLS=true 常量当本次唯一运输方式是恢复工具的兼容缺口。[阿里云官方 SSL 文档](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/configure-ssl-encryption-for-an-apsaradb-rds-for-postgresql-instance)

供审查辨别的官方 API（不是本实例执行指令）：ModifyDBInstanceSSL 的必填 DBInstanceId、ConnectionString，加 SSLEnabled=1、CAType=aliyun；只适用于受支持实例。CA 下载后客户端才可配置 PGSSLMODE=verify-full、PGSSLROOTCERT、rejectUnauthorized=true，并重新建连接。官方说明云证书配置/endpoint 改动/关闭 SSL 会重启且可能分钟级闪断；禁用回退也会重启。本 Serverless 不满足支持条件，不以用户一句“发布”触发该动作，也不为本次发布转换实例或新增费用。

本次源码应复用既有 authoritative validators（managed-data-preflight、cn-migration-source-identity、pinned-app-9b/migration-pg），将 protected 配置原字节 SHA、独立 STS/provider 实例/私网 endpoint/SSL off/白名单回执、实际 socket remote/local 地址及端口绑定到每个三库/control/diagnostic 连接。普通 TLS 情况仍 require verify-full；无匹配既有例外、公开 endpoint、source CIDR/peer 漂移、provider 非 Serverless、未知实际 socket 时都拒绝。不能新增通用 insecure 布尔开关，不能仅依据 JSON kind 放行。消费者接线尚未完成，不能据此宣称已通过运输门。

## 与完整发布批准分开

本包仅请求备份读取安全决策；当前 epoch producer/候选 writer 适配器仍须完成源码、失败反例和独审。实际停写、加密备份数据搬运、既有隔离目标恢复/六流程、精确生产迁移、候选 writer 恢复和公开验收仍各按 bounded 执行包批准；不从备份角色许可推断这些许可。

## 批准后的实际前置核验：PUBLIC 权限仍阻止原方案执行

授权来源：parent thread 01a100c9-f7e1-7125-971f-0790077400da 转交用户对原精确方案的 👍、回复 ok 及“那个备份方案我同意了,继续...推进吧”。不再请求重复批准；不将本项扩成停写、迁移、删除或切流许可。

18:27:34–35 UTC 实际 readonly invocation t-sh06yy72rt49iww（command c-sh06yy72rswrtvk）Success/exit0/Dropped0。三库 SQL audit 证实 migration_admin 有 CREATEROLE/BYPASSRLS，并具有目标 schema/table/sequence SELECT 的 grant options 及 CONNECT grant option；目标临时角色不存在。三库对象清单仅在查询内生成并计算 SHA，不输出对象名称或业务行：main 238 objects/3 schemas/12 sequences，SHA33cbd811bee8d15f2cdf731c1e9af3dbfad125a1b5ca67da624f916e1f12424d；agent 7/1/1，SHA5719dc1bff4f0368bd16c3f662e80622fb6a3e04f3daa8dde5b0e08579ac7df9；memory 2/2/0，SHAc4996b9d25803881f3cb29429d8066c41104db99497f2a1b9af56c1d8eb85ec1。没有 large objects。实际 mutation attempt/固定时间/私有 exact GRANT 与 REVOKE 执行包仍未冻结，不能把这些 hash 冒充已执行授权。

真正已证实的前置不符：三库 PUBLIC 都拥有 TEMPORARY。新角色即使 NOINHERIT，也自动获得 PUBLIC 权限；仅 REVOKE TEMP FROM wsx_release_backup_ro 不能否定 PUBLIC 继承。故原包“无 database CREATE/TEMP”目前无法成立。没有擅自全局 REVOKE PUBLIC；也没有创建一个已知不满足原包的角色。[PostgreSQL 16 REVOKE](https://www.postgresql.org/docs/16/sql-revoke.html)

18:31:55 UTC 精确 readonly ACL follow-up t-sh06yy7gpqarym8（command c-sh06yy7gpptao74）Success/exit0/Dropped0：之前 tableWrite=1 全部是 pg_catalog.pg_settings 的 UPDATE，不是已发现的业务表写入；不能把粗计数当成业务写权。main 的五个 PUBLIC SECURITY DEFINER EXECUTE 目标已列签名/返回类型/definition MD5，见 cn-release-backup-public-acl-detail.json；它们需要逐个核对实际 body，不能仅因 SECURITY DEFINER 就断言会改业务数据，也不能未核对就声明没有写/锁定路径。

下一步必须保持已批准范围：先澄清严格无 TEMP 条件及这五个函数的实际能力；如果需要修改共享 PUBLIC ACL 或扩大临时身份能力，须提交精确对象/角色影响、ACL 回退与额外决策，不能从本次批准推导。现有 API 不含 migration credential；这只说明身份分离，不能推断 root 私有 migrationSecretRef 缺失，更不能要求用户把密码发进聊天。所有秘密仍仅允许既有受信私有引用。
