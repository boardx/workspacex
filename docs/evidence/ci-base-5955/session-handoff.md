# #5955 完整 base 诊断交接

## 当前已验证

- local-runtime 清单修复：PR #5956，历史验证证据见 [local-runtime-env-parity-5953.md](https://github.com/boardx/workspacex/blob/dcabbfcdd5d909de99d5049dce5b2613a1bb1e5f/docs/evidence/local-runtime-env-parity-5953.md)。
- 画像竞态修复：PR #5958，历史验证证据见 [persona-poll-race-5954.md](https://github.com/boardx/workspacex/blob/10d2269abf35c1816d7daa3aa713a8264a98a347/docs/evidence/persona-poll-race-5954.md)。三次真实 CI 旅程通过，不代表完整 chat-read 已重跑。
- 日志改进：PR #5957，历史验证证据见 [ci-base-log-retention-5955.md](../ci-base-log-retention-5955.md)。不跳过测试，不改原失败退出码或超时预算。

## 本轮改动

完整 base 的 Turbo 日志改为 stream；执行结束或步骤超时后收集 apps / packages 下的 `.turbo/turbo-test.log`，复制到现有 artifact 的非隐藏 `task-logs` 目录。相关反证与既有门控 18 项通过。

复用 e435。所有正式 PR 显式 base=develop；不要因旧文档默认 main 而改回 main。临时验证分支 `codex/validate-persona-5954`、`codex/validate-ci-base-5953-5955` 不用于产品 PR。

## 仍损坏或未验证

完整 base [40522651876](https://github.com/boardx/workspacex/actions/runs/40522651876) 在本记录写入时仍在执行，不能把 PR 检查通过当成完整回归通过。旧运行 80 分钟超时，尚无证据把它归因到某条 API 测试或端口错配。

整个 job 超时或 runner 丢失时，后续收集仍无法保证执行。三个 PR 的状态与是否合并需读 GitHub 当前值，不能根据本记录推断已集成。

## 下一步最佳动作

```bash
gh run view 40522651876 --repo boardx/workspacex --json status,conclusion,jobs
gh run download 40522651876 --repo boardx/workspacex --name phase-01-e2e-full-evidence-40522651876 --dir /tmp/wsx-base-40522651876-artifacts
gh pr checks 5956 --repo boardx/workspacex
gh pr checks 5957 --repo boardx/workspacex
gh pr checks 5958 --repo boardx/workspacex
```

完成后先读 artifact 的 `evidence/ci/e2e.log` 和 `evidence/ci/task-logs`，按实际断言或最后执行位置分诊；保留测试覆盖，不盲目重跑整套或提高预算。若监控命令只报网络连接失败，重新查询 run 结论，不能把监控退出码当成 CI 结论。

本地无待保留的自有 Docker 栈。不要对其它项目容器执行清理，也不要新建同会话 worktree。若需修复，先 fetch main / develop，再按用户要求以最新 develop 建独立分支。
