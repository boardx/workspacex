# #5948 — develop 完整回归的颜色基线修复

2026-10-27，用户报告 run [40485490214](https://github.com/boardx/workspacex/actions/runs/40485490214) 的 `full-regression-core` 失败。基线为最新 `origin/develop@35e71c4e5243574ed1b264f8d13daf679f75db5c`，复用 e435 worktree。

## 真实失败点

从已结束 job `122129642245` 的日志中读取（整个 workflow 当时仍有 chat-read 运行，因此不能用 workflow 是否结束代替 job 状态）：

```text
2026-10-27T10:24:45.9252355Z > lint:tailwind-color-tokens
2026-10-27T10:24:46.0429815Z ❌ [tailwind-color-tokens] 颜色类名对不上 token：
2026-10-27T10:24:46.0431963Z components/itv/interview-outline-step.tsx 的 text-foreground 已降到 0 处（基线写着 1）——把 LEGACY 里的数字改小，别让它虚高
2026-10-27T10:24:46.9637144Z Process completed with exit code 1.
```

本地直接运行 `pnpm run lint:tailwind-color-tokens`，得到相同诊断与 exit 1。当前源码没有该非法颜色；该组件最近修改为 `d98613266`（#5893）。本次支付 UI 变更未改组件或此基线。

## 最小修复与验证

仅删除 `LEGACY` 中已清零的这一条，不修改检查算法、扫描范围或失败条件。未来该文件若再次出现非法颜色，将作为未登记的新增问题被拦住。

- 修复后 `pnpm run lint:tailwind-color-tokens`：exit 0，存量基线 42 处。
- `pnpm exec vitest run .harness/scripts/lint-tailwind-color-tokens.test.ts --maxWorkers=1 --minWorkers=1`：10 tests passed（包含坏 token、跨行扫描、存量增长及虚高基线的反证）。
- `git diff --check`：exit 0。

原失败 workflow/截图不代表支付专项失败，也不表示完整回归已恢复。完整 base lane 需要在修复后的 SHA 重新执行；PR 目标为 develop，未改写 main/develop 历史、未直接提交到共享分支。
