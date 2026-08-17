# 进度日志 — Sprint 01/14

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: 无（F960 已 passing，本 sprint 目标完成）
- 当前 blocker: 无

## 会话记录
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
