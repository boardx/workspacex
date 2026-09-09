# Phase 15 进度

2026-09-09，总工单 #3234，设计提案 PR #3239。本文件记录验证边界，不代替 GitHub 实时检查状态。

- 工作台与导入原型的审查修复已推送6617dceef，17项UI测试、14项契约测试和3次mutation反证通过。浏览器验证与23张截图见 design-proposal/capability-studio/ui.md；最新修复的原生后退与键盘复验因Mac锁屏待补。
- 新增Model/MCP依赖修复原型及6项状态/组件测试；配置改动使旧准入证据过期，重连失败保留旧凭据，clear需确认，新工具默认未授权。完整管理表单与生产接线仍未完成。
- 导入/版本和Model/MCP schema草案已统一来源解析、CAS批量保存、服务端试跑证据、恢复草稿语义。尚无生产调用者；上传/AI补丁/Agent失败派生草稿增量见development-operation-deltas.md，尚需可执行schema。
- GitHub目录导入的既有缺陷独立PR #3241关联#3240，修复提交0a293c44的18项HTTP/DB验证通过。独立review确认前次问题已修；远端已合main到f6ac3bb9，CI重新排队。CI与正式review尚未完结，不标完成。
- 注册 PR #3235 的名单测试已修复；凭据/enroll/lease未完成，不冒用其他身份。
- 三个云任务分别复核契约、交互修正、Model/MCP设计与更新后的修复PR；所有本地原型路径归主任务。
- 尚未生成正式feature/sprint、签核、发布或部署。design-proposal仍为提案，不能进入claim。

后续增量：新增空白创建、AI差异生成/查询/应用、临时ZIP上传策略/预检查询、从失败运行派生草稿的可执行草案；23项契约测试通过。用户原始需求保持原样，新增requirements/01-development-journey.md提供R1–R12锚点。独立复审确认sourcePin、单文件和来源恢复关闭，终态确认/重试交错另补先红后绿回归。当前UI测试共26项；浏览器仍待解锁，不宣称原生导航验收完成。
