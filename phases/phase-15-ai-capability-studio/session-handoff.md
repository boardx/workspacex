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

22:58续进：云任务1已独立运行ef00ded9的30项并确认空白血缘关闭；任务3回报a0126b62五项管理delta问题，本轮补MCP列表revision、空composite拒绝、modelEvidenceExchanges关联校验、CapabilityAdminError显式错误传输delta。后两者未接入生产adapter/filter，必须在正式实现时一起接线并做HTTP反证。

新增model-configuration-preview.tsx（主任务所有）：配置输入与并发恢复；governance页面补MCP端点/凭据输入及clear/keep边界。管理10项定向测试通过；总UI30项、总契约32项。后续重点从admin-ui-remaining.md取下一项：连通性与准入evidence分开、停用影响、MCP变化分类/权限范围、精确失败导航。Mac仍锁屏，不能宣称完成这些新增页面的浏览器验收。

#3241远端又合main更新到3975ff7b871cd2c5ab3de3678882ae68bfea0eea，本轮查询无失败、fullstack-smoke和backend-required仍运行。之前f6ac3bb9的全绿不代表此新SHA已全绿；需要重新复核再交协调者。

## 2026-09-09 23:16：准入证据与第六轮复审修正

新增独立连通性探测、三种人工准入判读、必填证据；配置变化保留旧输入供查看，必须明确以新版本重填。治理状态/组件12项通过，web与contracts类型检查通过。

独立审查确认1e618531上的五项契约问题关闭，又发现MCP串服务器响应；本轮补响应serverId和mcpDiscoveryExchange，校验服务器、每个工具与四类差异命名空间（包括零工具响应）。管理契约9项通过；生产adapter仍须在正式实施中采用exchange。

模型冲突现在并列显示最新配置与本地修改，明确勾选比较后才可重新应用。MCP两个结果模拟按钮共享提交前置，未确认clear或空replace都禁用。新代码待提交后的独立复审与浏览器验证。

#3241远端3975ff7b的fullstack-smoke失败日志证明GitHub403额度耗尽，已在23:03:49重置后重跑run34363590624的失败job，attempt2排队中；未判绿或合并。Mac锁屏与身份凭据未解除。Mermaid保持生产紫色、设计黄色、外部阻塞红色，并将设计工作量复估增加1.5人日，总46人日。

## 2026-09-09 23:26：管理影响与权限原型，合入时间审计

ModelImpactPreview复用DisableDialog，加入引用未知/失败/过期禁确认、四类引用、两种停用方式、新选择移除、组合成员只读阻塞。3项交互测试通过。共享弹窗的reason目前不会传给onConfirm，正式生产接线必须修正这条审计数据链；本原型不发送停用请求、不产生真实审计。

MCP逐工具改用既有ToolAuthScope五值，复用checkToolScopeCap/checkToolScopeWithinServer；发现演示展示四类差异、移除旧引用失败和副作用变化后的即时收紧，连接不自动改变评审。治理状态7项和组件7项通过，web类型检查/lint通过。

#3241已合入6fd11c5964bda2c5a6eb8d118011be6ed09cb0e5，head3975ff7b当前CI全绿。但合入23:04:21早于重跑成功23:22:17。读取全部34条check历史/commit statuses和merge第一父0bfbb0af的真实策略，judgeClosingPrGreen返回violation（合入时fullstack-smoke FAILURE）。已在PR评论交回协调者；不将事后绿当合入时绿，不自行改passing或回滚业务修复。

## 2026-09-09 23:32 validation and next steps

UI: 41/41 across 7 files. Contracts: 33/33 across 5 files. Web/contracts/API typechecks and web lint pass. API bare invocation was correctly refused by isolation gate; rerun through with-test-isolation passed 23/23 MCP discovery tests and cleaned the isolated database.

Latest code 9ea6cdbb4 includes model impact confirmation, five-value MCP scopes using shared cap functions, failure attribution references, and review corrections: edits revoke conflict confirmation; failed candidate credentials preserve saved connection status; current failed probe prevents enable until successful reprobe. serverSlugOf is extracted without behavior change into existing contracts and re-exported by discovery; canonical mcp-crm namespace tests now pass. Production operation/DTO adoption remains pending.

RunFailurePreview compares run/current revisions, shows MCP snapshot reference only, hides absent or unauthorized navigation, never fabricates historical configuration or replays a run. Browser verification remains blocked by lock screen. Registration #3235 still open. Formal signoff pending, feature list empty, coverage incomplete. Next: exact-SHA independent review, complete operation/UC/permission mapping, then reviewable human signoff bundle. Do not claim production complete.

#3241 is merged and current checks pass, but historical judgeClosingPrGreen returns violation: merged at 15:04:21Z with fullstack-smoke FAILURE, retry passed at 15:22:17Z. Evidence and coordinator follow-up: https://github.com/boardx/workspacex/pull/3241#issuecomment-5604384865 . No self-merge or retroactive passing.

23:40 follow-up: permission-coverage.md maps the 27 Skill operations and existing admin/runtime boundaries; source-connection-journey.md describes missing private GitHub authorization lifecycle with primary GitHub documentation. These remain proposals, not implemented source connection APIs. Mermaid C4 is now yellow because coverage work has started; browser retest Y blocks final signoff G, not independent coverage drafting. Three existing cloud review tasks are active on bfc7d22c; await their bounded review results before claiming closure. #3235 latest remote head408750db is still OPEN.

## 2026-09-10 00:06 active iteration

Independent namespace review closed bfc7d22c, 33 contract tests independently passed; remote API execution unavailable (no Docker). UI review found reused disable snapshot, old grants/diffs on new MCP config, permission wording and missing return context. Added red counterexamples (3 failures), then fixed; 31 targeted UI tests plus web types/lint pass. A new fromRun preview context is displayed without replacing draft or replaying; unknown IDs do not expose details. All changes pending next commit/review.

Coverage review identified six real workflow/API gaps now expanded in Mermaid C30-C36: ordinary repository adaptation, private source connections, trial details, upstream/history content, upload recovery, admin history/lifecycle. C3 is a 6-person-day aggregate including child tasks, not double counted. Overall estimate now51.5; production39 unchanged pending actual feature sizing. C4 remains active; formal signoff pending, no feature implementation claim. Scope details in permission-coverage.md/source-connection-journey.md.

00:08: skill-source-assessment.ts adds a review-only assessment/adaptation contract and4 passing tests. UI still to follow. Separate source assessment accepts ordinary repositories without Skill candidates; adaptation is new r1 source-pinned draft with inert references and unfinished-work list, never automatic execution/publication. New file not exported from production index. Next independent review should cover exact assessment/response correlation and source-file consent.
