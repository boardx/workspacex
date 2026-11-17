# S2 原始异常离线取证（零新增模型调用）

本次限定取证已结束。原 S2 的历史根因仍未证实：原始 native run 和精确 `__error__` 检查点都只保留 `APIConnectionError`，没有可直接关联该次请求的证书异常链。后续重构启动环境的 HEAD 证书失败及修复后 HTTP 连通结果，不能反推原 run 的直接根因。S2 仍为失败，供应商消费与结算仍未知。

```mermaid
flowchart LR
  A[核对原备份与限定范围] --> B[先查 debug recorder]
  B --> C[限定四张 native 表]
  C --> D[冻结结论与未知边界]
  classDef done fill:#ddd6fe,stroke:#7c3aed,color:#111;
  class A,B,C,D done;
```

范围为 local run `40539aa6-2732-4661-9665-913013af806d`，remote run `e8a86490-dd67-4920-adb7-b7761c60e067`、remote thread `a82e1859-fb9b-47f5-86c2-25d7ce3d3dc7`。只读源是原 14:33:36.845 私有诊断备份，dump SHA-256 `44dce740c3e27db191bcebd5e92723ad5d221a485c75020a2040fb06fc73d653`；没有恢复该含 pending 记录的数据库。

| 原始来源 | 实际结果 | 结论边界 |
| --- | --- | --- |
| `debug_events` / `error_logs` | UTC 14:20–14:21，按实际 run/thread 与 trace 关联得到 53 条元数据记录（52 HTTP、1 error）。直接错误 trace `72dc8149-d56d-432e-9e90-d6a2ace4273c` 的错误日志及对应 HTTP 行均无底层 cause/SSL 标记。 | 只证实外层 `MODEL_CALL_FAILED`；记录数量不是 53 次失败。HTTP 行 `org_ref=null`，依据直接 run 错误日志的同一 trace 关联，并非宣称其自带租户授权证明。 |
| `wsx_agent_runs` | 精确 remote run 为 `error`；错误字段仅 `APIConnectionError`。 | 未读取 request/prompt；未保存根因链。 |
| `wsx_agent_events` | 精确 run 的 event 元数据为 `updates` 8 条、`metadata` 1 条，没有 `error` 行。 | 非 error 的 data 未读取；不把没有 error 行解释为没有发生错误。 |
| `checkpoint_writes` | 精确 remote thread 的 `channel=__error__` 为 41 字节 msgpack；只含安全 primitive，完整遍历得到 `APIConnectionError`，无 cause/errno/verify_code/SSL 或 opaque ExtType。 | 原异常底层原因未留在该错误通道。`ConnectionError` 子串不被另算一个异常类型。 |
| `checkpoints` | 仅检查同 remote thread 的 10 条 checkpoint ID/metadata；错误通道 checkpoint ID 在其中。 | metadata 未包含 remote run ID；关联强度是精确 remote thread + checkpoint ID。checkpoint 正文与 `checkpoint_blobs` 均未读取。 |

细节见 [debug 安全投影](debug-recorder-safe-projection.json)、[native 安全投影](native-safe-projection.json) 和 [机器结论](conclusion.json)。公开产物不含原始消息、URL、prompt、凭据、任意堆栈或 SQL COPY 正文。原始解码输出仅在 0700 私有目录内以 0600 保存。JSON/msgpack 解析限制 1 MiB、深度 12、节点 4096；ExtType 保持 opaque；未用 pickle、JsonPlus 构造、eval 或 exec。

两轮有效解码均使用已缓存 PostgreSQL 工具镜像，`--pull=never --network none --read-only --rm`，内存 128 MiB、CPU 1、pids 64，drop ALL capabilities、no-new-privileges，无 host volume 或发布端口。dump 仅通过 stdin 进入 `pg_restore --data-only --schema public --table … --file=-`；仅输出 SQL 文本，未连接数据库、未执行 SQL。第一次 debug 工具因遗漏 Docker stdin attachment 退出 1、输出 0 字节，已保留 [失败回执](decode-safe-receipt.json)；修正后的 [debug 回执](decode-safe-receipt-attempt02.json) 与 [native 回执](native-decode-safe-receipt.json) 均退出 0，实际 own container 留存 0。本次没有外部请求、模型调用或财务写入；没有继续扩表。

费用状态仍引用原安全账目，而非由这次离线异常分析推算：最近一次细项读取为 14:31:55.872，诊断备份创建于 14:33:36.845，14:38:14.476 完整财务备份与当时 live 全行一致；14:40:26.196 记录正常资源清理。该次新任务有 2 条 failed physical/usage，`total_source=unknown`，prompt/completion 为 NULL；存储 total=0 不能证明实际消费为零。两条 credit 仍 pending，reserved 分别 3412/5217 hundredths，held 与 remainingHeld 均为 8629；没有结算、退款或供应商账单证明。旧两份预算哈希保留，新 S2 的唯一预算槽已占用。该诊断备份不是 zero-outstanding 恢复点，也未作恢复验证。

原账与收尾来源：[费用细项](../../a1/s2-supplement-20261116/native-failure-details-accounting.json)、[私有诊断清单](../../a1/s2-supplement-20261116/post-failure-private-diagnostic-backup.json)、[备份完整比对](../../a1/s2-supplement-20261116/post-failure-backup-complete-verification.json)、[原栈清理](../../a1/s2-supplement-20261116/final-cleanup.json)。后续环境探测独立保留：[旧网络契约 HEAD](../../a1/s2-supplement-20261116/one-head-old-network-contract.json)、[修复后 HEAD](../../a1/s2-supplement-20261116/one-head-fixed-network-contract.json)。这些探测不改变原 S2 失败事实、费用未知状态或原应用日志。
