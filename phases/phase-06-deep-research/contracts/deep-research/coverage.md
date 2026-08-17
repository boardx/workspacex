# Coverage — Deep Research

> 第 ③ 件（API 契约）：本束复用 `packages/contracts/src/research.ts`（见 `.harness/scripts/third-artifact-map.json`），并由 Node API 的 guided research workflow 与 LangGraph checkpoint 实现承接。

| V | 验收行为 | API 操作 / 门控命令 | Feature | 状态 |
| --- | --- | --- | --- | --- |
| V1 | `workflowType=deep_research` 的 `session/start` 幂等启动、恢复与错误返回 | `POST /api/v1/ai-agent/deep-research/session/start` + `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/research/guided-workflow-command.test.ts` | F01 | 已验证 |
| V2 | brief、研究方向、报告大纲、资料研究、研究报告节点都由同一 session 状态推进 | `GuidedResearchWorkflowService.runCommand` + `pnpm --filter @repo/api exec tsc --noEmit` | F02/F03/F04/F05 | 已验证 |
| V3 | 研究报告页保留 citations，并支持 PDF 与 Word 导出 | `pnpm --filter web exec vitest run tests/ui/guided-research-flow.test.tsx` | F05 | 已验证 |
| V4 | 历史列表与继续研究按 `sessionId` 恢复，不生成重复会话 | `POST /api/v1/ai-agent/deep-research/session/start` + `pnpm --filter web exec vitest run tests/ui/guided-research-flow.test.tsx` | F06 | 已验证 |

| Feature | Requirement |
| --- | --- |
| F01 | `00-overview.md#R2` |
| F02 | `00-overview.md#R3` |
| F03 | `00-overview.md#R3` |
| F04 | `00-overview.md#R3` |
| F05 | `00-overview.md#R4` |
| F06 | `00-overview.md#R5` |
