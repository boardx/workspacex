# 进度日志 — Sprint 01/11

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: 无（F185 已 passing，本 sprint 目标完成）
- 当前 blocker: 无

## 会话记录
### 2026-08-16 02:xx（人类实时裁决 + 本会话实现）
- 本轮目标: F185 —— listProjects 扁平化返回（推翻 2026-07-30 Q-6①B 两段式）+ 项目标签（tags）+ 列表页卡片/列表视图切换。
- 已完成:
  - 裁决覆盖记录：`requirements/00-project/OPEN-QUESTIONS.md`「🔁 2026-08-16 delta」、`contracts/project/usecases.md` UC-P2/UC-P2b、`contracts/project/ui.md` 过期提示、`contracts/project/design-signoff.md` covers 追加 F185（如实标注是 delta 不是「无新设计面」的接线追加）。
  - 契约：`packages/contracts/src/project.ts` `listProjects.out` 改扁平数组，`ProjectListItem` 加 `tags`，新增 `updateProjectTags` 操作、`PROJECT_NOT_FOUND` 码。
  - 后端：发现 `projects` 表列集合是 I-P33 封闭清单（5 列），不能直接加 `tags` 列——改为新建 `project_tags` 独立表（迁移 `20260816000000_f185_project_tags.sql`），新增 `pg-project-tags-repository.ts` + `update-project-tags.ts` 用例 + controller 路由 + DI 注册；`list-projects.ts` 按 id 去重合并 member/managed；`lint-permission-paths.mjs` 新增白名单第 57 条 + 更新既有 F122 条目文案；`permission-propagation-six-paths.test.ts` 上限 56→57。
  - 前端：`projects-screen.tsx` 去掉两段式渲染，加标签筛选 chips + 卡片/列表视图切换（localStorage）+ 标签增删（整体替换语义）；`live-projects.ts`/`project/live/page.tsx`/`template-apply-dialog.tsx` 同步扁平数组。
  - 测试：新增/改写 `list-projects-flat.test.ts`（原两段式测试改名重写）、`list-projects-repo-shape.test.ts`（5 键→6 键、3 表→4 表）、`update-project-tags.test.ts`、`tags-repo-guard.test.ts`；前端 `projects-screen-live.test.tsx`/`project-live-page.test.tsx`/`project-overview-live-info.test.tsx` 同步。
- 运行过的验证: F185 全部 14 条 verification 命令 + 高风险档 `pnpm -w run verify:release`（全仓 typecheck/lint/test，990+5365+1258 测试全绿）。
- 已记录证据: `evidence/F185.verify.log`。
- 提交记录: 见本次 PR（branch `worker/dev-project-01-f185`，Closes #1392）。
- 已知风险或未解决问题:
  - `contracts/project/ui.md` A 节 9 张两段式截图已过期，本次未重拍（重拍属于第 ① 件材料正式重签，未来若要重签第 ① 件材料需要一并处理）。
  - 「编辑项目」多 tab 页换真实数据源、新建项目套用已发布蓝本版本（PJ-12，依赖蓝本发布版本端点，见 `new-project-flow.tsx` 头注 #991）不在本次范围，是后续独立 feature。
  - 发现一处 pre-existing 基线问题（与本 feature 无关）：全新 worktree 里 `packages/fabric-markdown/dist` 未构建时 `apps/api` typecheck 会报 124 个幽灵 DOM 类型错——需要先跑 `pnpm --filter @repo/fabric-markdown run build`。已在本地会话记忆里记录，未改动仓库本身（不在本 feature 范围）。
- 下一步最佳动作: 无遗留工作在本 sprint；下一个 project 域 feature 建议是「编辑项目多 tab 真实数据源接线」或「PJ-12 蓝本发布版本端点」。
