# Phase 09 Progress

## 2026-08-17
- 创建问卷独立 phase。
- 以 boardx-dev-template 问卷系统方向和现有 `/studio/survey` 契约细化 feature_list。

## 2026-09-28 新原型重构
- 用户亲自确认 survey 束 UI／用例／API 和阶段一致性；新原型要求三步主流程，仅 AI 创建有导入步骤，所有页面使用真实服务与数据。
- 按用户要求，当前权威清单只保留对应 R9–R15 的 F08–F14 七个新原型工作包（35 点）；旧 F01–F07 定义留在 Git 历史而不混入当前验收。旧 F04 对应的 PR #4125 已于 2026-09-24 合并、issue #4037 已关闭，旧 sprint 记录是历史材料，不代表目前在进行中。本轮尚未有新 feature 处于 in_progress。
- 签核 `covers` 仍只列 F01–F07，等待人类亲自补入 F08–F14 后才能认领新工作包。设计 PR #4545 仍为 draft，其 e2e-core-loop 发生 webServer 240 秒启动超时，不能报告为 CI 全绿。
