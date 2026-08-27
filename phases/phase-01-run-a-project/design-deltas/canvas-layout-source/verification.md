# verification · canvas-layout-source

对应 `F1681` 的 `verification` 数组，逐条真实断言，禁止 mock 掉判定本身。

1. **组织自定义生效**：真库集成测试——发布一个内置 key（如 `persona`）的
   `user-edited` 版本（改 `layout.tone`/`cols`），走 `ensureCanvasFenceTemplate`
   拿到的 spec 与该行的 `layout` 逐字段一致，不是内置默认值。
2. **未自定义时原生几何不变**：backfill 出来的 `builtin-derived` 行存在时，
   `ensureCanvasFenceTemplate` 解析出的坐标与不查 DB 时的内置原生 spec 逐坐标
   相同（防止「查到行就当作已自定义」的回归）。
3. **优雅退回**：mock `listCanvasTemplates` 网络失败，内置 key 仍然渲染成功
   （走出口①），非内置 key 才落 `fetch-failed`。
4. **一次性不可退回**：`user-edited` 之后再铸一版内容与默认值字节相同的版本，
   `layout_source` 仍是 `user-edited`（不因内容比对判定退回）。
5. **单次网络请求**：一条消息含 2 个内置围栏、或 30 秒缓存窗口内的 2 条消息，
   只触发 1 次 `listCanvasTemplates`（沿用现有 `AUTO_OWNER`/TTL 断言写法）。
6. **写入侧隔离**：backfill 脚本路径写出的行始终是 `builtin-derived`，即使脚本
   本身走的是 `createTemplate`/`mintTemplateVersion` 这条与用户编辑同名的应用层
   路径——断言判定不是靠「谁调用的」，而是靠显式内部标记。

verification 命令（占位，写代码时钉死为真实文件）：

```
pnpm --filter api exec vitest run tests/canvas/layout-source-write-path.test.ts
pnpm --filter api exec vitest run tests/canvas/fence-template-resolver-layout-source.test.ts
pnpm --filter web exec vitest run tests/ui/chat-canvas-fence-layout-source.test.tsx
pnpm --filter api run typecheck
```
