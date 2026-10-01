# BV04/BV05 UI 设计预览证据

2026-09-30，主 session 在 `6bcc89260` 基础上运行 `/preview/board-authoring`，以 Playwright Chromium 截取本地 mock 页面。七张桌面图的 viewport 为 1440×900、系统色彩偏好为 dark；一张窄屏图为 375×812。预览使用本地模拟数据与角色，**没有连接正式 Board 服务、Fabric/Yjs 或 PG/文件存储**，不能证明正式路由通过端到端验收。窄屏截图在随后修正预览状态开关遮挡 dock 后更新；该修正应以最终提交 SHA 为准。

| 预览状态 | 图片 | 页面参数 / 可见断言 |
|---|---|---|
| 默认、选中便签 | [mock-default-1440.png](screenshots/mock-default-1440.png) | `?state=default`，浮动操作栏、纸张本体、底部 dock |
| 加载 | [mock-loading-1440.png](screenshots/mock-loading-1440.png) | `?state=loading`，打开白板提示 |
| 空白 | [mock-empty-1440.png](screenshots/mock-empty-1440.png) | `?state=empty`，第一张便签入口 |
| 校验失败 | [mock-validation-1440.png](screenshots/mock-validation-1440.png) | `?state=validation`，501 行超限，生成按钮禁用且输入保留 |
| 依赖失败 | [mock-dependency-failed-1440.png](screenshots/mock-dependency-failed-1440.png) | `?state=dependency-failed`，保存失败提示 |
| 只读 | [mock-denied-1440.png](screenshots/mock-denied-1440.png) | `?state=denied`，模拟只读角色 |
| 成功 | [mock-success-1440.png](screenshots/mock-success-1440.png) | `?state=success`，模拟已保存状态 |
| 窄屏默认 | [mock-default-375.png](screenshots/mock-default-375.png) | `?state=default`，dock 不被预览控件遮挡 |

这组图用于① UI 设计评审。正式签核仍需在 `/studio/board/:boardId` 采集真实 Board 的编辑中、IME、RTL/长文本、只读、保存失败、Delete→Undo、批量 500 行和触摸软键盘证据。每张正式截图要记录目标 SHA、Board 脱敏 ID、角色、viewport、服务连接、复现步骤及 trace。不能把本组 mock 图当作正式路由证据。
