# R6 视觉验收记录

## 基线

`user-rejected-baseline.png` 为用户在本会话提交的截图，用户评价此界面为 0 分。它不是本轮执行器生成的截图，不能据此推断被测 SHA、部署版本或服务器状态。

可见缺陷：上半屏被属性表单遮挡、多层工具栏重叠、右侧精确属性默认展开、底部重复样式栏、中文字形纵向拉伸。

## 当前边界

- 紧凑工具条实现 `1bd4cde04`；字形修复 `6c74e8817`。
- 独立 review 拒绝 `a8821280c`：工具条边缘越界；批量选区重建平方级开销；旧 Undo 文本定位失效。
- Undo 定位已改可访问名称 `dc9070c1d`。其余修复开发中。
- 三视口规格已加入 `apps/web/e2e/board-selection-layout.spec.ts`，仍待最终同一 SHA 执行与截图人工复核。
- 2026-09-27 主 session 曾运行完整布局测试，但发现旧定位后主动中止；该运行不计通过，独占测试 Docker 栈已释放。

尚无视觉九分结论。最终截图、交互 trace、验收结果与被测 SHA 必须补齐后才能关闭本轮视觉门。

## 8a7b6be75 真实视觉复验：失败

主 session 隔离运行 `run-muj98q7f-1d9f2b5c-11ad256a619f`，执行 `board-selection-layout.spec.ts --grep 'visual acceptance'`。巨大属性表单和中文字形拉伸在截图中已消失，但窗口变化后上下文工具条覆盖左上全局缩放控件，`board-zoom-fit-board` 被“评论”按钮拦截（trace call@177）。运行退出 1，未通过；`8a7b6be75-toolbar-collision.png` 是实际失败截图，不是设计稿。trace归档自身报告zip损坏，因此不将该zip计为可用证据；保留可读原始日志及截图发现，修复后重新生成完整trace。

UI worker 已接手统一浮层障碍避让。主session不使用强制点击绕过遮挡；规格增加15秒动作超时以快速暴露无法点击的控件。

## 4177f3651 主 session 复验：5/5 通过

完整命令：`FULLSTACK_E2E_SERVER_TIMEOUT_MS=600000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --no-deps --project=seeded-github-import e2e/board-selection-layout.spec.ts --trace on`。隔离运行 `run-muj9vkkf-db44f4dc-9c2687f2f38a`，总计2分20秒，清理1秒，退出0。

通过：15种布局及远端同步/Undo；Alt多选拖复制及Undo；真实指针吸附及Undo；Smart Layout取消/应用/Undo/远端修改冲突/刷新；三视口Sticky/Text共六张截图。主session逐张查看：当前选中文字未被全局或上下文工具遮住，字形没有此前纵向拉伸，精确属性默认收起，底部文字工具选中态可读。截图及SHA见子目录manifest。原始trace只在本地保留，不把可能包含测试凭证的trace直接入库。

此证据只覆盖R6上述场景，不等于九分：完整对象/空态/触摸/长文/400%/会议室/全量六旅程及性能仍需R10统一验收。
