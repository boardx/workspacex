# 固定 9b25 替换现有生产：本次一次性执行计划

状态：准备方案，未获生产执行批准；不是 READY 或可直接 dispatch 的命令包。
应用 `9b25bfa65662b96c0826fe67506b562ea46aa6d0`；baseline `ba6343199f3c834d6a198f83d0c771614292c82b`。
目标是替换既有 ECS `i-uf6ga92ewloganobbln6` 上的应用，保留域名、数据服务和稳定配置；不新建生产，不追 main，不等无关 Board/digital 迭代。
Canonical source iteration: draft PR #5247。策略 A 的同 epoch 与 resume-intent 责任边界见 `cn-maintenance-acceptance-decision.md`；此处只记录本次所需输入和工作顺序。

## 证据和适用性

`cn-release-9b25-source-inventory.json` 来自两个 exact Git 对象：393 个 candidate SQL、255 个 baseline SQL，新增 138，已有文件无改写/删除。它是源码清单，不是 fresh 生产待执行清单。固定源码的 migrationFiles 取全部 .sql 并排序；migrator 按账本 name 跳过，每个文件独立事务，因此中途失败可能已经提交前面文件。外层仍需 checksum/drift 检查，禁止改账本、force 或选择性跳 SQL。

历史生产记录称 393/255/138，不能替代当前读回。实际集合必须以 fresh 账本 name/checksum 与完整 source inventory 比较，绑定数据库/实例/查询身份、时间、独立 count 和原始 provider 响应。名字在账本中也不表示 checksum 已审查。

本轮现有 CLI 的 STS 只读身份请求成功。一次 READ ONLY/ROLLBACK 账本探测经既有 Cloud Assistant 入口发出请求，但 ECS 接口超时且没有返回 InvokeId；随后 invocation 查询失败/分页未完成。接受状态和账本仍未知，不重发 RunCommand，不声称生产待执行 138 条。未创建权限或安装新只读入口。新 collector 的现有源码错用 --Content/--InstanceId.1；已按实际 CLI help 修为 --CommandContent、显式 Base64、JSON InstanceId 数组，并加纯协议反证。源码修复尚不代表已安装或云查询成功。

## 数据与精确风险决策

| exact SQL | 本次动作与必须核对的事实 |
| --- | --- |
| 20260929050000_pw_w1_general_project_kind.sql | research_projects/members 改名，user_insights/members 合并后删除，projects.kind 收缩为 workshop/general。核对所有项目 ID、org 和成员/role；ON CONFLICT DO NOTHING 不能未经实际核对就认作无损。旧 baseline 读写不兼容，禁止只回滚镜像。 |
| 20260922010000_drop_research_workflow_sessions.sql | research_predictions/gate_audit/materials/sessions 四表 CASCADE；列出实际行数和依赖，确认删除范围；不得误认 guided_research 为同一组。 |
| 20260926120000_purge_decommissioned_haichuanghui_agents.sql | 精确名字/skill selectors 命中后，跨 run_id/produced_by_run_id/agent_id/skill_id 关联表删除，并临时 DISABLE TRIGGER ALL；核对命中、依赖、权限和触发器恢复。聊天表不在其直接清理目标，但不能由此推断所有历史产物仍保留。 |
| 20260926130000_kg_i4270_age_edge_dedupe.sql | DO 块实际对已有 org 图调用去重，删除端点与 properties 完全相同的重复边；需图/对象/多重集守恒与可恢复证据。 |
| 20260929150000_dh_portrait_avatars.sql、20260929160000_agent_tags.sql、20260930121000_ag07_official_role_delegation.sql、20260930124000_ag06_official_escalation_rules.sql、20260930141000_rp_b2_official_role_pack_1_5_0.sql | 条件回填官方 Agent/版本的头像、tags 或策略，部分临时禁用 immutable trigger；确认自定义值不被覆盖、实际权限和 trigger 终态。 |

表中是源码确认的风险项，不代表目前全部 pending。其余完整清单仍需按 fresh pending 集合逐项审查；DROP POLICY/触发器里的 TRUNCATE 禁止事件/函数定义内未来 DELETE，不能一律算执行清库。

默认保留三库中的组织/账号、项目与成员、聊天、Agent/Skill/版本、run/checkpoint/memory 和相关对象文件；稳定密钥、模型/GitHub/ASR profile、许可证和运行配置不轮换。需要用户明确决定：退役 research/Agent/Skill/run 数据是否允许删除；哪些试用数据可放弃。实际数量、Redis 是否含需恢复的持久状态、OSS producer/对象闭包仍未知，不能声明空库或可丢弃。

## 最小路径、并行与硬门

1. 只读冻结输入：恢复既有只读访问后收集 fresh ledger、baseline runtime/digests、配置连续性、数据影响数量与依赖。权限不足就在原入口停止，不改权限、不借别的角色绕过。产出 exact pending/checksum/plan；受影响计数不是备份。
2. 可并行准备：复用已验证完整 source bundle 和国内 export；核对实际镜像缓存/registry digest，补齐本次受影响镜像及 manifest/seal。生产仅运行四应用镜像，release schema 六项仍需身份闭包，不能因为列有 postgres/redis 就重建托管数据库。另一条支路准备备份恢复与精确审批包，不等待通用平台完善。
3. 停机前验证：用已存在且获准的隔离目标验证实际备份格式、三库恢复、对象内容、迁移身份/权限和核心流程；没有合适目标时停在环境/数据访问决策，不新建资源。历史 CMS 可验证恢复能力，不当当前 rollback 数据。
4. 获批维护：同一锁下停全 writer/GC/后台任务并排空；采集当前三库、catalog/角色/序列/行证据和引用对象。持续同 epoch 停写，用当前备份重验实际隔离恢复与 9b 六流程，再放行 exact 生产迁移。恢复或比较失败保持封锁，不能把 JSON passed 或 fixture 当生产证据。
5. 原生产替换：检查实际迁移 completion/ledger/版本、sealed 只读诊断和配置后，再按单独批准的顺序恢复可能写入的 API/Agent 等；先记 resume-intent。现有旧 preactivate 会启动 bootstrap，不能作为 held 只读消费者，缺能力继续拒绝。
6. 公网核心 smoke：运行体/镜像 exact identity、健康、真实登录、hello 持久化与 streaming/刷新、ASR、反馈关联、Skill/Tool、PDF 字节和可读性。只在这些与现有正式机制要求全部满足后更新正式可用记录/main-cn。

当前消费者/阶段执行器还有源码缺口；本计划不授权以手工命令绕过它们。只修本次必需链路、保留正式验证/审批，不把未来自动化功能纳入首发硬门。

## 精确审批包必须填写的内容

| 动作 | 必须具体化的影响与证据；当前未执行 |
| --- | --- |
| 工具安装 | 经审查/合入的 exact tool SHA、实际所需入口及新旧 hash/mode、锁、备份/CAS 回退；不授予 blanket 安装或权限。国内 export 已完成部分不重复。 |
| 隔离备份恢复验证 | 已存在的目标实例/三库、非生产身份、数据访问/传输范围、私有存储和保留期、对象 namespace、清理归属；不得含未批准资源采购。 |
| 停写和生产 SQL | fresh pending 全清单/plan hash、上述删除命中数量、完整 writer 停止/排空清单、实际备份和已验证恢复路径、预计维护时长/RPO/RTO；不以“未上市”推断无数据。 |
| 恢复 writer 与公开测试 | 明确账号/tenant/测试数据范围、恢复服务顺序、锁保留、resume-intent 和失败保全方案。 |

resume-intent 前，只有当前备份覆盖全部修改面且持续停写被证明时，才可能按批准恢复流程保留迁移前已承诺数据。intent 后视为可能新增写入，失败应停止新增写入并保全数据，前向修复或另批数据保全恢复；旧备份覆盖不是无损回退。

耗时不再给上线倒计时：镜像可与恢复准备并行，停写/当前备份/恢复重验/迁移/恢复 writer/public smoke 必须依序；实际恢复与迁移尚未计时，不能用文件数或历史 pipeline 时长推算停机窗口。

## 独审后恢复输入边界补修

完整 capture JSON 字节 SHA 与 canonical catalog facts SHA 分开绑定和验证，不能填同一个 digest 糊过运输/读回两侧。roles restore 只允许已封锁完整角色集合的 NOLOGIN 重申，不能执行原始 cluster role dump；其它角色属性/成员重建需求会在 capability 阶段拒绝，需具体审查和相应实现/批准。此修复保留封锁，不提供真实恢复完成或 common-epoch 证明。

## 2026-10-03：已证实的 backup-read 权限与运输兼容缺口

只读生产证据见 `cn-release-existing-backup-capability.json`。ECS invocation `t-sh06yy17t0nu134` / command `c-sh06yy17t08un0g`，三库 READ ONLY/ROLLBACK，Success / exit 0 / Dropped 0。RDS DescribeAccounts 返回七个现有账号；唯一现有诊断身份 app_diag_ro 无特权继承、无 BYPASSRLS。实际主库 SELECT 缺 237/238 表、12 个序列，有 212 张 RLS 表；agent 缺 7/7 表、1 个序列；memory 缺 2/2 表。不能用该身份完整 pg_dump。现有系统所有非 diagnostic LOGIN 身份仍属于全 writer 封锁集合；不得把 migration_admin 临时 LOGIN 当作 backup-read。

三库实际会话 TLS=false，DescribeDBInstanceSSL 返回 SSLEnabled=off（RequestId `01A102CA-EE14-5174-8411-5538A9EA42C8`）。实际 provider 属性为 Serverless，官方不支持 SSL；实际生产配置含既有私网例外。现有 retained/session 的 TLS=true 常量是源码兼容缺口，必须复用 authoritative provider/配置/socket 验证接线，不能直接放宽恢复门。

待人类决定的精确权限范围（以下均未执行）：

- 若批准新增专用 `wsx_release_backup_ro`：仅目标 RDS pgm-uf6rg214cp381l49 及三库；不得扩 app_diag_ro。角色无 superuser/createRole/createDb/replication，无 membership/SET ROLE 路径；完整 RLS 归档需要明确批准 BYPASSRLS。仅授 CONNECT、实际用户 schema USAGE、实际表/序列 SELECT；无 INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES、sequence USAGE/UPDATE、schema/database CREATE/TEMP 或 SECURITY DEFINER EXECUTE；不授默认未来对象权限。新凭据仅进入 root 私有备份输入，不进入应用配置。执行前先列 fresh schema/对象授权集合和所有 PUBLIC 继承有效写权限，若无法证明只读就拒绝。临时 LOGIN 的开始/结束、固定 pg_dump 进程/网络/TLS、连接归属与清理必须进入本次封存授权及持锁观察，不能凭账号名字排除 writer。
- 本实例不支持 SSL，不请求或执行开启 SSL、实例转换、应用配置更改或重启。运输兼容修复仅属源码工作，普通 TLS 实例的 verify-full 校验保持；本 Serverless 必须绑定已有配置与 provider/socket 证据。
- 实际恢复/隔离验收目标仍须是已经存在且明确批准的非生产三库和对象范围；本证据不批准购买/创建目标。没有目标时不运行真实恢复、备份数据搬运或测试写入。

这些是已证实的能力/权限决策，不是新增自动化功能。producer 必须等明确选择才可绑定安全身份；candidate writer 源码仍可独立推进，但生产入口不因这份文档变 READY。A 的执行次序及失败保全继续使用 c6c8985d 的状态机。

## TLS 判断更正与收窄的批准包

后续实际 DescribeDBInstanceAttribute 确认该实例为 Serverless，官方 SSL 文档明确不支持；17:44:02 UTC 生产配置也确认既有 serverless-no-tls 例外及仅 192.168.100.40/32 源地址。此前“需批准修复 TLS”的判断已撤回，禁止对该实例发 ModifyDBInstanceSSL。应修复恢复消费者复用既有 authoritative 例外/私网验证的接线，不能放入一个泛化 insecure flag。当前唯一新增安全决策为受控、限时、三库完整读取的专用 backup 角色；精确边界、撤销和证据见 cn-release-9b25-read-access-approval.md。候选 writer 与 A 生产闭包尚未完成。
