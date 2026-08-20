# 会话交接 — Sprint 10/01

## 当前已验证
- **F01**（视角切换器）：`passing`。`pnpm harness verify --sprint 10/01 --feature F01` 5 条 verification 全绿；evidence 见 `evidence/F01.verify.log`。实现在生产组件 `apps/web/components/project/tab-live.tsx`，未合入 main——分支 `worker/usamshen-10-f01-viewer-switcher`，[PR #1665](https://github.com/boardx/workspacex/pull/1665)（`Closes #1654`）待人类合并。

## 本轮改动
- `apps/web/components/project/tab-live.tsx`：新增视角切换器（`ViewerSwitcher`/`GroupPanel`/`computeViewerOptions`），复用真实 `getProjectGrouping` + `useOptionalSession().identity.groupName`，不是新 mock。
- `apps/web/components/project/project-workbench.tsx`：`liveGrouping` 拉取时机扩到「现场协作」tab（原来只在「筹备」tab 拉）。
- `apps/web/tests/ui/project-live-viewer-switcher.test.tsx`：新增 9 个用例。
- `phases/phase-10-live-collaboration-orchestration/feature_list.json`：F01 verification/evidence/notes 从「指向 UI 先行沙盒」改成「指向生产组件与真实测试」，反映实际落点。

## 仍损坏或未验证
- **F02**（服务端角色矩阵）未开工：前端目前只是「不渲染越权选项」，组员改 URL 参数仍可能拿到不该看的数据——这是已知缺口，记在 F02 notes，PR #1665 的说明里也写明了，不是本轮遗漏。
- F03/F04/F05/F06/F07/F08/F09/F10 全部 `not_started`；F04/F09/F10 有跨 phase 硬阻断（见各自 notes），F03 无阻断可直接领。
- 「缺N人」（到场人数）与状态条右上角现场介入告警两个状态后缀仍是 `＊` 占位，等 F05（分组签到）与对应契约落地后再补，本轮未编造。
- PR #1665 尚未合入 main——F03 若要在 main 上继续，需要先确认 PR #1665 已合，否则会在 F01 未落地的分支基础上重复劳动。

## 下一步最佳动作
- 先确认 [PR #1665](https://github.com/boardx/workspacex/pull/1665) 是否已合入 main（`gh pr view 1665 --json state`）。
- 已合入：`git checkout main && git pull`，`pnpm harness claim --phase 10 --feature F03 --owner <owner>`，建分支 `worker/<owner>-10-f03-<slug>` 继续。
- 未合入：不要在此分支上继续叠 F03——F03 是独立 feature，应该从合入后的 main 切新分支，避免把两个 feature 的 diff 混进一个 PR（AGENTS.md「一个 issue 一个 PR」硬约束）。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 10/01`
- 调试:`pnpm --filter web exec vitest run tests/ui/project-live-viewer-switcher.test.tsx --reporter=verbose`
