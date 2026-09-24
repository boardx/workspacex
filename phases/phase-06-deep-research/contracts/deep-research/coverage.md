# Coverage — Deep Research

> 第 ③ 件（API 契约）：本束复用 `packages/contracts/src/research.ts`（见 `.harness/scripts/third-artifact-map.json`），并由 Node API 的 guided research workflow 与 LangGraph checkpoint 实现承接。

| V | 验收行为 | API 操作 / 门控命令 | Feature | 状态 |
| --- | --- | --- | --- | --- |
| V1 | `workflowType=deep_research` 的 `session/start` 幂等启动、恢复与错误返回 | `POST /api/v1/ai-agent/deep-research/session/start` + `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/research/guided-workflow-command.test.ts` | F01 | 已验证 |
| V2 | brief、研究方向、报告大纲、资料研究、研究报告节点都由同一 session 状态推进 | `GuidedResearchWorkflowService.runCommand` + `pnpm --filter @repo/api exec tsc --noEmit` | F02/F03/F04/F05 | 已验证 |
| V3 | 研究报告页保留 citations，并支持 PDF 与 Word 导出 | `pnpm --filter web exec vitest run tests/ui/guided-research-flow.test.tsx` | F05 | 已验证 |
| V4 | 历史列表与继续研究按 `sessionId` 恢复，不生成重复会话 | `POST /api/v1/ai-agent/deep-research/session/start` + `pnpm --filter web exec vitest run tests/ui/guided-research-flow.test.tsx` | F06 | 已验证 |
| V5 | 检索前选择投入档位；服务端锁定预算快照，恢复连续累计，硬上限前停止且幂等重放不重复扣账 | `GuidedResearchRuntimeCommand.configure_budget` + `pnpm --filter @repo/contracts exec vitest run tests/guided-research-budget-contract.test.ts` + `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-effort-policy.test.ts tests/research/guided-runtime-budget.test.ts tests/research/guided-runtime-budget-persistence.test.ts` + `pnpm --filter web exec vitest run tests/ui/guided-research-budget.test.tsx tests/ui/guided-research-progress.test.ts` | 待生成 | 待验证 |

| Feature | Requirement |
| --- | --- |
| F01 | `00-overview.md#R2` |
| F02 | `00-overview.md#R3` |
| F03 | `00-overview.md#R3` |
| F04 | `00-overview.md#R3` |
| F05 | `00-overview.md#R4` |
| F06 | `00-overview.md#R5` |
| 待生成 | `00-overview.md#R6` |
