# 契约路由覆盖棘轮：清理两条已修复豁免

2026-11-17 UTC，`/workspace/aidt-pr-20261117`。

唯一仓库改动：`.harness/state/contract-route-coverage-allowlist.json` 删除 `files:getIngestionRun` 与 `files:uploadArtifact` 两个条目。没有更改扫描器、判据、strict模式、workflow或新增豁免。

实际路由证据：`apps/api/src/interface/controllers/aidt-raw-files.controller.ts` 直接声明 `@Post(files.operations.uploadArtifact.path)` 与 `@Get(files.operations.getIngestionRun.path)`；对应共享契约分别为 `POST /projects/:projectId/artifacts/upload` 与 `GET /ingestion-runs/:ingestionRunId`。棘轮实测确认files束仍在判定范围内，故是补上路由后的stale例外，不是退出范围的dormant例外。

执行环境均先`source /tmp/aidt-pr-env.sh`。

| 验证 | 实际结果 | 日志 |
|---|---|---|
| 删除前 `pnpm exec tsx .harness/scripts/lint-contract-route-coverage.mjs --strict` | exit1；精确报告这2条stale | `/tmp/aidt-pr-contract-route-ratchet-before.log` |
| 删除后相同严格命令 | exit0；名单247条，247条仍为实际缺口，无新增/陈旧/畸形项 | `/tmp/aidt-pr-contract-route-ratchet-after.log` |
| 4个现有coverage/ratchet/gate测试文件 | 72/72通过、4/4文件通过、exit0，3.01秒 | `/tmp/aidt-pr-contract-route-ratchet-tests.log` |
| 该allowlist的 `git diff --check` | exit0 | tool实际回执 |

测试精确命令：

```sh
pnpm exec vitest run --config .harness/vitest.config.ts .harness/scripts/lib/contract-route-coverage.test.ts .harness/scripts/lib/contract-route-coverage-fs.test.ts .harness/scripts/lib/contract-route-ratchet.test.ts .harness/scripts/lint-contract-route-coverage-gate.test.ts --bail=1
```

现有反例检查新增无路由operation、陈旧豁免、扫描不完整以及PR strict接线，不是只核退出0。此次没有资源/数据库/模型调用，没有重复API625测试。
