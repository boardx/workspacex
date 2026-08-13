# 个人转录历史管理 · 可执行验收契约

## 签核前设计门

```bash
pnpm exec tsx .harness/scripts/validate-fl.ts 01
pnpm exec vitest run .harness/scripts/lib/design-signoff.test.ts
```

F177 在本 delta 为 `pending` 时必须被 design gate 拒绝；人类改为 `confirmed` 后才允许 claim 和运行时代码修改。

## F177 实现门

```bash
pnpm --filter @repo/contracts run test
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/recording/personal-transcription-management.test.ts
pnpm --filter web exec vitest run tests/ui/realtime-transcription-history.test.tsx
pnpm --filter api run typecheck
pnpm --filter web run typecheck
```

## 必须覆盖

- 标签查询只返回当前用户所有真实标签，跨用户标签不可见。
- 修改名称/标签持久化且活动 capture 拒绝。
- 删除个人文档、capture、segment 与 ticket，同时保留不含正文的 usage event。
- UI 不再渲染固定标签；修改和删除成功后同步刷新卡片与筛选项。
- 删除必须确认；取消不调用删除 API；失败不移除卡片。

## 反证

- 临时恢复任一固定标签时 UI 测试必须红。
- 临时让 usage event 随 capture 级联删除时 API 测试必须红。
- 临时跳过活动 capture 检查时 API 测试必须红。
- 临时在打开确认弹窗时立即调用删除接口，UI 测试必须红。
