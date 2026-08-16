# 进度日志 — Sprint 01/14

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: 无（F950 已 passing，本 sprint 目标完成）
- 当前 blocker: 无

## 会话记录
### 2026-08-16（人类要求 + 本会话实现）
- 本轮目标: F950 —— 项目筹备「定题与分组」从 mock 接上真实 Postgres（F24/F25 签的契约
  第一次真正落库），补 `getProjectTopic`/`getProjectGrouping` 两条读端点 + `Group.memberUserIds`
  字段（均为 2026-08-16 delta，人类会话中直接授权，非推翻已签设计）。
- 已完成:
  - 契约：`getProjectTopic`（`GET /projects/:projectId/topic`）、`getProjectGrouping`
    （`GET /projects/:projectId/grouping`）新增；`templates.Group` 加 `memberUserIds: string[]`。
  - 数据库：新表 `project_topics`（1:1 定题）、`project_grouping_revision`（整批分组的
    乐观锁版本，独立于 `groups`/`projects`）；`groups` 加 `scenario`/`status` 两列；
    补装两套既有冻结策略（issue #342 项目归档冻结 + F22 组织停用冻结）——
    `migrate:check`/`verify-rls.sh` 两条门各踩了一次这类「新表忘了调用安装函数」的坑，
    都是复用现成的 `kernel_apply_*_policies()`，不是新发明机制。
  - 后端：三个新仓储（`pg-project-topic-repository.ts` / `pg-grouping-repository.ts` /
    `pg-project-prep-repository.ts`）+ 两个新用例 + 五条路由挂在 `blueprint.controller.ts`。
    组长/组员复用既有的 `project_memberships.group_id`/`project_role` 关联边，不新造列。
  - 前端：`lib/live-project-prep.ts` 新建；`tab-prep.tsx` 定题/分组从 mock 换真实读写
    （带内联编辑、并发冲突提示）；`project-workbench.tsx` 传参同既有 `liveSegments` 模式。
  - 顺带修了一个真 bug：`GroupingBlock` 组件里 `useEffect` 依赖整个 `session` 对象
    （而不是 `session?.currentOrgId`）导致组件测试跑出 OOM（无限重渲染循环）——
    如果没写组件测试，这个 bug 会直接进生产。
  - 顺带发现并修了一个与本 feature 无关的仓库基线问题：`lint:rewrite-coverage` 在
    干净 main 上已经是红的（`/feedback` 系列路由缺 rewrite + `assets` 棘轮豁免已过期），
    独立开了 hotfix PR #1473，同时把同一个两行修复也带进本分支（两边任一先合入，
    另一边 rebase 会自然去重，不是新增冲突）。
- 运行过的验证: F950 全部 14 条 verification + 高风险档 `pnpm -w run verify:release`
  （全仓 typecheck/lint/test）。
- 已记录证据: `evidence/F950.verify.log`。
- 提交记录: 见本次 PR（branch `worker/dev-project-01-f186`）。
- 已知风险或未解决问题:
  - `pg-grouping-repository.ts` 的已知限制：组长/组员写入只更新已存在
    `project_memberships` 行的用户，不会把从未加入项目的用户静默拉进项目——
    这不是缺陷，是刻意不越权代劳 `addProjectMember`（F125）的职责，但前端提交成功
    不代表「这个人一定进了组员名单」，见 `pg-grouping-repository.ts` 文件头详述。
  - 访谈对象（`InterviewSubject`）、议程三角色分工表本次不动，留给各自后续 feature。
  - hotfix PR #1473（rewrite-coverage）需要人类审核合并；本分支已带同一份修复，
    不阻塞本 feature，但两个 PR 应尽量按合入顺序 rebase 一次确认无残留冲突。
- 下一步最佳动作: project 域可选的下一步——① 访谈对象读写接线；② PJ-12 蓝本发布版本
  端点（解锁新建项目真正套用蓝本）；③ 「现场协作」「成果沉淀」「待办」三个 tab
  连契约都没有，需要走完整的 requirements → 契约设计 → 人类签核流程，不是简单接线。
