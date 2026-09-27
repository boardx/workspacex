# 用户访谈全屏 Markdown 工作台设计

## 目标与边界

用户访谈有两种明确的工作环境：访谈列表是 Workspace 的一部分；打开一项访谈后，用户进入不受 Workspace 侧栏干扰的全屏工作台。工作台以一条可点击、可感知状态的统一六步 Timeline 作为导航，并将流程中输入、生成和确认的内容统一成可编辑、可渲染、可追溯的 Markdown 产物。

本改动重构访谈的表现层、工作流投影和 Markdown 产物接口；不改变既有鉴权、版本校验、幂等请求、证据审阅或报告恢复语义。

## 用户可见行为

### 访谈列表

- 用户位于 `/itv` 时保留 `AppShell`、Workspace 图标栏、顶栏和访谈列表。
- 列表卡片以状态、专家数量、最近更新时间和完成度呈现；继续访谈与查看报告都打开该访谈的工作台。
- 从工作台点击“返回访谈列表”后回到 `/itv?tab=history`，Workspace 菜单再次出现。

### 全屏工作台

- `/itv/[interviewId]/setup` 仍受现有会话和组织权限保护，但改用 `AppShell` 的沉浸式变体：不渲染 Workspace 图标栏、顶栏、移动 Tabs 或持久 Skill 侧栏。
- 顶部固定的 `InterviewWorkbenchHeader` 是唯一的工作流导航入口：左侧显示品牌、访谈名称、状态与返回列表；中部显示六步 Timeline；右侧显示版本、Markdown 源/预览入口及步骤动作。
- Timeline 的六步为：导入需求、确认分析、选择专家、访谈问题、开始访谈、生成报告。完成步骤显示已完成状态，当前步骤显示活动状态，所有可访问步骤可直接点击。
- 切换步骤或返回列表时，如有未确认的表单或 Markdown 草稿，复用现有“继续编辑 / 放弃更改”保护；放弃只撤销当前本地缓冲，不覆盖已经确认的版本。
- 现有 Skill 助手从常驻左栏改为 Header 触发的抽屉，避免压缩主要工作区；其提议仍必须经用户显式应用后才写入当前草稿。

## 信息架构与组件边界

### 壳层

`AppShell` 新增明确的 `immersive` 模式，而不是由访谈组件通过 CSS 隐藏全局元素。沉浸式模式保留 SessionProvider、身份故障态与 FeedbackProvider，移除 IconRail、TopBar、MobileTabs 和 Shell 主容器滚动限制。列表页继续使用默认模式。

`DigitalInterviewSetup` 只负责加载与鉴权后的工作流分支。`PersistentDigitalInterviewWorkflow` 只负责工作台状态与命令调用，不再承担 Workspace 壳层职责。

### 工作台

新增以下可独立测试的组件：

- `InterviewWorkbenchHeader`：显示访谈身份、返回列表、统一 Timeline、版本和辅助操作。
- `InterviewStageFrame`：提供各步骤一致的内容宽度、标题、Markdown 模式控制与上一步/下一步操作。
- `InterviewMarkdownSurface`：编辑器与渲染预览共用的 Markdown 表面；从同一 source 字符串渲染，不维护第二份富文本状态。
- `InterviewSkillDrawer`：按需显示 Skill 消息、提议与应用结果。

六个步骤各自只渲染其阶段内容：需求输入、分析卡片、专家库及虚拟专家、问题分组、执行摘要、报告与证据。阶段组件通过 `InterviewStageFrame` 接收 Markdown 产物和命令回调，不能直接改写其他阶段的内容。

## Markdown 单一事实源

每一个阶段都有一个版本化 `WorkflowMarkdownArtifact`：

| 阶段 | artifact key | 说明 |
| --- | --- | --- |
| 导入需求 | `brief` | 研究背景、目标、对象、场景、约束及原始材料索引 |
| 确认分析 | `analysis` | AI 提炼的目标、范围、成功标准、研究建议 |
| 选择专家 | `experts` | 候选、已选和虚拟专家的角色、能力、边界 |
| 访谈问题 | `outline` | 按专家与问题类型分组的提纲、目的和追问 |
| 开始访谈 | `transcript` | 运行状态、逐专家回答、发现和待验证项 |
| 生成报告 | `report` | 可导出研究报告及来源链接 |

每项包含 `key`、`markdown`、`revisionId`、`updatedAt`、`source`（用户、模型或系统）和可选 `status`。结构化控件是该 Markdown 的受限编辑入口：它们保存时生成或补丁化对应 Markdown，预览永远从保存后的 Markdown 渲染。模型生成的内容先作为草稿或提议呈现，确认后创建新修订，不能静默覆盖已确认版本。

工作流 API 返回 `artifacts` 投影，并继续保留既有结构化字段作为兼容读模型。服务端在命令完成时原子更新结构化状态与对应 Markdown artifact；客户端只以服务器回传的 artifact 为已保存事实。本地未确认内容只保存在明确的草稿缓冲中。

报告导出、证据审阅、失败重试和 SSE 增量流均使用 `report` artifact。报告流仍要求 Markdown append-only；失败时保留已生成片段、错误代码和上次成功 revision，用户可从 Header 或报告页安全重试。

## 状态、失败与可访问性

- Header Timeline 使用语义化列表和按钮，当前项带 `aria-current="step"`，完成、当前、可跳转和不可达状态均有文本说明。
- 失败、生成中、空状态和无权限状态在阶段内容区显式显示，永远不能把已保存 Markdown 清空。
- 任何重生成会声明受影响的下游 artifact；用户确认后保留上个 revision 供审阅与恢复。
- 编辑器、抽屉、模态框与返回操作均支持键盘焦点与 Escape 行为；窄屏下 Timeline 横向可滚动但不裁切步骤名称。

## 验证策略

1. UI 单测验证默认列表壳有 Workspace 导航、详情沉浸式壳没有该导航、返回后恢复列表路由。
2. UI 单测验证六步 Header 的活动/完成状态、跳步、未保存离开保护及 Skill 抽屉。
3. 契约与 API 测试验证每次确认都会写入正确 Markdown artifact，重试不会丢失已保存片段，旧 revision 可被读取。
4. Playwright 覆盖列表进入全屏工作台、Header 跳转、Markdown 编辑/预览、失败后重试及回到列表。
5. 浏览器视觉比对以用户提供的八张原型为基准，覆盖列表、需求、分析、专家、虚拟专家弹窗、问题、执行和报告；通过后记录 `design-qa.md`。

## 非目标

- 不重写访谈的业务权限模型、模型路由或既有报告证据规则。
- 不把 Markdown 仅作为导出格式；也不建立与 Markdown 并行且可漂移的富文本事实源。
- 不把 Workspace 的菜单复制进工作台 Header。
