# 实施交接

目标与范围见 requirements/00-overview.md，总工单 #3234。持续推进直到完整交付，不以原型或PR创建作为完成。

主设计工作区 /private/tmp/workspacex-studio-design，分支 codex/ai-capability-studio-design，PR #3239。主任务拥有 apps/web/components/ai-capability-studio、对应preview路由和阶段材料。云端工作台任务已撤销这些路径所有权，改为评审。

下一步：合并独立复审意见；补齐上传/AI补丁/Agent失败派生草稿的可执行schema与Model/MCP完整表单；将原型与契约关联并形成完整feature覆盖，再提交一次具体UI/UC/API签核。不得代填confirmed，不得伪造真实模型/数据库验收。最新状态见progress.md，避免以本交接的历史SHA推断远端当前状态。

本地Next预览端口3027，当前仍用于浏览器验证；结束使用时停止本会话服务器。截图与交互记录见ui-preview/workbench。测试隔离栈执行后已清理，收尾仍需按资源SOP检查。

既有目录导入修复另在 /private/tmp/workspacex-skill-directory-discovery，PR #3241。跟进最新SHA的CI和独立review至全绿后交coord-main合并。#3241及注册PR #3235远端均已被另一执行者合main更新，修改前先fetch，不强推。

Mac锁屏，CUA明确报告自动解锁失败；已异步请求用户解锁，未收到回复。不要绕过锁屏。解锁后重新选择iab tab4，复验历史绑定、测试输入失效、批次来源锁定、back/forward草稿恢复及键盘；新增governance页面还没有真实浏览器截图。

最新已推送c946a4295c3aaef7e5db946ffe1bfc97b8760bab。Skill草案已补上传policy/job、AIproposal、空白创建、失败run派生草稿，契约23项通过；UI26项通过，标准pre-push11任务通过。云任务1正在复核新增契约，云任务2复核终态确认/重试竞态，云任务3已返回Model/MCP完整交互规格（runtime-ui-interactions.md）。优先吸收具体审查反例，再完成Model/MCP可执行delta与权限/feature覆盖。不要因既有setAgentSkillPins注释写“草案”就忽略其真实controller接线。

#3241最新判定以classifyChecks读取：f6ac3bb9当时无changes/blocked，但backend-required尚未出现，waitingCi。不能只看前端rollup无红就合并；等待最终聚合后交coord-main。当前PR仍OPEN。

又补capability-admin-deltas.ts与4项测试（全部契约定向累计27项）：现有Model注册/配置/探测/准入/启用与MCP重连的继承草案，未改原接口。下一步补列表/路由/停用增量，核对独立云审对c946a429的返回；不要把该后续delta当作已独立审过。UI reviewer已确认c946a429中的终态确认/重试交错问题关闭。

2026-09-09 22:30续进：独立审对c946a429运行23/23并指出空白创建响应血缘问题，已新增反例先红后绿；NewBlankSkillDraft现限定revision1、sourcePin和历史版本血缘均null。列表/路由/停用delta也已补齐，provider/upstream收敛复用运行时schema；定向契约合计30项（10+5+5+4+6）。下一步等待云任务3对a0126b62初组管理delta的审查（后续改动需重新提供新SHA），完善Model/MCP完整表单、权限和feature覆盖。

#3241 f6ac3bb9已由classifyChecks实测blocked/changes/waitingCi均空，仍OPEN/BEHIND；已在PR评论明确交coord-main执行正式review/更新/合并门禁。本worker不自行合并。注册#3235又被其他执行者合main更新到c9f0a543，CI重跑；不要基于旧SHA推断通过。Mac解锁请求尚无回复。
