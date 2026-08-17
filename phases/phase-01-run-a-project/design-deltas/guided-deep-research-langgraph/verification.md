# Guided Research LangGraph · 可执行验证

## F195 基础与单页恢复

```bash
pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts
cd apps/deep-agent-service && pytest tests/test_guided_research_graph.py tests/test_guided_research_postgres_recovery.py
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-workflow-command.test.ts tests/research/guided-session-list-and-recovery.test.ts
pnpm --filter web exec vitest run tests/ui/guided-research-single-page-workflow.test.tsx tests/ui/guided-research-flow.test.tsx
```

## F196–F198 结构化模型节点

```bash
cd apps/deep-agent-service && pytest tests/test_guided_research_brief.py tests/test_guided_research_directions.py tests/test_guided_research_outline.py
pnpm --filter web exec vitest run tests/ui/guided-research-checkpoints-live.test.tsx
```

断言每次命令包含当前节点完整输入；显式确认只调用一次 `qwen3.7-plus`；非法 JSON/schema、错误 model ID、
pending replay、stale version 和跨租户访问都有反证。

## F170–F171 真实检索与报告

```bash
cd apps/deep-agent-service && pytest tests/test_guided_research_search.py tests/test_guided_research_report.py
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-search-progress-and-retry.test.ts tests/research/guided-report-citations.test.ts
pnpm --filter web exec vitest run tests/ui/guided-research-search-live.test.tsx tests/ui/guided-research-report-live.test.tsx
```

断言模型内置联网结果不能成为来源；报告只引用同 revision 已采纳来源；部分失败可恢复且幂等重试。

## 共用静态门

```bash
pnpm --filter web run typecheck
node apps/api/scripts/lint-permission-paths.mjs
node .harness/scripts/lint-arch-deps.mjs
bash apps/web/scripts/lint-design.sh
```
