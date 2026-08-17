# Coverage — User Research

> 第 ③ 件（API 契约）：本束复用 `packages/contracts/src/research.ts`（见 `.harness/scripts/third-artifact-map.json`），以同一 `session/start` 合同通过 `workflowType=user_research` 区分用户访谈研究投影。

| V | 验收行为 | API 操作 / 门控命令 | Feature | 状态 |
| --- | --- | --- | --- | --- |
| V1 | `workflowType=user_research` 的 `session/start` 创建、恢复与 `deep_research` 防串读 | `POST /api/v1/ai-agent/deep-research/session/start` + `pnpm --filter @repo/contracts exec vitest run tests/user-research-session-contract.test.ts` | F01/F05 | 待生成 |
| V2 | 访谈对象、研究问题、材料和发现投影均读取 user research 会话状态 | `POST /api/v1/ai-agent/deep-research/session/start` + `pnpm --filter web exec vitest run tests/ui/user-research-subjects-questions.test.tsx` | F02/F03 | 待生成 |
| V3 | 用户研究报告按问题组织 findings、evidence 与来源回跳 | `pnpm --filter web exec vitest run tests/ui/user-research-report.test.tsx` | F04 | 待生成 |

| Feature | Requirement |
| --- | --- |
| F01 | `00-overview.md#R2` |
| F02 | `00-overview.md#R3` |
| F03 | `00-overview.md#R3` |
| F04 | `00-overview.md#R4` |
| F05 | `00-overview.md#R5` |
