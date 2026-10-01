# #4874：实时语音公网握手部署门

## 问题与结果

部署后本地 API/Web 健康不能发现 public voice WebSocket 被误代理。现在既有可信 helper 的 `run_post_restart_smoke` 必须确认匿名 RFC6455 Upgrade 被 HTTP 401 拒绝。非 401 与传输失败阻断部署并调用原有脱敏诊断；不带凭据，connect 2 秒 / total 5 秒，禁用 curlrc、不跟随重定向、不关闭 TLS 校验。

## 验证

- 修改前新增六项反证全部失败：[counterproof](voice-readiness-counterproof.log)。
- 修改后 38/38 通过：[测试日志](voice-readiness-tests.log)，含实际 production Node gateway + 实际 curl 401 成功、移除 gateway 后真实 HTTP 404 失败，既有 root 副本漂移和 Caddy 恢复/回滚回归。
- `bash -n .harness/scripts/vm/deploy-readiness.sh` 与 `git diff --check` 通过。

复跑命令：

```sh
pnpm exec vitest run --config .harness/vitest.config.ts .harness/scripts/vm/deploy-readiness.test.ts .harness/scripts/vm/realtime-voice-route-repair.test.ts .harness/scripts/vm/deploy-trusted-copy-drift.test.ts
```

## 限制

未连接 devapp，未部署，未修改 live Caddy。仍须经过现有 main-only 可信脚本安装流程更新 root 副本。匿名 401 不是供应商通话成功证据；WAF 等前置层也可能返回 401，需已认证浏览器声音/转写测试进一步确认。配置分析见 [诊断说明](VOICE-DIAGNOSTIC.md)；未实施文字密钥回退。
