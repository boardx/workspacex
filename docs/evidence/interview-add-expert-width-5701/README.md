# 添加专家画像弹窗加宽 — #5701

人类截图要求添加专家画像弹窗加宽。只将该 DialogContent 设置为 max-w-3xl，与既有查看详情一致；保留手机留白、85vh 最大高度、纵向滚动、全部字段与保存流程，不修改全局 Dialog。

- `pnpm --filter web exec vitest run tests/ui/interview-expert-library.test.tsx tests/ui/interview-studio-home.test.tsx`：33 passed。
- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import e2e/interview-expert-library-live.spec.ts`：1 passed。既有真实登录/HTTP/PG链路，无路由拦截或模型调用。新增表单在1280宽度下至少700px，在375下保留留白；两种尺寸均无横向溢出，并可滚动到保存按钮。完整资料保存、刷新、详情、访谈选用与旧行兼容继续通过。
- Web typecheck、受影响文件 Next lint、init.sh 快速基础检查通过；完整门禁由 PR CI 执行。

已目视 [桌面1280](add-expert-1280.png) 与 [手机375](add-expert-375.png)，新增弹窗加宽、文字可读且手机适配。测试栈由隔离脚本回收（清理1秒）。未生产写入、合并或部署。
