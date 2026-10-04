# Step 4：隔离 baseline / migration / recovery 证据采集

本包只补现有隔离演练的离线证据采集，不启动 replay、SQL、Docker、RDS、恢复或删除资源。baseline 255 的真实 replay 仍由用户暂停，没有 qualified 替代。采集成功仅说明输入证据链内部一致，不能替代真实演练或批准生产维护。

## Backlog 与边界

- 已实现：八阶段 receipt 的完整集合、实际字节 hash、attempt / candidate / isolated target 绑定；三数据库闭合；before / after / canonical proof 复用现有严格验证；恢复 fidelity 与 encrypted snapshot hash 绑定。
- 已实现：既有 serverless no-TLS 权威例外复用 `isolated_rehearsal.validate_binding`，要求同 target / provider creation 的证据，不放宽 TLS 条件。
- 未完成且未执行：暂停中的 baseline 255 真实 replay、实际恢复验证、独立 qualified admission 审核。未来实际执行需要逐项授权，不由本包推断许可。

## 输入 / 输出

入口 `.harness/scripts/vm/isolated_conservation_evidence_producer.py` 读取 stdin JSON：

- `binding`：现有隔离 rehearsal binding，完整 account / region / attempt / target / peer / TLS 信息；目标不得为生产。
- `baselineSha`、`release`：本次固定 `ba6343199f3c834d6a198f83d0c771614292c82b` 和 `2026.10.3-cn.1`；candidate 固定 `9b25bfa65662b96c0826fe67506b562ea46aa6d0`。
- `stageReceipts`：严格八键 `restore`, `before`, `migrate`, `canonical-setup`, `canvas-audit`, `after`, `snapshot`, `recovery-verify`。值为现有 `{path, sha256}` 私有文件引用。默认 reader 复用 root 私有普通文件和可信祖先校验。

输出只包含绑定身份、阶段与嵌套 proof 的 hash、稳定 collection receipt hash。`collectionVerified=true`，但 `qualified=false`, `prepared=false`, `fullReady=false` 始终不变。receipt 不包含凭据、SQL、用户数据、archive 内容或 proof 原文。CLI 任意失败退出 1，仅打印固定脱敏码。

## 幂等 / 失败 / 回滚

相同字节输入产生相同输出；不写文件、不覆盖历史 receipt、不启动子进程。缺阶段、错 SHA、hash 漂移、错 attempt、三库缺失、无恢复 fidelity、snapshot/recovery hash 不一致、凭据字段或 TLS 例外证据失配均失败关闭。失败无需生产回滚，因为不存在生产动作；修复证据后重新采集。外层 writer 若保存输出，应使用已有 exclusive/private receipt 写入规则，不能覆盖旧证据。

## 本地验证与证据

```bash
python3 -m unittest discover -s .harness/scripts/vm -p test_isolated_conservation_evidence_producer.py -v
```

2026-10-04 云端隔离 mock 验证：12 tests，exit 0。覆盖完整链幂等、拒绝 production target、缺阶段、源码/hash/attempt 漂移、三库缺口、恢复只读回滚与 ciphertext 漂移、凭据字段、既有 TLS 例外失配，以及真实 CLI 脱敏非零退出。这些是本地反证测试，不是 baseline / migration / recovery 真实通过的证据。
