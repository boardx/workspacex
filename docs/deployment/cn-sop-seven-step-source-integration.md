# 固定 9b 七步源码整合

范围固定 APP `9b25bfa65662b96c0826fe67506b562ea46aa6d0`、BASE `ba6343199f3c834d6a198f83d0c771614292c82b`、release `2026.10.3-cn.1`。本次只开发、源编译和 mock/本地隔离测试；没有安装正式主机、构建或推送真实镜像、生产 SQL、切换、IAM 修改、模型请求，也没有重启被暂停的 baseline255 replay。

## 七步交付与依赖

| 步骤 | 源码包 | 输入、输出及失败处置 |
| --- | --- | --- |
| 1 freeze | manifest/tag binding、held expected producer/checker | 固定 Git/source 和 tag；expected 来源为三库固定只读 projection、APP 原始 bootstrap/agent templates、独立资格与 completion，不接受 caller passed。三 seed 使用 `targetId + keyValues`。 |
| 2 precheck/install | transaction installer、source invocation、parent invocation | 固定文件映射和独立 root source/runtime pins；安装 review producer 无安装 executor。重复执行不覆盖证据，owned child 未回收则无成功回执。 |
| 3 artifact-build/publish | build-only artifact lane、publisher、native Compose emitter | build-only 不依赖 baseline255。publisher TERM/INT/EXIT 仅终止自己拥有的 child group，等待回收；Compose 复用固定 APP、Zod/lockfile 和已有原生 network/env 合约。 |
| 4 isolation/recovery | retained backup host/observer/capture、qualification | 借用同父进程已有三 control、三 diagnostic，不建立新 admin。采集 draft、原字节输入见证、密文副本与 12 类 parent invocation；缺外部 20 类实际对象/恢复/隔离/旅程 invocation 时拒绝 qualified。 |
| 5 prepare/readiness | stage host/actions、held queries、late template/plan | 固定本地 immutable images、既有 bridge network、Compose `create --no-build --pull never --no-deps`；候选保持 stopped，完整 config/host/mount/network 取证。原生 flat completion 和 retained live ledger 对齐后生成 late candidate plan。 |
| 6 maintenance A-route | schema 2 source factory、persistent source dispatcher、candidate pointer/actor | 复用同一 A-route。先只读重验已有合格 prehold archive；held 后必须 fresh capture/current qualification。持久化 intent 后原子 pointer CAS，停止仍占端口的已暂停旧 API/web，再只恢复候选。SQL intent 后禁止回退旧代码。 |
| 7 browser/CAS/open | candidate canonical/browser、pinned Docker、receipt store、opened evidence | 实际 canonical 8 stages、browser 6 journeys 与真实 owned run IDs。hold clear CAS/readback 后反复观察；失败独立 rehold + candidate reblock，保留原进程和 FD9，禁止重试 resume。 |

## 入口与可信数据

`production_consumers.ts` 只把严格 `schemaVersion: 2` data 输入路由到 `source_production_consumers.ts`。schema 1 的旧 activation capability 硬拒绝保留，不能用 lane boolean 绕过。schema 2 的模块集合由源码中的 `persistentSourceModules` 精确限定；运行时经 root-owned 0700/hash FD 加载，并用 Python `-I` 的闭合 module finder，不使用 `sys.path`、相邻目录或 JSON callback registry。

`maintenance_source_operations.py` 只提供固定动作：capture draft、stage 外部证据、finalize input、qualification/readonly requalification、held readback、stage+seal、canonical、browser、public marker、opened observation。输入固定为 `/etc/workspacex-cn/maintenance-source-inputs/APP/attempt/action.json` 的 root-private/hash 绑定。

实际输出 hash 在采集后才存在，因此 root 可在动作之间独立批准 late data capability；`toolRevision/filesSha256/installedFilesSha256` 和 dispatcher source pin 不允许变化，每个动作内部 profile 原字节必须稳定。该数据批准属于未来单项生产审查，不由 producer 自动生成。重复 mutation/失去回执后禁止自动重放；marker/observation 只读动作允许重复。

`currentEpochQualification` 与 `preholdEpochQualification` 是独立 schema 2 root capability。prehold CLI 仅 readonly `verify_existing_qualification`，不得发布或替代当前 held capture；当前发布仍为 O_EXCL、0600、fsync。源码 0700、Python 运行时 0755 由独立 root profile pins 认可，普通 attempt 证据仍为 0600。证据中的 private code copy 不能自授权。

completion 统一落盘现有 21 字段 `validated-production-migration-completion` native witness；migration transport、A-route、stage producer、pointer adapter 与 retained candidate 都消费同一格式并重验真实 ledger。旧 wrapper 不作为候选资格。

## 幂等、失败与恢复

每个 producer 使用固定 attempt 路径与 create-once publication；同字节只读重验和明确允许的只读观测可以重复。未知写状态保留原 actor、helpers、journal 与 FD9。持久化 SQL intent 后只记录数据库恢复/写状态 reconciliation，不能继续 baseline resume。生产恢复仍要求独立批准的 recovery plan，不因本地 mock 成功自动获得执行权限。

## 冻结与剩余真实输入

前 1–3 步原冻结 inventory/tar 保持不变。最终整合版本的 FILES 为 128 source、90 installed targets、38 source-only；它包含新增 4–7 模块，不表示现有主机已经拥有这些文件。最终 source commit 与逐项 Git bytes/SHA256 会另冻于独立 closure，不能以 dirty tree 或 latest 替代。

真实主机仍需新鲜 90-target inventory、旧文件原字节/metadata 和恢复载荷、root profile 提案及 main ancestry，才能生成 installer COMPLETE review。已有 Mac read-only 55-target inventory 不能当作新增目标的事实。`postgres-age` 仓库缺失仍待独立授权；不能以 pgvector 替代 AGE 应用镜像。baseline255 已暂停且无合格替代，prehold 会如实拒绝缺失 archive；不得自行恢复 replay。真实 32-kind epoch/source policy、provider receipts、对象版本与隔离/旅程证据仍待实际批准和执行。

本地测试与截图只证明源码/mock 行为，不是业务浏览器验收或生产可用性证明。Library 已取得官方 upload session，但实际 signed URL PUT 传输返回 Forbidden、尚未 finalize；未产生可交付的 library_file_id，保存本地原日志与页面截图。
