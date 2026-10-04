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
