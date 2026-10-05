# Retained epoch acquisition 边界与缺口

新增 `retained_epoch_acquisition.py` + `test_retained_epoch_acquisition.py`。这是 source-owned retained 协议边界与已有 writer actor 的 blocked observation producer，**不是完整 backup acquisition**。`acquire()` 在调用任何 backup / SQL / spawn 之前明确失败关闭，不输出伪造的 owned-child-join / credential-cleanup 成功收据。

## 复用边界与 blocker

已读并复用 `cn_backup_package.validate/compile_role_sql/dump_command/encrypt_command`、`cn_backup_channel.Cursor/query_table/mutation_table`、writer fence 六个 retained channel、既有 actor `hold/observe/assert_blocked` 与 held epoch collection consumer。

无法直接复用 BackupLease.run 的现有 BackupHost：

1. verify_inputs/open_channels 会新建三条 migration_admin；
2. export_owned_ciphertext 的 fork observer 会再开 BackupChannel；
3. cleanup watchdog 也要求独立 admin，不能作为当前 hold 六 session 的 retained 操作；
4. 现有 control helper 的 diagnostic 只允许 roles/sessions，control execute 不返回查询 rows，不能满足 fixed backup catalog / scope / permission capture；
5. cn_backup_stream.bounded_observe 在 fork child 内执行 callback，直接共用 retained channel 的 stdin/stdout 会破坏 sequence 协议；不能把继承的 channel 对象放入 observer callback。

因此缺少共享 helper 的 **retained fixed-backup query/row/mutation 协议**、**parent-owned backend observer relay**、**retained cleanup** 和**实际对象/隔离恢复 acquisition**。本包不改共享 helper，不绕过其 authority。

## 输入输出 / 幂等

RetainedEpochAcquisition 输入现有 approved backup plan、approved host plan、已存在 writer fence actor、固定 epoch binding、`runtime_sessions={control:{三库binding},diagnostic:{三库binding}}`。验证 fixed APP/BASE/tool/host/generation、六 session 真实对象 binding、不同 PID/start 与固定 mutation table。没有 channel factory，不打开或关闭任何 retained session。

`blocked_observation(phase, root)` 只通过现有 actor 实际 observe + assert_blocked，产生当前 phase held/drained hash refs；复用 O_EXCL0600fsync rawhash writer。它可以写 source-owned before/after blocked observation，不表示后续 backup 已执行。该方法不会 resume 或 clear hold。

`fixed_recipe()` 给出既有 compiler 的 fixed queries / mutations、只读 pg_dump argv、CMS argv 及 blocker，ready=false；recipe 是执行配方，不是成功收据。

RetainedBackupChannel 是 explicit future protocol adapter，只有现有 channel 已经提供准确 `retained_backup_protocol` 时可构造：protocol 包含 kind / identity / toolRevision / database / query-table hash / mutation-table hash。协议 operation 为 `retained-fixed-backup`，只允许既有 Cursor 编译后的固定 query/mutation，不接受 arbitrary SQL、连接 factory、重连或 caller-controlled query table。当前 helper 没有这项 capability，构造立即拒绝。

`collect_complete_refs` 复用已有 held collection consumer，仍输出 ready=false / qualified=false / prepared=false；不能从 recipe 或 callback 制造 qualification。

## 失败 / 回滚 / 证据

缺 retained channel、binding 漂移、未安装协议、任意 SQL 都失败关闭。未运行 acquisition，无生产回滚；保留既有 held 状态。observer / cleanup 协议未闭合之前，不能调用 BackupLease 也不能产生 cleanup 成功 refs。

本地 mock 验证：

```bash
python3 -m unittest discover -s .harness/scripts/vm -p test_retained_epoch_acquisition.py -v
```

2026-10-04：7 tests exit 0，覆盖 unsupported protocol 无新 admin spawn、acquisition 在 BackupLease 前阻断、fixed recipe、六 session 缺失/漂移、source actor blocked refs、arbitrary SQL 拒绝。没有真实 SQL、备份、replay、Docker 或生产操作。

## 独立 source-owned helper extension（2026-10-04 追加）

`retained_backup_helper.cjs.initializeRetained(existingControl, hostRef, {readJson,readBytes})` 复用 BackupConnection 的实际 protected host profile、role/public approvals、installed fixed query table、deadline、SCRAM 与 fixed handle。仅将其 connect 边界转换为既有 control session 的身份和 authoritative transport 校验；Client factory 为硬失败，不调用 connect 或 close。需要 existingControl 的 mode=control、migration_admin、实际 admin capabilities、client/identity/transportLibrary。

初始化额外校验安装的 backup_connection.cjs pin，hostRef 必须为 root profile.backupHostPlan exact ref，queryTable 必须为 installedFilesSha256 pin。请求无法提供 table 或 SQL。返回 protocol/hash、binding、dispatch(protocol, request)，允许现有 query/mutation IDs 和 verify-backup-transport。query 必须 BEGIN READ ONLY / fixed query / ROLLBACK；失败只读 transaction 自动 rollback、脱敏固定失败，登录复用既有 SCRAM compiler，密码仅 request stdin。extension 不改变 retained session lifetime。

`retained_backend_observer.py` 用 parent-owner PID 限制已存在 RetainedBackupChannel；固定 backup-sessions query 返回映射到现有 BackupBackendCollector 的 /proc、Docker、actual backend、peer、TLS source authority 校验。明确拒绝 fork child 共用 channel，不创建 admin channel。

Root 唯一整合 writer 仍需把该 module 放入 trusted runtime manifest 并接 control request protocol，保留实际 control capabilities；stream 必须添加 parent-owned observer relay，不能调用现有 cn_backup_stream.bounded_observe 的 fork callback来使用该 observer。acquire 入口仍失败关闭，直到这些 wiring、retained cleanup 和对象/恢复 acquisition 全部真实闭合。

验证追加：纯 Node 8 tests exit0（profile/table/library/role/public approval pin、无新Client、fixed query、显式只读、SCRAM、失败rollback脱敏）；Python observer 5 tests exit0（owner进程、fixed query/rollback、坏rows回滚、session漂移、现有collector映射）；retained acquisition 7 tests回归 exit0。全部 mock，无实际 SQL/备份/生产执行。

## Parent-owned direct relay 与失败后 retained cleanup

新增 `SourceOwnedParentObservation`，只接受 exact RetainedBackendObserver 类并绑定 fixed database / container ID / actual backend PID / application name、源码编译 dump argv、实际 Docker helper binary hash、owner PID、monotonic deadline。producer PID 的实际 /proc argv/exe/start 前后核验；collector 必须返回绑定的 actual backend proof，不能返回 boolean 替代事实。每次成功 iteration 保存独立 O_EXCL 私有 proof，含 owned helper PID/hash/time、actual backend proof/hash，并返回 True；deadline 后 proof 不产生成功结果。

每个 retained SQL 调用限 min(10 seconds, remaining deadline)；source authority 的 compiled context/Docker/pgdump/peer 方法必须接受 `timeout_seconds` 并实际遵守预算。不支持 bounded 参数的旧 adapter 直接失败，不作无限时 fallback。source-owned stream wiring 必须 exact type gate 并在 parent 直接调用该 class，不能放进 legacy fork callback或 plan callback registry。

helper 失败后 sticky cleanup：先对既有 client ROLLBACK 并确认身份，只有回滚确定成功才允许 retained cleanup。强制 cleanupOnly，清 pending privilege mutation；之后永久只允许 close/revoke/begin/commit/rollback。新 BEGIN → CLOSE/REVOKE → COMMIT transaction 必须独立完成，不能 commit 失败前的 grant/login transaction；失去 rollback 响应时不授予 cleanup 通行。profile/host/table/library/approvals/protocol 每次重验。任何再次 login/create/grant/query/verify 被拒绝。

更新验证：helper 10 Node tests、observer/relay 12 Python tests、retained acquisition 7 Python tests exit0。新增覆盖父进程/direct iteration、late proof、foreign observer、boolean冒充、每SQLdeadline/unbounded source拒绝、失败后的cleanup成功且再login永禁、lostrollback拒绝。无实际生产执行。

## 最小真实 retained host（源码开发完成，未生产执行）

新增 `retained_backup_host.py.RetainedBackupHost(reference, retained_actor, read, clock)`，复用既有 BackupHost 的 protected host/profile、审批、custody、密钥canary、缓存 PG16/TOC、scope/permissions源实现。open_channels 仅对已存在三条 control 执行 source-owned bind_retained_backup，close_channels 不关闭维护 actor 客户端。

具体 RetainedBackupHostObserverAuthority 通过 fixed Docker owner label / name / exact image-network /实际 ID / top唯一 pg_dump PID查找和注册。relay deferred 只接受该 exact authority；看不到 backend 返回 None，不算成功；第一次实际 backend 出现后固定 cid/PID，不采信 plan 或 callback。export 依赖 protected host `dockerClientSha256`；缺少实际 pin、profile/control extension、scope/TOC/custody事实时失败关闭。共享 stream 由整合 writer 使用 exact SourceOwnedParentObservation 类型自动路由 parent observer，未提供可被 JSON bool 绕过的 flag。

源 parent watchdog 是同进程 thread；host全 transaction RLock 防 interleave，deadline 到达即 sticky closing，拒绝新create/grant/login。cleanup 只走 retained compiled BEGIN/CLOSE/REVOKE/COMMIT，source readback验证role/session/permissions、owned containers、recipient key留存。没有新admin、fork、旧 BackupWatchdog。失败stream缺joined证明时拒绝宣称cleanup成功；仍尽力close/revoke并保留未知 outcome。

验证新增 host 7 tests，observer/relay 14 tests，helper 10 tests exit0：existing-only negotiation/close、whole transaction mutex、closingsticky、fixed cleanup、parent watchdog、missing/duplicate actualbackend、deferred source-only、mutationtransaction固定identity/permission查询。循环imports实际import通过；没有执行实际云构建、SQL、backup、replay或生产安装。本包仍不授予 held-epoch资格，实际运行与完整对象/恢复证据另审。

## 分阶段 source-owned capture 与最终外部 policy

新增 `retained_epoch_capture.py` / `test_retained_epoch_capture.py`。

1. `CaptureRetainedBackupHost` 继承实际 retained host，只在原 verify_effective_permissions source 边界保存实际 permission facts。`RetainedEpochCapture.run_production()` 调用实际 BackupLease.run，记录既有 actor 的 held/drained 前后只读观察、actual后台/密文/permission refs、source writer journal、cleanup证明、实际 producer PID/start/executable/source hash/namespaces。结果为 O_EXCL capture-draft，ready=false / qualified=false。未知 cleanup / children join、缺后台事实均没有成功 draft。
2. `stage_external_evidence(draftRef, external, protectedReader)` 必须获得**实际外部 producer**的完整 catalog/cluster-role/ACL/sequence-values/server-version refs、对象 before/after/restored raw byte/version refs、recovery evidence/manifest、隔离八阶段 proof 和六旅程 raw body refs。调用既有 isolation与held collection consumers验证 rawrefs，生成 qualification-input-draft。不会把 backup permission catalog冒充完整恢复catalog/sequence状态，也不会把 cn_restore_objects 的 read/hash audit冒充 copy成功。对象copy或隔离replay不可用时，此步骤拒绝；不能用 Passed=true flags替代。baseline replay未启动。
3. `finalize(stagedRef, protectedReader, externallyApprovedSourcePolicyRef)` 只读外部最终protected sourcePolicy，并要求其中每个 invocation output 的 rawref/hash与已实际生成的 capture/collection/对象/隔离/旅程输出一致；然后 O_EXCL 写 qualification-input.json。源代码不生成或批准 policy、producer范围或 invocation许可，不直接调用 qualification、不输出 qualified=true。最终sourcepolicy在实际输出已存在之后批准，避免 capture前未知hash的循环。

`RetainedEpochAcquisition` 新增 optional source-only approved_host_reference；只有显式提供protectedref和journal时，acquire构造实际 RetainedBackupHost并复验完整approved plan，然后调用既有BackupLease。缺ref/journal保持失败关闭，不从 plan callback registry创建executor。

capture 7 tests exit0：actual lease源码路径mock调用、未知cleanup/后台缺失拒、source host类型门、flags替代外部rawrefs拒、最终外部policy/outputhash精确匹配与漂移拒。helper追加 mutation BEGIN内部fixedpermissionquery反例，11 Node tests全绿。未运行真实 backup/SQL/replay；源码资格仍需外部实际facts和最终policy批准。

## 固定入口路径与 parent invocation recorder 接口

capture唯一根为 `/etc/workspacex-cn/maintenance-evidence/{sourceRevision}/{attemptId}`，源码方法每次重验；中间入口固定 capture-draft.json / qualification-input-draft.json，finalize仅写 qualification-input.json。input.outputRoot固定同根 qualified-current-epoch，与实际 qualifier CLI 门一致。没有 production路径豁免；测试只在本地代码层mock根常量。

既有 source_invocation_receipt 的两个纯consumer child worker不能记录retained生产capture：六条实际session仅在原owner parent。新增 recorder需要执行一次source-owned run_production，然后读取 `actual_production_outputs()`；该接口仅在本source实例成功运行后返回固定12种输出及源运行时间：before-held-drained、after-held-drained、held-interval-journal、每三库permissions / dump / backend。permission/dump/backend记录的 source区间始于before观察完成后、终于after观察开始前；producer完整完成时间另存 captureCompletedAt。ctor同时绑定实际backup providerBindingSha256。

全部32kind中另外20kind必须各自真实source producer记账：collection（现有纯consumerworker可用）、recovery-evidence/recovery-manifest、objects:before/after/restored、stage:restore/before/migrate/canonical-setup/canvas-audit/after/snapshot/recovery-verify、journey:login/hello/asr/githubFeedbackRead/skillTool/pdfDownload。parent recorder绝不能用本capture的draft进程元数据为这些外部refs冒造执行，也不把未qualified collection变成qualified。

recorder实际记录必须含当前parent PID/start/ns/exe/sourcepins、固定binding/provider、protected host计划和retained actor/runtime输入rawrefs、actual output ref/hash、actual times和joined状态，并由最终外部policy批准。capture.host.reference绑定rootprofile backupHostPlan；host-plan内各provider/transport权威原refs受其rawhash保护；actual actor retained graph由sealed root context提供，不从计划callbackregistry创建。draft producerProcess是源实测草稿，不是approved invocation或qualification。

路径/窗口/source12kind输出验证：capture 10 tests exit0，包括错误attempt/任意根、实际qualifier入口拓扑、跨根staged拒、dump/permission/backend时间都在held窗口；无真实生产采集。

### Attempt-scoped actual input witnesses

`RetainedEpochCapture.snapshot_inputs()` runs before the held observations and
backup lease. It rereads the approved host plan and root profile, the actual sealed
actor runtime and its original source plan, and all six existing retained session
bindings. The original raw source hash, canonical runtime/source hashes, seal raw
hash and root-profile exact host reference must agree. The originals are reread
before the snapshot is accepted. Host plan, root profile, source actor plan and
runtime seal are saved as exact raw JSON bytes with exclusive 0600 creation and
fsync; runtime plan, provider transport facts and their bindings form additional
data witnesses. These seven attempt-scoped references are returned through
`actual_input_references()` and stored in `capture-draft.inputReferences`.
They confer no approval: installed producer pins and final external source policy
remain independently required. Original paths inside the bindings witness are
historical data, not qualification input references to dereference.

Verified ciphertext is copied as encrypted bytes into the same attempt scope
with the original size and SHA256, private exclusive creation, original recheck
and fsync. Partial outputs or repeated capture paths require reconciliation;
there is no overwrite. No plaintext credential acquisition is added. External
object recovery, isolated restore, six journeys and final approval are still
required; these changes do not run SQL, backup, replay or qualification in tests.
