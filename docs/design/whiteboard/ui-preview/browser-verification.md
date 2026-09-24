# Whiteboard UI 预览浏览器验证

2026-09-23；独立 UI 验证。环境：本机 Chromium / Next development，http://localhost:3317/preview/whiteboard。

## 可复跑

先在仓库启动开发服务（本次已有服务，验证者没有另起服务）：

```bash
pnpm --filter web dev --port 3317
pnpm --filter web exec playwright test --config playwright.whiteboard.config.ts
```

可用 `WHITEBOARD_BASE_URL` 切换已启动的服务。本机受限沙箱无法注册 Chromium Mach port，首次测试在浏览器启动前失败；经工具批准提升执行权限后真实运行，首轮 13 tests passed (18.5s)，修复后增强断言复跑 13 tests passed (36.7s)。无跳过测试。

## 已实测

- 375 / 768 / 1280 × 900 文档无横向溢出（scrollWidth ≤ innerWidth）。375 / 768 三个样板便签的完整包围盒均在画布范围内；属性区初始隐藏，选择便签后显示，收起与对象面板开关有效。
- 默认、加载、空、校验失败、依赖失败、无权限、成功七态均真实可见。
- 创建便利贴，输入文字，拖动 80 × 60 像素；撤销和重做恢复对应位置与文字。
- 两对象连线增加 SVG 线条；删除取消和 Escape 不改变对象；确认删除同时删除关联线，撤销恢复。
- 批量逐行添加忽略空行；空输入与 51 行不可提交；3 个对象实际可见。
- 1280 截图实际显示 Studio 顶级 Board 导航。

截图：`default-375.png`、`default-768.png`、`default-1280.png` 与 `state-{default,loading,empty,invalid,dep-failed,denied,success}.png`。已逐张人工视觉检查。

## 视觉发现 / 后续建议

- 首轮发现窄屏便签裁切与常驻面板遮挡，实现者已修复。复跑截图确认 375 自动缩放为 36%、768 为 77%，三张便签完整呈现；属性面板默认收起。375 全图文字较小，可选中阅读属性或放大。
- 桌面结构清晰，工具、便签、状态文案可辨认。加载与失败画面确实替换画布，没有在错误下继续展示正常内容。
- 首轮发现 denied / dep-failed 保留 testid 不一致，实现者已改用 `RESERVED_STATE_TESTID`；增强测试同时断言可见文案及标准 testid，复跑通过。

## 严格边界

这是内存态 UI 预览，刷新重置。没有验证数据库持久化、Yjs / 多人协作、鉴权 API、Chat Mermaid/Fabric 导入、投票、历史恢复、开源部署或生产 Board 链路。七态为预览入口明确选择的状态演示，并非真实网络和权限故障注入。本报告不表示需求文档全部完成或功能 passing。
