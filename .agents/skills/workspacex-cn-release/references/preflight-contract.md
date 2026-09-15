# 聚合预检机器契约

`validate_preflight.py` 接受一个 UTF-8 JSON 对象。输入不含密钥；`detail` 只用稳定错误码和脱敏摘要。

```json
{
  "schemaVersion": 1,
  "attemptId": "01K...",
  "sourceSha": "40-hex",
  "baselineSha": "40-hex",
  "release": "2026.9.15-cn.1",
  "buildStarted": false,
  "checks": {
    "source.exact_sha": {"status":"passed","evidenceSha256":"64-hex"},
    "source.complete_artifact": {"status":"passed","evidenceSha256":"64-hex","metadata":{"complete":true,"offline":true}},
    "source.offline_plan_b": {"status":"passed","evidenceSha256":"64-hex","metadata":{"githubRequired":false}},
    "toolchain.package_manager": {"status":"passed","evidenceSha256":"64-hex","metadata":{"declared":"pnpm@9.15.0","actual":"9.15.0"}},
    "toolchain.pnpm_cli_protocol": {"status":"passed","evidenceSha256":"64-hex","metadata":{"doubleDashForwardingPassed":true}},
    "toolchain.stdout_protocol": {"status":"passed","evidenceSha256":"64-hex","metadata":{"exactlyOneMachineRecord":true}},
    "registry.acr_auth": {"status":"passed","evidenceSha256":"64-hex","metadata":{"authenticatedProbe":true,"remainingTtlSeconds":3600}},
    "runtime.release_lock": {"status":"passed","evidenceSha256":"64-hex","metadata":{"heldByAttempt":true}},
    "runtime.no_orphans": {"status":"passed","evidenceSha256":"64-hex","metadata":{"count":0}},
    "config.release_manifest": {"status":"passed","evidenceSha256":"64-hex","metadata":{"sourceSha":"40-hex","release":"2026.9.15-cn.1"}},
    "config.durable_profiles": {"status":"passed","evidenceSha256":"64-hex"},
    "config.secret_serialization": {"status":"passed","evidenceSha256":"64-hex","metadata":{"checkedRefs":7,"invalidKeys":[]}},
    "cloud.managed_data_permissions": {"status":"passed","evidenceSha256":"64-hex","metadata":{"liveDescribePassed":true,"temporaryPolicyExpires":true,"cleanupRegistered":true}},
    "database.drain_read_access": {"status":"passed","evidenceSha256":"64-hex","metadata":{"role":"app_diag_ro","canReadAgentRuns":true}},
    "bootstrap.compatibility": {"status":"passed","evidenceSha256":"64-hex","metadata":{"readOnlyTransaction":true,"productionWriteStatements":0,"imageEntrypoint":true,"inputContract":true,"schemaContract":true,"permissionContract":true,"stateClass":"matching-existing","agentSeedContract":true,"exactlyOneMachineRecord":true}},
    "secrets.stable_continuity": {"status":"passed","evidenceSha256":"64-hex","metadata":{"requiredCount":12,"matchedCount":12,"missingKeyIds":[],"rotatedKeyIds":[],"stableDirectory":true,"baselineReadable":true,"candidateWillReuse":true,"noMutation":true}},
    "build.affected_services": {"status":"passed","evidenceSha256":"64-hex","metadata":{"services":["api","web"]}},
    "deploy.trusted_copy": {"status":"passed","evidenceSha256":"64-hex"},
    "network.dependencies": {"status":"passed","evidenceSha256":"64-hex"}
  }
}
```

每项检查都必须出现。`status` 只能是 `passed` 或 `failed`；失败项携带非空 `code`。未知检查会被拒绝，防止拼写错误把必要检查变成“额外信息”。证据 hash 是对脱敏后的原始 probe 输出计算的 SHA-256。

成功和失败都只向 stdout 写一行：

```text
CN_RELEASE_PREFLIGHT_JSON={...}
```

诊断写 stderr。成功退出 0；blocker 或 schema 错误退出 1/2。调用方解析固定前缀，不能假设 pnpm 或 shell stdout 只有 JSON。
