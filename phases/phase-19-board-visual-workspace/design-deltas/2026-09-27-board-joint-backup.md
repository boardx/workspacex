# R8 Board 联合备份协议（同租户新 Board 恢复）

用户已授权 adhoc 设计/实现；本协议不是通过声明。关联 R8 #4255，主 session 负责真实 PG/FS 验收。

## 复用与范围

复用 ObjectStore（不可变 putOnce/get/head）、FsObjectStore、PgDatabase tenant transaction、现有 Board owner/member 权限、whiteboard_guard_object_root 与 GC advisory fence。系统 starter-backup 封装整个 PG dump，不捕获 Board 正文文件，不能当成本能力。此处是逻辑 Board 恢复点，不替代基础设施 PG 灾备。

manifest v1 覆盖 org、backup ID、捕获时间、Board 名称/归档状态/原生命周期版本、owner/成员角色、标签元数据、原 epoch/seq、完整 canonical Yjs snapshot descriptor 和其中每个 durable image descriptor/asset metadata。正文与图片字节只在 primary/secondary ObjectStore，PG 仅保存这些 metadata、hash/ref、状态与恢复回执。恢复快照完整保留对象 ID 和关系；新 Board 有独立 ID，epoch=1/seq=0，manifest 保留来源 revision。恢复不重放旧客户端 outbox、Undo 历史或历史 checkpoints。

评论正文和幂等响应已迁移到不可变 ObjectStore；PG 仅保留 bodyless thread metadata 和 refs。manifest 包含完整当前评论线程（含 object-deleted 历史状态）及正文 descriptor；捕获先迁移遗留正文，恢复重写 Board 身份但保留线程/评论 ID，blob 正文 map 无 Board ID 可逐 hash 原样复制。恢复不带旧请求幂等响应，防止旧 source 请求成为 target 的有效操作回执。未完成/远程 URL/本地 session image 也拒绝，不生成半可用备份。

## 捕获与发布

1. 验证 principal / UUID，tenant transaction 内确认当前 org membership 和 Board owner，锁 Board；捕获当前 canonical document（read-through 迁移后只引用 manifest）。读取 ACL、标签、所有被 live image 引用的 asset metadata。
2. 同事务创建 preparing backup record；对 snapshot/image 的精确 object keys 建持久 pins。pins 走现有 root writer advisory lock/拒绝 purging/deleted generation。事务提交后才开始复制。源 Board 可继续编辑，备份仅使用已捕获 immutable keys。
3. 顺序读取 primary head+bytes，校验 mime/size/SHA256；写入 secondary 独立命名空间并 read-back 验证。全部成功后最后写 manifest 并验证，PG CAS 标 verified。任何失败标 failed_pending_cleanup；不得释放 pins。进程中断保持 preparing。相同 backup ID 允许验证后重试，不另采样较新 revision。
4. GC root union 与 is_rooted 同时包含 backup pins，覆盖 preparing/verified/failed 状态。第一版不提供自动 pin 清理，保守保留；secondary 保留/加密由运维配置，CLI 强制 primary/secondary 目录隔离。

## 恢复

仅持有备份的原 owner 且仍为组织成员可恢复；若 source Board 还存在，还必须仍为 owner。所有读取/重试/发布再次检查，不依赖备份时权限。拒绝跨 org/backup ID/manifest hash；secondary 所有对象验证和 canonical document 验证通过后才允许发布。

restore request ID 同时用作新 Board ID（只允许不存在或同一请求的完成回执）。开始时在 PG 建 preparing restore receipt，并 pin 预期目标 keys，防止复制中断产生旧 orphan 被 GC。blob-first 写入 primary 的新 Board 命名空间，所有 read-back 成功后，一个 PG transaction 创建 Board、成员（需仍存在组织）、标签绑定、image metadata/refs、snapshot manifest 和 completed receipt。不得写 snapshot/update bytea。源 Board 保持不变；失败不能暴露目标 Board，重试同一请求不重复创建。

第一版标签恢复仅复用仍存在且名称/版本一致的原标签；标签变化显式冲突，避免覆盖整个组织共享 taxonomy。权限/标签变化必须失败，不静默降级。

## 入口与验证

受信运维 CLI 使用应用 DB 角色和显式 actor/org；不使用迁移超级用户，也不公开任意 principal HTTP 路由。main session 执行真实 PG + 两个独立 FS roots：备份后删除 primary 被备份字节，恢复新 Board，fresh connection 重建 Y.Doc/图片 hash/ACL；注入缺失/坏 blob、跨租户、撤权、失败恢复重试，检查 PG bytea NULL 与 GC pins。单元只证明编排，不称灾备已通过。

剩余边界：跨租户恢复、整个 PG 丢失后的目录重建、secondary key rotation/remote OSS、历史审计备份及 pin 生命周期清理需后续版本。此 CLI 依赖已恢复或仍健在的 PG backup metadata，因此不能声称整个站点灾难恢复完成。

## CLI（operator）

在已配置应用 DB 凭据的 shell 中设置 `BOARD_BACKUP_OPERATOR=1`、`BOARD_OBJECT_ROOT`（现有正文目录）、`BOARD_BACKUP_OBJECT_ROOT`（独立、权限0700的备份目录）：

```sh
pnpm --filter api exec tsx scripts/board-backup.ts create --org ORG --actor OWNER --board BOARD_UUID --backup BACKUP_UUID
pnpm --filter api exec tsx scripts/board-backup.ts restore --org ORG --actor OWNER --backup BACKUP_UUID --restore NEW_BOARD_UUID
```

只输出id/hash/revision回执；错误仅reason code，不输出数据库连接串或原文。CLI不运行migration，不替换API标准ObjectStore配置；必须指向同一primary正文目录。

## PG 同时丢失时的组合恢复与双介质演练

复用 `packages/cloud-deploy/src/starter-backup.ts` 的 `backupStarterDatabase` / `restoreStarterDatabase`，不重新实现 pg_dump/pg_restore。顺序必须是 Board secondary 所有 blob 和 manifest verified、PG backup record/pins commit → 启动系统 PG dump → 验证 PG dump SHA256。manifest revision 是精确 Board 恢复点；PG snapshot 可更晚，但必须包含同一 verified record/hash。Preparing record 不可作为成功备份。第一版 pins 永久保留，不允许 GC 自动释放，也没有自动 cleanup 命令。

全 PG 丢失后先用系统 restore 恢复至全新隔离数据库；从其中的组织/身份/权限与 verified backup metadata 建立信任根，再用独立 archive 恢复目标 Board。组织 ID/原 owner 必须完全匹配且 membership 仍有效，不允许通过参数进行跨组织映射。只恢复指定 Board 的正文，不声称同一 PG dump 中其余 Board 的文件也已恢复。

main session 可在本地隔离 PostgreSQL16 栈运行（会调用现有 Docker pg_dump/pg_restore；子 agent 不运行）：

```sh
BOARD_JOINT_DRILL=1 BOARD_DRILL_DIRECTORY=/private/tmp/unique-private-drill \
STARTER_POSTGRES_CONTAINER=EXISTING_ISOLATED_PG_CONTAINER \
BOARD_OBJECT_ROOT=EXISTING_PRIMARY_ROOT \
pnpm --filter api exec tsx scripts/board-joint-recovery-drill.ts ORG OWNER BOARD_UUID
```

沿用 WORKSPACEX_ISOLATION_ID / WORKSPACEX_DB / PGDATABASE / PGHOST 和标准 app/migration credentials。目录必须全新；不允许部署环境、共享 DB 或远程 PG。演练复制 Board 到独立archive，备份PG，用系统入口新建另一个DB恢复dump，在空的target FS目录恢复Board，并由全新应用DB连接读取canonical/hash和PG snapshot NULL。原primary与原DB不删除。report只包含IDs/hash/路径，不含凭据或原文。失败不伪造通过，不自动删新DB（由主session诊断和清理）。这验证真正两个恢复介质，不是仅测试 checkpoint。
