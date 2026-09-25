# Board 全屏预览独立浏览器验证 — #3923

2026-09-23，工作区 `/private/tmp/workspacex-board-next`。

## 执行与结果

```bash
pnpm --filter web exec playwright test --config playwright.prototype-audit.config.ts whiteboard-preview.spec.ts
```

真实 Chromium，Playwright 自动启动独立 Next 开发服务（3198 / `.next-audit`）。工具批准本地服务和 Chromium 执行后，**13 passed (18.4s)**，退出码 0，无跳过。

## 本轮全屏断言

375、768、1280 三种宽度，高度均为 900：

- 全局 `shell-rail` 与 `shell-mobile-tabs` 不存在。
- `shell-main` 左侧为 0，宽度等于视口，高度等于 900。
- 返回工作区链接的 href 为 `/projects`；只验证链接目标，不声称验证了登录后的项目页。
- 文档无横向溢出。
- 窄屏样板便签全部位于画布边界内，属性面板初始隐藏，选择后可显示及收起。

回归：七态、便签创建/改字/拖动/撤销重做、连接、删除取消/Escape/确认/撤销、批量添加与 50 张上限均通过。

## 视觉复核

已查看本轮 `default-375.png`、`default-768.png`、`default-1280.png`：全局导航确实消失，返回工作区在左上方可见，白板壳铺满窗口，无底部导航占位。375 保持全图 36% 缩放，768 为 87%，桌面 100%。375 文字在全图下较小，可通过选择对象后的属性编辑或缩放阅读；未发现本轮新增遮挡与横向溢出。测试同时刷新七态截图。

## 资源与边界

测试结束后 `lsof -nP -iTCP:3198 -sTCP:LISTEN` 返回无监听，Playwright 管理的服务已释放。本轮未修改业务代码。

所有结果针对开发预览及内存交互。未验证持久化、Yjs 多人协作、Chat 图表导入或生产鉴权；不能据此宣称完整 Board 需求已完成。
