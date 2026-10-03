# 固定 9b25 发布：备份读取批准包与 TLS 纠正

状态：仅准备，未批准、未执行。归属同一 source iteration PR #5247。
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
