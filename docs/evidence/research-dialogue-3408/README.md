# 研究对话驱动流程 — #3408

## 用户行为

用户在左侧描述需求或修改意见，对话提案直接显示为右侧当前步骤的待确认草稿；可继续讨论，确认应用后推进。五步提供对应提问提示，支持 Enter 发送、Shift+Enter 换行和中文输入法确认保护。

提案预览要求 node/version 匹配且无进行中命令或错误。右侧手动编辑后不可批准旧提案；未应用提案时右侧确认禁用，避免首次主题再次生成覆盖用户所见内容。来源与报告也显示提案预览，来源增删在预览期间禁用。

## 已执行验证

- `./init.sh`：通过。首次沙箱 DNS 失败，经本机代理重试成功。
- `pnpm --filter web exec vitest run tests/ui/guided-research-conversation-live.test.tsx tests/ui/guided-research-live.test.tsx tests/ui/guided-research-transition.test.tsx tests/ui/guided-research-report-stream.test.tsx`：48 项通过。
- `pnpm --filter web typecheck`、`pnpm --filter api typecheck`：通过。
- 变更前端文件的 `next lint --file ...`、`pnpm --filter web lint:design`：通过。
- `cd apps/web && node scripts/research-conversation-visual-check.cjs`：真实 Chrome 验证发送、预览、刷新、连续修改、手机布局、应用及推进通过。使用明确 API 夹具，不代表真实模型或数据库验收。默认本地页面端口 3189，API 夹具拦截 localhost:3200。仅本地字体用 `NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/tmp/studio-font-fixture.cjs` 避免 Google Fonts 网络影响，产品配置不变。
- 独立审查：轮询先失败的草稿恢复、首次提案确认覆盖两个 P2 已修复并复审接受。

- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-runtime-conversation.test.ts tests/research/guided-runtime-orchestration.test.ts`：2 文件 8 项通过。新服务测试覆盖待采用提案上下文、页面草稿优先、详细字段保留、失败旧提案保留及过期/异步节点拒绝。

CI 状态以 PR 当前 head 为准。

## 恢复边界

同版本有效提案刷新后可恢复。连续消息失败时，本页通过 POST 返回或轮询均保留提交草稿，用户可选择继续编辑；服务端保留旧提案的原版本供恢复参考，不能直接批准。失败后刷新不自动恢复该旧提案为可编辑草稿，本地手动修改也不保证跨刷新保存。没有放宽真实来源、报告质量或并发版本约束。

## 截图

- [桌面对话草稿](conversation-draft-desktop.png)
- [手机对话](conversation-draft-mobile.png)
- [确认后下一步](conversation-next-step.png)
