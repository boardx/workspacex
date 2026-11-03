# 国际化二期：子页面盘点与验收方案

状态：审计完成，按独立 issue/PR 分批实施中。2026-11-03。以下基线/门禁段是开工快照；当前合并状态以各 PR 的实时状态为准。

## 实施账本与覆盖边界

| 批次 | 当前切片与证据 | 路由/组件边界 |
|---|---|---|
| B1 | [#6141 / PR #6144](https://github.com/boardx/workspacex/pull/6144)，`evidence/i18n-profile-6141/` | `/profile` 与共用 StateShell；有真实个人资料/密码浏览器，不代表所有 state/preview 页已验 |
| B1 | [#6145 / PR #6147](https://github.com/boardx/workspacex/pull/6147)，`evidence/i18n-activity-6145/` | 自己的活动展示，显式 structured-v1 协商；未知/历史摘要保留原文 |
| B1 | [#6146 / PR #6154](https://github.com/boardx/workspacex/pull/6154)，`evidence/i18n-notifications-6146/` | 共享通知类别/控件；服务端动态标题/正文仍源文，不冒充全量翻译 |
| B1 | [#6155 / PR #6157](https://github.com/boardx/workspacex/pull/6157)，`evidence/i18n-account-entry-6155/` | register/verify-email/reset-password + 共享动画；真实公共页与组件 payload，有效邮件/真实注册不在该公共浏览器旅程 |
| B1 | [#6158 / PR #6159](https://github.com/boardx/workspacex/pull/6159)，`evidence/i18n-invite-entry-6158/` | `/auth/activate` 单人/共享/缺令牌；真实公共页面，未实际提交邀请；会话保护有回归 |
| B2 | [#6160 / PR #6164](https://github.com/boardx/workspacex/pull/6164)，`evidence/i18n-project-list-6160/` | `/projects` 与创建弹窗/通用创建表单；真实创建/标签/归档/consultant 403 已验。完整创建契约既有 P3 缺口独立 #6163；工作台和工作坊向导另切片 |
| B2 | [#6167 / PR #6168](https://github.com/boardx/workspacex/pull/6168)，`evidence/i18n-live-tasks-6167/` | 生产 `/tasks` 四分区、创建/状态流转/失败/日期；43项相关组件与资源检查、真实 API/PG 创建与前进退回已验；预览不在此片 |
| 共用壳 | [#6165 / PR #6166](https://github.com/boardx/workspacex/pull/6166)，`evidence/i18n-mobile-header-6165/`（独立 PR） | TopBar 语言切换器窄屏裁切修复；320/375/768/1280 双语几何与操作验收 |

当前所有 `preview/*`、实验入口、mock 驱动的 join/group/consent 等未列明真实验收的路径，仍记作**未覆盖**。
137 是原始入口盘点基线，不能用少数共用组件已翻译换算“137 页已完成”。后续 B2→B10 继续逐 issue/PR 与真实用例落盘；
任何表中 PR 链接只标实现位置，不把“已提交”当“已合并/CI 绿”。

## 基线与门禁

当前共享 checkout 为 `74181cffec57bdb3ec7ccb5c29394df4c72162e8`（其他任务分支）；未切分支、未创建 worktree、未修改业务代码。origin/develop 为 `151526a4f8dea1ad781d709ab8e3357f52714a96`，origin/main 为 `e44119db91e9539418ad605ca6aaef2c155d0116`。遵循 PROJECT.md：开发基线和 PR 目标为 develop；真正实施前须再获取 main/develop 最新代码，不能在共享 checkout 执行 pull/checkout。

扫描当前 checkout 的 app/components/lib：136 个 page.tsx，928 个有中文候选的文件、20825 条候选行。此统计通过排除行首注释的正则生成，仍可能含行尾注释、mock、业务原文与执行指令，不是翻译工作量。英文硬编码、依赖包文本、运行时动态文本不被中文扫描覆盖。与 develop 路由文件集对比：develop 多 `/preview/pricing`，合计137个入口；billing/page.tsx 与 billing-content.tsx 结构也有差异，实施以新 develop 重新扫描为准。

`./init.sh` 退出0（快速健康路径，未跑全仓验证）；`pnpm harness readiness` 与 `active-features` 退出0；当前任务为用户直接交办、统一队列之外。`pnpm harness tick --session i18n-stage2` 退出1：COORD_GATEWAY_URL 未配置，未获得协调租约/有效心跳。未认领其他 owner 的 in_progress feature。未运行浏览器验收、未宣称 passing。

## 范围与跨期边界

一期拥有根入口/首页、provider、locale持久化、切换、共享导航。二期消费一期 API，逐模块替换展示文案；三期拥有 Agent/Skill 主表及翻译表和 API。默认方案 zh-CN/en 尚非单独签核结论。二期开始实施的前提：一期已合入 develop、束级 UI/UC/API 签核及一致性复核满足、存在对应 issue、独立且本 session 唯一 worktree、协调平面就绪。当前不修改 provider、导航、语言资源基础或数据库。

标签、Tab、列头、按钮、空/加载/错误态、校验信息、toast、tooltip、aria-label、图例、枚举展示、相对时间、日期/数字/货币格式均属于二期。图标图形不翻译，翻译其可访问名称与提示。稳定ID、URL段、enum/API值、日志码、工具/模型ID和执行指令不能被替换；用户标题、消息、输入、文件名、转录、问卷内容、报告原文原样保留。系统提供的模板/默认值与用户编辑后的内容必须按来源区分，不能按“包含中文”强行翻译。

## 建议模块顺序与验收切片

每个切片独立 issue/PR；下表为待进入契约与feature流程的实施划分，不是已签核 feature。

| 顺序 | 路由/模块 | 展示来源与重点 | 验收旅程 |
|---|---|---|---|
| B1 | 登录、注册、激活、邮箱验证、重置、join/group/consent/session，profile | components/entry、profile；后端错误code映射，保留email/name | 两语言直达未登录页，校验/失败/成功；profile编辑原文保留 |
| B2 | projects/project、tasks、workflows（runs/approvals/board） | components/project、projects、tasks、workflow；lib/project-workbench、workflow-display-copy、provenance-labels | 创建→详情→Tab→成员/邀请/审批；枚举显示变化而请求值不变 |
| B3 | chat 各入口、share/chat、d、brain | components/chat、brain、files；lib/copilotkit-v2-error-copy、chat-failure-copy、human-time | 历史对话、流式工具调用、上传/重试、分享匿名访问；用户消息逐字保持 |
| B4 | agent/skill、admin及platform-admin中的agent/skill | components/agent、skill、agent-runtime、ai-capability-studio；lib/work-skill-display-copy、agent-directory | 目录→详情→选择→执行；UI翻译独立于内容localizations；缺译回源语言；固定ID不变 |
| B5 | research、itv、rec、studio/research/interview | components/research-studio、research、itv、interview、rec；导出工具 | 创建→步骤→空/失败/恢复→报告导出；模型回答/访谈原文不自动改语言 |
| B6 | studio/survey、surveys/[token] | components/survey、lib/survey、report-format | 设计→发布→匿名填写→响应→报告；题干/选项是用户内容；题型枚举和操作是UI |
| B7 | canvas、studio/board、tpl、studio/prototype | components/canvas、whiteboard、tpl、tpl-designer；lib/canvas | 工具栏/图标/对象面板/模板/导入导出；画布文字和序列化ID不变 |
| B8 | org-admin、admin/[module]、platform-admin/[module]、asset-governance、design-workbench/feedback-drafts | components/admin、org-admin、asset-governance、design-loop、feedback | 管理员/普通成员分别验证；列头/筛选/分页/权限/失败/审计可读 |
| B9 | billing、usage | components/billing；subscription-history、wallet-availability、live-qr-panel | 个人/组织账户、订阅、支付、历史、用量；locale只影响格式，不改变币种/地区/价格/支付渠道 |
| B10 | preview/*、dev/*、kitchen-sink、profile/preview、chat预览入口 | 各preview组件、lib/mock | 明确运行时可达性后逐屏展示验收；fixture说明不冒充生产功能；preview/pricing须按develop纳入 |

B4内容fallback依赖三期契约；二期可先完成静态外壳，但不可伪造持久化翻译。B9同时有定价改造会话，落地前需协调文件归属。

## 需要一期明确的共享契约

1. client hook与server locale读取、资源namespace/key命名及模块资源扩展入口，插值/复数规则；不在模块内复制provider或建第二套语言偏好。
2. SSR首屏、刷新、切换、匿名链接、登录后、跨Tab与未知locale的fallback规则；lang属性、持久化失败行为。
3. Date/Number/RelativeTime格式化API：locale与业务时区/币种分离，不把en当US价格。
4. global-error在provider失效时的独立文案回退；app/error/loading/not-found以及metadata/标题等非page文件的归属。
5. 动态资源是否支持运行时切换；禁止模块顶层缓存翻译后的数组或列头造成切换后滞留。

## 可执行验收方案（实施时新增，当前未执行）

- 每模块添加到拟建 `apps/web/e2e/i18n-subroutes.spec.ts` 的路由矩阵；以真实session与固定fixture覆盖动态ID，不能只请求占位路径。命令：`pnpm --filter web exec playwright test e2e/i18n-subroutes.spec.ts`。专属启动配置按现有测试fixture选择，不推断生产可直接访问。
- zh-CN/en各走：直接URL→刷新→站内跳转→语言切换；校验h1/Tab/列头/图标accessible name/tooltip/空/加载/错误/表单状态。覆盖匿名、成员、组织管理员、平台管理员各可见路由。
- 使用一份跨语言固定原文fixture（中英混合标题、消息、问卷选项、Agent自定义名字、文件名）；切换前后断言DOM原文和提交payload逐字不变。检查enum wire值/稳定ID不变。
- 故意删掉某locale key和某Agent/Skill翻译，验证既定fallback，无undefined/raw key/空白。模拟API失败、403、404、空列表和pending，而非只测happy path。
- 表格与图标按语义role/accessibility name断言；截图看英文长文案、320px窄屏、弹窗与列头溢出。业务时区与currency固定，仅检查locale格式差异。
- 资源完整性、插值变量一致性、key缺失及新增硬编码静态门控由一期提供/二期扩展。中文正则只作候选检查，不禁止用户内容，英文硬编码也必须审查。
- 模块既有E2E继续运行，避免把现有中文断言全删掉：使用locale项目或明确测试locale。现有文件包括 agent-directory-entry-point、skill-create-smoke、project-create-smoke、survey-complete-flow、org-admin-keyboard-navigation、research-route-continuity、billing-subscription-live等。
- 修改后最低检查 `pnpm --filter web typecheck`、`pnpm --filter web lint`、受影响vitest和上述浏览器矩阵；再执行feature约定verification及harness门控。预览页面不能替代真实API/用户旅程证据。

## 全量路由入口清单

以下完整列出当前checkout路由，并单列develop多出的路由。括号route-group已去除；动态参数保持原样。redirect标记仅为语法检测线索，不声明路由运行时不可达。

| URL | 文件 | redirect调用 |
|---|---|---|
| `/auth/activate` | `apps/web/app/(entry)/auth/activate/page.tsx` | — |
| `/auth/register` | `apps/web/app/(entry)/auth/register/page.tsx` | — |
| `/auth/reset-password` | `apps/web/app/(entry)/auth/reset-password/page.tsx` | — |
| `/auth/verify-email` | `apps/web/app/(entry)/auth/verify-email/page.tsx` | — |
| `/consent` | `apps/web/app/(entry)/consent/page.tsx` | — |
| `/group` | `apps/web/app/(entry)/group/page.tsx` | — |
| `/join` | `apps/web/app/(entry)/join/page.tsx` | — |
| `/login` | `apps/web/app/(entry)/login/page.tsx` | — |
| `/session` | `apps/web/app/(entry)/session/page.tsx` | — |
| `/admin/[module]` | `apps/web/app/admin/[module]/page.tsx` | 有 |
| `/admin/agent/[id]` | `apps/web/app/admin/agent/[id]/page.tsx` | 有 |
| `/admin` | `apps/web/app/admin/page.tsx` | — |
| `/admin/skill/[id]` | `apps/web/app/admin/skill/[id]/page.tsx` | 有 |
| `/agent/[id]` | `apps/web/app/agent/[id]/page.tsx` | — |
| `/agent` | `apps/web/app/agent/page.tsx` | — |
| `/asset-governance` | `apps/web/app/asset-governance/page.tsx` | — |
| `/billing` | `apps/web/app/billing/page.tsx` | — |
| `/brain` | `apps/web/app/brain/page.tsx` | — |
| `/canvas/[screen]` | `apps/web/app/canvas/[screen]/page.tsx` | — |
| `/canvas` | `apps/web/app/canvas/page.tsx` | 有 |
| `/chat/[threadId]` | `apps/web/app/chat/(v2)/[threadId]/page.tsx` | — |
| `/chat` | `apps/web/app/chat/(v2)/page.tsx` | — |
| `/chat/copilotkit-preview` | `apps/web/app/chat/copilotkit-preview/page.tsx` | — |
| `/chat/copilotkit-v2/[threadId]` | `apps/web/app/chat/copilotkit-v2/[threadId]/page.tsx` | — |
| `/chat/copilotkit-v2` | `apps/web/app/chat/copilotkit-v2/page.tsx` | — |
| `/chat/landing` | `apps/web/app/chat/landing/page.tsx` | — |
| `/chat/legacy` | `apps/web/app/chat/legacy/page.tsx` | — |
| `/chat/live` | `apps/web/app/chat/live/page.tsx` | — |
| `/chat/preset` | `apps/web/app/chat/preset/page.tsx` | — |
| `/d/[token]` | `apps/web/app/d/[token]/page.tsx` | — |
| `/dev/org-home-fixture` | `apps/web/app/dev/org-home-fixture/page.tsx` | — |
| `/home` | `apps/web/app/home/page.tsx` | — |
| `/itv/[interviewId]/[stage]` | `apps/web/app/itv/[interviewId]/[stage]/page.tsx` | — |
| `/itv/[interviewId]/setup` | `apps/web/app/itv/[interviewId]/setup/page.tsx` | — |
| `/itv/experts/[expertId]` | `apps/web/app/itv/experts/[expertId]/page.tsx` | — |
| `/itv/live` | `apps/web/app/itv/live/page.tsx` | — |
| `/itv/new` | `apps/web/app/itv/new/page.tsx` | 有 |
| `/itv` | `apps/web/app/itv/page.tsx` | — |
| `/itv/quick/[interviewId]` | `apps/web/app/itv/quick/[interviewId]/page.tsx` | — |
| `/kitchen-sink` | `apps/web/app/kitchen-sink/page.tsx` | — |
| `/org-admin/home-config` | `apps/web/app/org-admin/home-config/page.tsx` | — |
| `/org-admin/invites` | `apps/web/app/org-admin/invites/page.tsx` | — |
| `/org-admin/members` | `apps/web/app/org-admin/members/page.tsx` | — |
| `/org-admin` | `apps/web/app/org-admin/page.tsx` | 有 |
| `/org-admin/preview` | `apps/web/app/org-admin/preview/page.tsx` | — |
| `/org-admin/profile` | `apps/web/app/org-admin/profile/page.tsx` | — |
| `/org-admin/workflow-grants` | `apps/web/app/org-admin/workflow-grants/page.tsx` | — |
| `/` | `apps/web/app/page.tsx` | 有 |
| `/platform-admin/[module]` | `apps/web/app/platform-admin/[module]/page.tsx` | 有 |
| `/platform-admin/agent/[id]` | `apps/web/app/platform-admin/agent/[id]/page.tsx` | — |
| `/platform-admin/design-workbench/[projectId]` | `apps/web/app/platform-admin/design-workbench/[projectId]/page.tsx` | — |
| `/platform-admin/model-tests` | `apps/web/app/platform-admin/model-tests/page.tsx` | — |
| `/platform-admin` | `apps/web/app/platform-admin/page.tsx` | 有 |
| `/platform-admin/skill/[id]/bindings` | `apps/web/app/platform-admin/skill/[id]/bindings/page.tsx` | — |
| `/platform-admin/skill/[id]` | `apps/web/app/platform-admin/skill/[id]/page.tsx` | 有 |
| `/preview/agent-interrupts` | `apps/web/app/preview/agent-interrupts/page.tsx` | — |
| `/preview/agent-kernel` | `apps/web/app/preview/agent-kernel/page.tsx` | — |
| `/preview/agent-runtime` | `apps/web/app/preview/agent-runtime/page.tsx` | — |
| `/preview/agent-tool-chain` | `apps/web/app/preview/agent-tool-chain/page.tsx` | — |
| `/preview/ai-capability-studio/adapt` | `apps/web/app/preview/ai-capability-studio/adapt/page.tsx` | — |
| `/preview/ai-capability-studio/connections` | `apps/web/app/preview/ai-capability-studio/connections/page.tsx` | — |
| `/preview/ai-capability-studio/governance` | `apps/web/app/preview/ai-capability-studio/governance/page.tsx` | — |
| `/preview/ai-capability-studio/import` | `apps/web/app/preview/ai-capability-studio/import/page.tsx` | — |
| `/preview/ai-capability-studio/source` | `apps/web/app/preview/ai-capability-studio/source/page.tsx` | — |
| `/preview/ai-capability-studio/uploads` | `apps/web/app/preview/ai-capability-studio/uploads/page.tsx` | — |
| `/preview/ai-capability-studio/workbench` | `apps/web/app/preview/ai-capability-studio/workbench/page.tsx` | — |
| `/preview/billing` | `apps/web/app/preview/billing/page.tsx` | — |
| `/preview/board-authoring` | `apps/web/app/preview/board-authoring/page.tsx` | — |
| `/preview/board-fabric-v01` | `apps/web/app/preview/board-fabric-v01/page.tsx` | — |
| `/preview/board-object-authoring` | `apps/web/app/preview/board-object-authoring/page.tsx` | — |
| `/preview/board-workspace` | `apps/web/app/preview/board-workspace/page.tsx` | — |
| `/preview/canvas-streaming` | `apps/web/app/preview/canvas-streaming/page.tsx` | — |
| `/preview/canvas-template-gallery` | `apps/web/app/preview/canvas-template-gallery/page.tsx` | — |
| `/preview/chat-attach-modal` | `apps/web/app/preview/chat-attach-modal/page.tsx` | — |
| `/preview/chat-create-project` | `apps/web/app/preview/chat-create-project/page.tsx` | — |
| `/preview/chat-diagram-fabric` | `apps/web/app/preview/chat-diagram-fabric/page.tsx` | — |
| `/preview/chat-file-upload` | `apps/web/app/preview/chat-file-upload/page.tsx` | — |
| `/preview/chat-knowledge-graph` | `apps/web/app/preview/chat-knowledge-graph/page.tsx` | — |
| `/preview/chat-viz` | `apps/web/app/preview/chat-viz/page.tsx` | — |
| `/preview/context-pack` | `apps/web/app/preview/context-pack/page.tsx` | — |
| `/preview/feedback-design-loop` | `apps/web/app/preview/feedback-design-loop/page.tsx` | — |
| `/preview/feedback-loop` | `apps/web/app/preview/feedback-loop/page.tsx` | — |
| `/preview/live-collab-orchestration` | `apps/web/app/preview/live-collab-orchestration/page.tsx` | — |
| `/preview/plan-control` | `apps/web/app/preview/plan-control/page.tsx` | — |
| `/preview/plan-control-live` | `apps/web/app/preview/plan-control-live/page.tsx` | — |
| `/preview/tasks` | `apps/web/app/preview/tasks/page.tsx` | — |
| `/preview/whiteboard` | `apps/web/app/preview/whiteboard/page.tsx` | — |
| `/preview/work-stack` | `apps/web/app/preview/work-stack/page.tsx` | — |
| `/profile` | `apps/web/app/profile/page.tsx` | — |
| `/profile/preview` | `apps/web/app/profile/preview/page.tsx` | — |
| `/project/live` | `apps/web/app/project/live/page.tsx` | — |
| `/project/new` | `apps/web/app/project/new/page.tsx` | — |
| `/project` | `apps/web/app/project/page.tsx` | 有 |
| `/projects/[projectId]/canvas` | `apps/web/app/projects/[projectId]/canvas/page.tsx` | — |
| `/projects/[projectId]/files` | `apps/web/app/projects/[projectId]/files/page.tsx` | — |
| `/projects/[projectId]` | `apps/web/app/projects/[projectId]/page.tsx` | 有 |
| `/projects/join` | `apps/web/app/projects/join/page.tsx` | — |
| `/projects` | `apps/web/app/projects/page.tsx` | — |
| `/rec` | `apps/web/app/rec/page.tsx` | — |
| `/research/[sessionId]/[stage]` | `apps/web/app/research/[sessionId]/[stage]/page.tsx` | — |
| `/research/new` | `apps/web/app/research/new/page.tsx` | — |
| `/research` | `apps/web/app/research/page.tsx` | — |
| `/share/chat/[token]` | `apps/web/app/share/chat/[token]/page.tsx` | — |
| `/skill` | `apps/web/app/skill/page.tsx` | — |
| `/studio/board/[boardId]/digital-human` | `apps/web/app/studio/board/[boardId]/digital-human/page.tsx` | — |
| `/studio/board/[boardId]` | `apps/web/app/studio/board/[boardId]/page.tsx` | — |
| `/studio/board` | `apps/web/app/studio/board/page.tsx` | — |
| `/studio/design-workbench/[projectId]` | `apps/web/app/studio/design-workbench/[projectId]/page.tsx` | — |
| `/studio/design-workbench` | `apps/web/app/studio/design-workbench/page.tsx` | — |
| `/studio/feedback-drafts` | `apps/web/app/studio/feedback-drafts/page.tsx` | — |
| `/studio/interview/[id]` | `apps/web/app/studio/interview/[id]/page.tsx` | 有 |
| `/studio/interview` | `apps/web/app/studio/interview/page.tsx` | 有 |
| `/studio/prototype` | `apps/web/app/studio/prototype/page.tsx` | 有 |
| `/studio/research` | `apps/web/app/studio/research/page.tsx` | 有 |
| `/studio/survey/[surveyId]/design` | `apps/web/app/studio/survey/[surveyId]/design/page.tsx` | — |
| `/studio/survey/[surveyId]` | `apps/web/app/studio/survey/[surveyId]/page.tsx` | 有 |
| `/studio/survey/[surveyId]/publish` | `apps/web/app/studio/survey/[surveyId]/publish/page.tsx` | — |
| `/studio/survey/[surveyId]/report` | `apps/web/app/studio/survey/[surveyId]/report/page.tsx` | — |
| `/studio/survey/[surveyId]/responses` | `apps/web/app/studio/survey/[surveyId]/responses/page.tsx` | — |
| `/studio/survey/[surveyId]/template` | `apps/web/app/studio/survey/[surveyId]/template/page.tsx` | — |
| `/studio/survey/new/import` | `apps/web/app/studio/survey/new/import/page.tsx` | — |
| `/studio/survey` | `apps/web/app/studio/survey/page.tsx` | — |
| `/studio/survey/question-templates/[templateId]` | `apps/web/app/studio/survey/question-templates/[templateId]/page.tsx` | — |
| `/studio/survey/templates/[templateId]` | `apps/web/app/studio/survey/templates/[templateId]/page.tsx` | — |
| `/surveys/[token]` | `apps/web/app/surveys/[token]/page.tsx` | — |
| `/tasks` | `apps/web/app/tasks/page.tsx` | — |
| `/tpl/designer` | `apps/web/app/tpl/designer/page.tsx` | — |
| `/tpl/list` | `apps/web/app/tpl/list/page.tsx` | — |
| `/tpl` | `apps/web/app/tpl/page.tsx` | — |
| `/usage` | `apps/web/app/usage/page.tsx` | — |
| `/workflows/approvals` | `apps/web/app/workflows/approvals/page.tsx` | — |
| `/workflows/board` | `apps/web/app/workflows/board/page.tsx` | — |
| `/workflows` | `apps/web/app/workflows/page.tsx` | 有 |
| `/workflows/runs/[instanceId]` | `apps/web/app/workflows/runs/[instanceId]/page.tsx` | — |
| `/workflows/runs/[instanceId]/result` | `apps/web/app/workflows/runs/[instanceId]/result/page.tsx` | — |
| `/workflows/runs` | `apps/web/app/workflows/runs/page.tsx` | — |
| `/preview/pricing` | `apps/web/app/preview/pricing/page.tsx`（仅origin/develop） | 未检查 |

## 候选热点（前25；不是翻译字符串数量）

| 来源 | 候选行 |
|---|---|
| `lib/mock` | 3425 |
| `components/chat` | 2704 |
| `components/admin` | 1446 |
| `components/canvas` | 994 |
| `components/survey` | 941 |
| `components/design-loop` | 816 |
| `components/project` | 703 |
| `components/itv` | 669 |
| `components/whiteboard` | 627 |
| `components/org-admin` | 595 |
| `components/research-studio` | 580 |
| `components/skill` | 489 |
| `components/tpl` | 407 |
| `components/tpl-designer` | 376 |
| `components/entry` | 330 |
| `components/rec` | 321 |
| `components/interview` | 315 |
| `lib/survey` | 303 |
| `components/billing` | 277 |
| `components/agent-runtime` | 266 |
| `components/files` | 255 |
| `components/ai-capability-studio` | 248 |
| `components/workflow` | 215 |
| `components/shell` | 197 |
| `app/preview` | 186 |

机器明细见同目录 `i18n-stage2-inventory.json`，含每个页面直接imports、928个文件候选数量及前三个定位样例。该扫描不递归构建组件依赖图，不声称已经逐句人工审阅全部内容。
