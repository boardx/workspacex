# 会话交接 — Sprint 10/03

## 当前已验证
- **F02**（角色可见性服务端矩阵）：`passing`，[PR #1734](https://github.com/boardx/workspacex/pull/1734)（`Closes #1688`）待人类合并。

## 本轮改动
- `packages/contracts/src/viewer-role.ts`：新增独立端点 `getViewerOptions` 契约（zod 单一事实源）。
- `apps/api/src/application/live-collab/get-viewer-options.ts`：服务端角色收窄纯函数。
- `apps/api/src/interface/controllers/blueprint.controller.ts`：新增路由。
- `apps/web/lib/live-collab-viewer-role.ts` + `tab-live.tsx`/`project-workbench.tsx`：前端接线。
- 修复仓库级契约文档缺口（third-artifact-map.json、5 个契约束的 domain.md/coverage.md）+ 两处 `lint-contract-source.mjs` 抓到的手写类型重复定义。

## 仍损坏或未验证
- `?viewer=` URL 参数尚未驱动 `requestedViewerId`。
- 观察者对分组转写/对话详情的拒绝不在本 feature 范围。
- F04/F06/F07/F08/F09/F10 仍 `not_started`，各自阻塞见 `feature_list.json` notes。

## 本轮踩过的坑（下一轮接手请先读）
1. **sprint 编号撞车**：F02 与 F05 两个并行 agent 各自新建了 sprint-02，一个给 F02 一个给 F05。已裁决：sprint-02 归 F05（先合入 main），F02 挪到 sprint-03。以后并行开工前先约定 sprint 号，或谁先合入谁保留原号。
2. **ui-material-map.json 的 phase-10 缺口被两边并行修复**：我在 F02 分支手动修（移动截图目录 + reuse_bundle），同时人类/另一个进程在 main 上用更好的方案（`shared_dir` 机制）独立修了并合入。合并时发现后**采纳了 main 的版本，撤销了自己的**——先 `git fetch && git log --oneline -- <file>` 确认某个"缺口"是不是已经有人在修，不要闷头做。
3. **机器负载会假装是代码问题**：push/verify 连续 3 次撞上 `Connection terminated unexpectedly`（PG 连接中断），1分钟负载均值一度到 65+。诊断方法：`uptime` 查负载、`top -o cpu` 看是不是真的有失控进程（这次没有，是合法的多 agent 并发）。处置：不要 `--no-verify` 硬推，等负载 <10 再重试；用 `pnpm harness sweep-docker --apply` 清理"自己名下"的孤儿栈（不动别人的活跃 worktree）。
4. **`lint-contract-source.mjs` 扫描 `apps/api/src` 全目录**：新建任何与契约同名的类型（哪怕是通过索引访问间接派生的，比如 `X["field"][number]`），只要不是 `z.infer<typeof C.X>` / `C.X` / 直接引用 `@repo/contracts` 这三种形式，都会被判定为"手写重复定义"。写新契约消费代码时，类型直接从契约 `z.infer` 派生，不要自己拼。

## 下一步最佳动作
- 确认 PR #1734 合入 main 后，viewer-role 束（F01+F02）全部完成。
- 下一个可做：F06（group-checkin 束续做，`depends_on: [F05]`，F05 已合入可以开工）或 F04（跨 phase-01 契约变更，先确认对方接不接）。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 10/03`
- 调试:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/live-collab/get-viewer-options.test.ts --reporter=verbose`
