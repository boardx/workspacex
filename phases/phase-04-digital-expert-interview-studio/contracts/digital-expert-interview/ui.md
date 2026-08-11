# 契约束 `digital-expert-interview` — ① UI

> 本文件引用 10 张截图，目录下实际 10 张；目录为 `phases/phase-04-digital-expert-interview-studio/ui-preview/digital-expert-interview/`。
> 原型结论：全页导航；不使用弹窗或右侧抽屉；不出现真人或用户画像选择。

## Standalone 视觉参考裁决

用户于 2026-08-11 确认采用 2026-07 `WorkspaceX Standalone.html` 作为视觉与工作台结构参考：复用 WorkspaceX 壳、Studio 顶部范围栏、卡片密度、状态/进度表达、详情分区和数字专家回答的“观点—理由—引用—不确定性—反例”层级。该参考中的弹窗新建、真人排期、受访者/对象类型、用户画像和模板优先流程均被后续需求取代，不进入本束。

## 一、页面与组件落点

| 页面 | 路由 | 组件落点 | 稳定测试入口 |
|---|---|---|---|
| Studio 历史访谈 | `/itv?tab=history` | `apps/web/components/itv/InterviewStudioHome*` | `itv-tab-history`, `itv-history-card-*`, `itv-create` |
| Studio 专家列表 | `/itv?tab=experts` | `apps/web/components/itv/DigitalExpertList*` | `itv-tab-experts`, `itv-expert-card-*`, `itv-quick-*` |
| 快捷访谈 | `/itv/quick/[interviewId]` | `apps/web/components/itv/QuickDigitalInterview*` | `itv-quick-page`, `itv-convert-batch` |
| 新建访谈入口 | `/itv/new` | `apps/web/components/itv/DigitalInterviewWorkflow*` | `itv-create-page`, `itv-step-1` |
| 继续五步流程 | `/itv/[interviewId]/setup` | `apps/web/components/itv/DigitalInterviewWorkflow*` | `itv-step-1` … `itv-step-5` |
| 访谈详情 | `/itv/[interviewId]` | `apps/web/components/itv/InterviewDetail*` | `itv-detail`, `itv-back-history`, `itv-status` |
| 访谈报告 | `/itv/[interviewId]/report` | `apps/web/components/itv/DigitalInterviewReport*` | `itv-report`, `itv-finding-*`, `itv-source-*` |

路由名是签核意图；实现时若现有 App Router 结构要求不同，可调整文件位置，但用户可见 URL 和稳定 testid 不得漂移。

## 二、截图索引（每张只在本节出现一次）

| # | 截图 | 评审重点 |
|---:|---|---|
| 1 | `01-interview-detail.png` | 状态面板、三项统计、专家运行状态、五分区、返回与右上角按钮完整 |
| 2 | `02-history-list.png` | 历史卡按状态给出继续创建/继续访谈/查看报告 |
| 3 | `03-expert-list.png` | 第二主标签、领域筛选、专家卡快捷访谈 |
| 4 | `04-quick-interview.png` | 独立全页对话、返回专家列表、转批量 |
| 5 | `05-create-topic.png` | 名称、标签、主题和五步导航；确认前不生成专家 |
| 6 | `06-review-experts.png` | 只审核数字专家；可删、可从库添加、至少保留一位 |
| 7 | `07-personalized-questions.png` | 按专家切换问题，支持增删改并说明问题目的 |
| 8 | `08-batch-interviews.png` | 专家级并行状态、记录、追问和单独重试 |
| 9 | `09-report-sources.png` | 报告生成前明确列出主题、专家、问题、记录和候选发现 |
| 10 | `10-report-ready.png` | 报告草稿、来源指针、探索性标记和待真人验证项 |

## 三、交互与响应式约束

- `/itv` 只有“历史访谈”“专家列表”两个主标签；默认历史。
- “返回历史访谈”显式导航到 `/itv?tab=history`，不依赖 `window.history`。
- “＋ 新建访谈”在首页与详情页均可见；主操作文案 `white-space: nowrap`，空间不足时整个 action group 换行。
- 桌面历史卡最多三列；窄屏两列或一列。详情侧栏在小屏转为上方状态区，不横向裁切。
- 快捷访谈、创建、详情、报告都是完整页面；离开后恢复服务端真实状态。
- 空态、加载、401/403、依赖失败、并发冲突和局部运行失败必须有独立呈现，不得把错误伪装为空列表。
- 所有按钮具备键盘焦点、禁用和忙碌态；生成/重试期间禁止重复提交但保留页面内容。
