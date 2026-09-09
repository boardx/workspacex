# 工作台 UI 材料

当前状态：原型实施中，无已验证的新截图；不宣称可签核。

计划预览路由：`/preview/ai-capability-studio/workbench`。实际生产入口的接线在签核后实施。

复用 apps/web 现有设计 token、Button/Input/状态壳层及代码编辑能力。主旅程包含来源预览、文件编辑、AI 差异确认、试跑证据、显式发布和绑定 Agent。需覆盖 default/loading/empty/invalid/dep-failed/denied/success，并保留稳定 data-testid 和键盘可操作路径。

发布前后分别显示“工作草稿 revision”和“已发布版本”，不以一个模糊“已保存”状态覆盖两者。改动后原测试结果展示过期提示。失败运行返回精确草稿和依赖配置，不能返回当前最新内容冒充当时上下文。

截图、真实交互断言及组件文件路径在原型取回并运行后补齐；空截图目录不是 UI 证据。
