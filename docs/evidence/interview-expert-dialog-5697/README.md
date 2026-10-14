# 专家详情展示调整 — #5697

人类截图要求查看专家弹窗加宽，移除所有专家详情底部“局限与材料边界”整段。详情容器覆盖为 max-w-3xl，保留全局 Dialog 的手机留白、最大高度与纵向滚动；共用 ExpertProfileDetails 移除末行，覆盖内置与自建画像。原始资料、表单、API、权限及访谈选用的证据内容保持原样。

## 验证

- `pnpm --filter web exec vitest run tests/ui/interview-expert-library.test.tsx tests/ui/interview-studio-home.test.tsx tests/lib/interview-virtual-expert.test.ts`：47 passed。详情移除断言先红（2 failed / 6 passed），实现后转绿，保留完整其他资料及保存/选用回归。
- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import e2e/interview-expert-library-live.spec.ts`：1 passed。真实登录/HTTP/PG，无模型调用/route拦截；内置与自建详情均无末段，1280下宽度至少700px、375下保留留白且无横向溢出，典型建议可滚动查看。完整资料新增/刷新/选用及旧行兼容仍通过。
- 同一浏览器用例实际验证点击关闭和键盘 Escape 后回到对应触发按钮。第一次验收揭示原有 controlled Dialog 未使用 DialogTrigger，Radix 无 triggerRef 可恢复焦点；本地保存实际触发按钮并在 onCloseAutoFocus 中对仍连接的按钮恢复焦点，保留失败断言后复跑通过。未改全局 Dialog。
- Web typecheck、受影响文件 Next lint、init.sh 快速基础验证通过；完整门禁由 PR CI 执行。

[桌面详情底部](builtin-full-1280.png)、[手机详情底部](builtin-full-375.png)、[自建详情刷新后](custom-full-reloaded.png) 已目视确认加宽、可读及末段缺席。原始测试输出摘要见 ui.txt/browser.txt。

隔离脚本已回收测试栈（清理1秒）。无生产写入、合并或部署。
