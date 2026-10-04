# Current held epoch：source-owned 证据封装

## Backlog / 边界

新增 `.harness/scripts/vm/current_held_epoch_evidence_producer.py` 只消费已存在的 source-owned 私有证据，验证绑定并生成不可覆盖 collection。不会建立 hold、停 writer、采集备份、运行 SQL/replay/restore/browser、调用云或清理生产凭据。它不是资格 producer，输出 `ready=false`, `qualified=false`, `prepared=false`。

**仍需 retained/scoped backup transport**：在同一 held generation 内以受限身份实际采集三库、对象版本和恢复证据；持有现有 writer fence 并完成独立前后观察；实际 producer 代码、工具与主机证据需要审核。现有 online backup 仅证明独立 snapshots，不可改名冒充共同 held epoch。baseline 255 replay 继续暂停，fixture 不提供 qualified 替代。

## 输入 / 输出契约

stdin 顶层严格字段：`kind=current-held-epoch-evidence-input`, `identity`, `toolRevision`, `host`, `epoch`, `holdGeneration`, `before`, `after`, `databases`, `objects`, `cleanup`, `isolation`。

identity 复用 writer fence 四字段：固定 APP `9b25bfa65662b96c0826fe67506b562ea46aa6d0` / BASE `ba6343199f3c834d6a198f83d0c771614292c82b`，migration plan hash 与 attempt。host 必须固定现有 ECS `i-uf6ga92ewloganobbln6` 加 bootId。toolRevision 为 exact SHA，epoch 为 64 位 hash，holdGeneration 为 32 位 hex；这些在每一个 envelope 内完全一致，任何漂移失败关闭。

每个 source-owned JSON ref 是现有严格 `{path, sha256}` 私有文件引用。内容严格为 `{identity, toolRevision, host, epoch, holdGeneration, kind, passed, facts}`，`passed=true`。封装校验不能证明 facts 的真实性，真实采集 transport 仍是必需输入。

- before / after：各自 `held` 和 `drained` 两个独立 ref；kind 为 `before-held`, `before-drained`, `after-held`, `after-drained`。facts 要求 held state / allWritersDrained、有限 observedAt；after 晚于全部 before，前后 raw hash 不同、path 不复用。
- databases：严格三库 workspacex / workspacex_agent / workspacex_memory；各含 ciphertext / catalog / roles / acl / sequence / version 六 ref。kind 为 `database-<component>`，facts 包含 database / complete=true / sourceRdsInstanceId=固定生产 RDS。ciphertext facts 另外包含 `{artifact:{path,sha256,bytes}}`，复用 Protected.bind_large 流式验证实际密文文件的私有属性及字节 hash，再次 recheck；不把密文读为 JSON。
- objects：inventory / version / recovery 三 ref，kind 为 `objects-<component>`；facts 要求 complete=true 与相同 objectScopeSha256 / inventorySha256，不允许漏对象范围或版本范围漂移。
- cleanup：ownedChildrenJoined / credentialCleanup 两 ref，kind `cleanup-<component>`，对应 facts 为 true。只有严格 credentialCleanup 布尔可以出现在 credential 命名字段，其他凭据字段全部拒绝。
- isolation：targetInstanceId 必须是非生产 RDS；restoreFidelity 严格三库 ref，kind `isolation-restore-fidelity`，facts 要求 target/database 绑定、dataFidelityVerified/readOnly/rollbackComplete=true、ciphertextSha256 与本 epoch 实际密文 hash 一致。journeys 严格六键 login / hello / asr / githubFeedbackRead / skillTool / pdfDownload，各 kind `isolation-journey-<key>`，目标绑定且对应 facts true。

输出包含绑定身份和经过校验的 evidence refs，ready/qualified/prepared 为 false，remainingTransport 明确上述缺口。CLI 接受唯一 output 绝对路径参数；输出文件由 O_EXCL / O_NOFOLLOW 创建，0600，文件和目录 fsync。stdout 仅打印 output ref 和**保存原始字节** sha256，任何失败 exit 1 并输出固定脱敏错误码。

## 幂等 / 失败 / 回滚

同样输入封装内容确定；已存在的输出拒绝覆盖，重试必须由整合 writer 对旧 raw hash 做独立 reconciliation。缺库/组件/对象/旅程、epoch/tool/host/generation 漂移、online backup kind、production isolation target、密文/恢复 mismatch、cleanup 未 join 均拒绝。没有生产动作，无生产回滚；失败保留历史证据。如果文件写入或 fsync 中断导致路径已存在但结果未知，先独立核验再更换 attempt，不删除重写掩盖未知结果。

## 本地证据

```bash
python3 -m unittest discover -s .harness/scripts/vm -p test_current_held_epoch_evidence_producer.py -v
```

2026-10-04：13 tests exit 0，含在线备份冒充、缺库/对象/旅程、epoch/tool/hash 漂移、cleanup、production target、恢复密文绑定，以及实际 O_EXCL/0600/两次 fsync/保存 raw hash。测试仅用本地 mock refs；映射容器中系统祖先所有者不同，输出测试仅模拟系统祖先 trust，不放宽源码祖先检查。
