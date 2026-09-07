# 上游来源与 WorkspaceX 适配

方法来源：Anthropic `web-artifacts-builder`，固定提交 `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`：
https://github.com/anthropics/skills/tree/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/web-artifacts-builder

保留其“初始化源文件 → 开发交互 → 生成 bundle → 展示”的方法和避免模板化视觉的设计提醒。WorkspaceX 不原样执行上游脚本：上游初始化与 bundling 会在运行时安装动态依赖，且把浏览器测试定义为可选，这与本仓冻结依赖、无网沙箱和 G-SKILL 真实验收要求冲突。

本适配只使用沙箱已经锁定的依赖，强制生成源码、`bundle.html` 与 `test-record.json`，并把真实浏览器结构读取、主要交互、移动视口、网络拒绝、截图读回及 artifact 回执列为交付前验收。它不提供生产部署、浏览器引擎、网络权限或新的产物服务；浏览器由 WX-T022–T026 的 Microsoft Playwright MCP adapter 提供，交付复用 WX-T020。

Apache-2.0 许可证见包根 `LICENSE`。固定上游提交只是方法来源，不代表本地适配已通过真实模型 G-SKILL；实际结果仍以每次运行的测试证据为准。
