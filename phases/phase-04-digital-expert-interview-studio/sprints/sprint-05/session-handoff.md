# 会话交接 — Sprint 04/05

## 当前已验证
- F05 指定验证均通过：API `digital-interview-runs.test.ts` 1/1；Web `interview-runs.test.tsx` 1/1。
- F04 回归通过：API 6/6；Web F04+F05 16/16；contracts/API typecheck 通过。
- F05 尚未 passing：`verify:release` 被与本 feature 无关的 readiness 陈旧关闭 issue #2307 拦截。

## 本轮改动
- 新增专家运行表与 RLS/授权；确认问题后创建 durable running 行并异步并行调用模型。
- 模型提示注入专家姓名、角色、领域和各自问题；完成/失败按专家独立落库。
- workflow GET 恢复运行记录；第 4 步轮询并展示专家进度、问题和回答。

## 仍损坏或未验证
- `pnpm harness verify --sprint 04/05 --feature F05` 的 feature 验证通过，但 release 基线失败于 `lint:readiness`：队列包含已关闭 issue #2307。
- F05 完整契约中的“仅重试失败专家”和结构化观点/理由/引用层级仍需后续 slice；本 PR 解决用户当前“确认后为空”的主链。

## 下一步最佳动作
- 先由 coord-main 修复 readiness 的陈旧 #2307 投影并重跑 harness verify；随后 review/合入 #2393 对应 PR。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 04/05`
- 调试:`pnpm --filter web exec vitest run tests/ui/interview-runs.test.tsx`
