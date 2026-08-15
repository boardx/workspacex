# 会话交接 — Sprint 05/01

## 当前已验证
- F01 尚未经过 harness 状态门控；实现级验证已通过：三套目标 UI 测试（38/38）、`pnpm --filter web run typecheck`、`pnpm --filter web run lint:design`。

## 本轮改动
- `/research` 列表首页增加与 `/rec` 一致的内容容器、页头、历史卡片网格和空/错态密度。
- `/itv` 列表首页增加与 `/rec` 一致的内容容器、页头、筛选密度、历史卡片、标签和空态。
- `/itv` 创建弹窗的名称、标签区域和底部操作区与 `/research`、`/rec` 对齐；创建与跳转逻辑未变。

## 仍损坏或未验证
- 无已知问题；仍需执行 `pnpm harness verify --sprint 05/01 --feature F01`、提交、推送并创建关闭 #1258 的 PR。

## 下一步最佳动作
- 在当前 worktree 的 `worker/codex-05-studio-style-unification` 分支完成 F01 门控和 PR；不要修改 `main`，不要修改创建、筛选、API、路由或权限逻辑。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 05/01`
- 调试:`pnpm --filter web exec vitest run tests/ui/guided-research-home-live.test.tsx tests/ui/interview-studio-home.test.tsx tests/ui/personal-transcription-history.test.tsx`
