# 契约束 `digital-expert-interview` — Phase 04 覆盖矩阵

| V | Feature | API 操作 | UI / E2E | 证据材料 |
|---:|---|---|---|---|
| V1 | F01 | `DigitalInterviewStatus` + `transitionDigitalInterview` | 卡片/详情/步骤/主按钮同源 | `01-interview-detail.png`, `02-history-list.png` |
| V2 | F01 | `createDigitalInterviewDraft`，专家生成器 0 调用 | 第一步名称、标签、主题 | `05-create-topic.png` |
| V3 | F04 | `updateDigitalInterviewExperts` + `updateDigitalInterviewQuestions` | 专家增删、按专家切题 | `06-review-experts.png`, `07-personalized-questions.png` |
| V4 | F05 | `retryDigitalExpertRun` + `getDigitalExpertRuns` | 专家级状态和操作 | `08-batch-interviews.png` |
| V5 | F02 F03 | `listDigitalInterviews` + `listDigitalExperts` + `startQuickDigitalInterview` | 仅两个主标签；快捷访谈为独立页 | `02-history-list.png`, `03-expert-list.png`, `04-quick-interview.png` |
| V6 | F04 F05 | `getDigitalInterview` + 版本化保存操作 | 五步全页流程，第一步三项必填 | `05-create-topic.png` 至 `09-report-sources.png` |
| V7 | F06 | `getDigitalInterviewDetail` | 明确返回 `/itv?tab=history`；按钮组整体换行、按钮内不换行 | `01-interview-detail.png`, `02-history-list.png` |
| V8 | F06 | `generateDigitalInterviewReport`，发现引用专家、问题和回答且 `exploratory=true` | 报告来源、待真人验证项和回跳 | `09-report-sources.png`, `10-report-ready.png` |
| V9 | F07 | 真实 API + DB 状态经 `pnpm --filter web run e2e digital-interview-studio.spec.ts` | Playwright 跑快捷转批量、恢复、失败重试、报告 | 上述全套截图 + E2E 运行证据 |

## Feature 覆盖

- F01：R12-1、2、6
- F02：R12-5 的历史与专家目录入口，以及错误不伪装为空
- F03：R12-5 的快捷访谈全页、历史留存和转批量
- F04：R12-3、6 的主题、专家与个性化问题确认
- F05：R12-4、6 的并行运行、恢复与局部重试
- F06：R12-7、8 的详情导航与可追溯探索性报告
- F07：R12-9
