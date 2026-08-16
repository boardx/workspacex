# 会话交接 — Sprint 01/12

## 当前已验证
- F195 已签核、已建 Issue #1432、已认领为 `in_progress`；尚未宣称实现或 passing。

## 本轮改动
- 新建 Sprint 01/12，并将 F195 领入该 sprint。
- GitHub 单向投影已建立：`https://github.com/boardx/workspacex/issues/1432`。

## 仍损坏或未验证
- F195 的契约、Python LangGraph、API、Web 单页投影均尚未实现与验证。

## 下一步最佳动作
- 从 F195 契约 RED 测试开始；不要提前实现依赖链 F196/F197/F198/F170/F171。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/12`
- 调试:`pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts`
