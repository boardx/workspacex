# 会话交接 — Sprint 10/01

## 当前已验证
- **F01**（视角切换器）：`passing`，已合入 main（[PR #1665](https://github.com/boardx/workspacex/pull/1665)，`Closes #1654`）。
- **F03**（环节状态条现场呈现 + 分组视角一致展示）：`passing`，[PR #1682](https://github.com/boardx/workspacex/pull/1682)（`Closes #1658`）待合入（提交时已跟当时最新 main 无冲突，push 前 turbo affected 173 文件/1484 用例全绿）。

**sprint-01 的两个 feature 到此都做完了。** 下一轮不用回这个 sprint，除非要给 F01/F03 打补丁。

## 本轮改动（F03 这一段）
- `apps/web/tests/ui/project-live-segment-engine-consistency.test.tsx`：新增 3 个用例，验证「切 F01 视角切换器不会让状态条重建/换数据源」。
- `phases/phase-10-live-collaboration-orchestration/feature_list.json`：F03 的 verification/evidence 从「指向 UI 先行沙盒 `orchestration-preview.tsx`」改成「指向生产组件 `tab-live.tsx` 与真实测试」。
- 没有新增渲染逻辑——F01 落地时状态条已经是无条件渲染，这轮只是补验证。

## 仍损坏或未验证
- **F02**（服务端角色矩阵）未开工：组员改 URL 参数仍可能拿到不该看的数据，见 F02 notes。
- F04/F09/F10 有跨阶段硬阻断（分别依赖 phase-01 议程束新增字段、phase-02 知识图谱/看板契约束签核）。
- F06/F07/F08 依赖各自前置 feature（F05/F01/F07）。
- 「缺N人」到场人数、状态条「需介入」现场告警两个字段仍是 `＊` 占位。
- 观察此仓库负载：F03 那次 push 前 turbo affected 跑了 3m11s（F01 那次只要 31s），只是变慢没失败——如果下一轮再明显变慢或开始超时，先看机器负载（`uptime`）再判断是不是要等一等，不要一上来怀疑自己的代码。

## 下一步最佳动作
- 确认 [PR #1682](https://github.com/boardx/workspacex/pull/1682) 是否已合入 main（`gh pr view 1682 --json state`）。
- 已合入：`git fetch origin main && git reset --hard origin/main`（在一个新分支上，不要在旧的 F01/F03 分支上继续叠），然后二选一：
  - `pnpm harness claim --phase 10 --feature F02 --owner <owner>`：继续 viewer-role 束，做服务端角色矩阵（依赖 F01，F01 已合入可以开工）。
  - 开新 sprint `pnpm harness new-sprint --phase 10 --id 02 --features F05 --goal "..."` 再 claim F05：group-checkin 束已签核、零依赖，可以完全独立并行推进。
- 两条路都不冲突任何硬阻断，选哪个看谁接手、想先补哪一块。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 10/01`
- 调试:`pnpm --filter web exec vitest run tests/ui/project-live-segment-engine-consistency.test.tsx --reporter=verbose`
