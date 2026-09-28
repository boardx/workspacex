# 进度日志 — Sprint 09/08

## 当前已验证状态(唯一真相)
- 仓库根目录: /Users/shenyangjun/.codex/worktrees/survey-workspace-home/workspacex
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F14 / 真实问卷全链路及原型保真验收
- 当前 blocker: 本地真实浏览器四条主链路已通过；F14 尚待 PR 的 CI、review 与合入 main，不能标 passing。

## 会话记录
### 2026-09-28 11:33:58
- 本轮目标: 用真实浏览器与 API/数据库验收新问卷路径。
- 执行计划摘要(`node .harness/scripts/execution-plan.mjs summary <计划>`):
- 已完成: 修正验收脚本中的旧 query-step 路由断言，增加空白创建直达设计用例。
- 运行过的验证: Web typecheck 通过；隔离全栈 240 秒、600 秒两次尝试均因 webServer 启动超时退出。
- 已记录证据:
- 提交记录:
- 已知风险或未解决问题: F14 无浏览器成功证据，不得标 passing 或声称原型验收完成。
- 下一步最佳动作: 机器负载恢复后重跑隔离全栈，逐一修复真实失败，核对桌面和移动截图。

### 2026-09-28 13:30
- 隔离全栈运行进入真实浏览器：首次 3/4 通过，模板创建暴露旧 `/studio/survey/[surveyId]` 服务端入口误用 client-only 链接函数，生产构建抛 TypeError。
- 将纯链接函数移入 server-safe 模块，保留客户端原有导出；再次运行 `FULLSTACK_E2E_SERVER_TIMEOUT_MS=900000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded e2e/survey-complete-flow.spec.ts`，结果 4 passed。
- Web typecheck 退出码 0。修复提交 `362e7fb88`。下一步开 F14 PR，随后按堆叠顺序修复前置 PR CI；保持 blocked 直到各自合入 main。
