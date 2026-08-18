# 进度日志 — Sprint 01/14

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: 无（F950/F960 均已 passing，本 sprint 目标完成）
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

### 2026-08-17（人类要求 + 本会话实现）
- 本轮目标: F960 —— 观察/访谈对象表（F25 已签的应用层编排，此前零 controller、零仓储）
  从「静态痕迹」接上真实 Postgres 的后端半边，补 `getInterviewSubjects` GET 端点（同
  F950/2026-08-16 对 `saveAndSyncTopic`/`updateGrouping` 已获授权的同一条裁决类别的延伸）。
- 已完成:
  - 契约：`packages/contracts/src/templates.ts` 新增 `getInterviewSubjects`
    （`GET /projects/:projectId/groups/:groupId/interview-subjects` → `{subjects, revision}`），
    `updateInterviewSubjects` 形状未改一个字段。
  - 数据库：新迁移 `apps/api/migrations/20260817090000_f960_interview_subjects_table.sql`
    （`project_group_interview_subjects` + `project_group_interview_subjects_revision` 两张
    新表——刻意不叫 `interview_subjects`，那个名字已被 F97/06-itv 束占用，见迁移头注；
    补装项目归档冻结 + 组织停用冻结两套既有策略）。
  - 后端：`application/templates/interview-subjects-ports.ts`（加 `orgId` + `getSubjects`）+
    `get-interview-subjects.ts`（新用例）+ `update-interview-subjects.ts`（改签名）+
    `infrastructure/templates/pg-interview-subjects-repository.ts`（新，整批替换语义 +
    `pg_advisory_xact_lock` 序列化首次写入这个 `FOR UPDATE` 锁不住的特例）+
    `interface/controllers/blueprint.controller.ts`（补 PUT/GET 两条路由 + 角色查询复用
    `identity.findProjectMembership`）+ `kernel.module.ts`（1 个新 DI provider）+
    `scripts/lint-permission-paths.mjs`（白名单 60→61，理由同 F185 的「actor 自己的写/读」豁免）。
  - 前端：**明确不动**——`tab-prep.tsx` 的分组卡片本身仍在用 mock groupId（真实 groupId
    要等 F950 的 `getProjectGrouping` 先合入 main），访谈对象表嵌在组卡内没有真实 groupId
    就没法做出真实（非伪造）的前端接线，同 `design-signoff.md` 里 F175/BP-01「纯后端、
    界面留待后续」的先例，已在 `feature_list.json` notes ④ 如实记录范围边界。
- 运行过的验证: F960 全部 4 条 verification + 高风险档 `pnpm -w run verify:release`
  （全仓 typecheck/lint/test，因触碰 `migrations/**`/`packages/contracts/**` 被判 high_risk）。
- 已记录证据: `evidence/F960.verify.log`。
- 提交记录: 见本次 PR（branch `worker/dev-project-01-fsubjects`）。
- 已知风险或未解决问题:
  - 前端接线是下一个 feature 的活，依赖 F950（PR #1482，已 CI 全绿、`mergeable: MERGEABLE`，
    尚待人类合并）先落地——F950 落地后，`tab-prep.tsx` 的组卡才有真实 `groupId` 可用。
  - `hashtextextended` advisory lock 的 key 用字符串前缀 `interview-subjects:${groupId}`
    区分命名空间，未与仓库里其它用同一 hash 函数的锁（skill/asset 等）核对过是否会
    哈希碰撞——`hashtextextended` 是 64 位哈希，碰撞概率可忽略，未来若要更严谨可以
    改用两参数 `pg_advisory_xact_lock(classid, objid)` 形式再收紧一次，本次未做。
- 下一步最佳动作: project 域下一个候选——① F950（PR #1482）合并后，把访谈对象表接进
  `tab-prep.tsx` 组卡（含前端组件测试）；② PJ-12 蓝本发布版本端点；③「现场协作」
  「成果沉淀」「待办」三个 tab 连契约都没有，需要走完整的 requirements → 契约设计 →
  人类签核流程。
