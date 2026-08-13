# 会话交接 — Sprint 01/06

## 当前已验证
- F174 产品行为定向验证通过：configured provider 9/9、personal gateway 7/7。
- 新增反证在修复前稳定得到 `upstream did not settle the final segment in time`，修复后无 error。

## 本轮改动
- `ConfiguredRealtimeAsrProvider.finish()` 保留停止前已经收到 final 的会话事实；stop 空尾不再误判 FINISH_TIMEOUT。
- Provider 测试新增“先收到 final，停止 commit 没有新尾段”的真实协议场景。
- 新建 Sprint 01/06 与 F174 harness 记录。

## 仍损坏或未验证
- `pnpm --filter api run typecheck` 在未修改的 `packages/fabric-markdown` 报缺 DOM/Canvas 类型；因此 F174 保持 in_progress，不伪标 passing。
- harness sync 因本机无 `gh` CLI 没有自动创建 issue，需要从 GitHub UI 或恢复 CLI 后补投影。

## 下一步最佳动作
- 补 GitHub issue/PR 后完成 review；基线 typecheck 恢复后重跑 `pnpm harness verify --sprint 01/06 --feature F174`。
- 不要改写 F173 passing 状态；本修复仅属于 F174。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/06`
- 调试:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/recording/configured-realtime-asr-provider.test.ts`
