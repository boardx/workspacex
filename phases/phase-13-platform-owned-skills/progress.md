# 进度日志 — Phase 13 platform-owned-skills

## 当前已验证状态(唯一真相)
- 仓库根目录: /private/tmp/wsx-platform-skills（worktree，分支 worker/usamshen-01-platform-skills）
- 标准启动路径: `./init.sh`
- 标准验证路径: `pnpm --filter @repo/api run typecheck` / `node .harness/scripts/lint-arch-deps.mjs apps/api/src` / `node apps/api/scripts/lint-permission-paths.mjs` / `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/skill/ tests/agent-runtime/ tests/chat/ tests/canvas/`
- 当前最高优先级未完成功能: 无 F 号（design-delta 已签核，尚未走 requirement-author 生成正式 feature_list.json 条目——本轮直接按签核 delta 实现，跳过了 new-sprint 流水线，同 F979 先例）
- 当前 blocker: 无

## 会话记录
### 2026-08-27（本轮）
- 本轮目标: 实现已签核的 design-delta `platform-owned-skills`——四个官方 skill
  （pptx-create/docx-create/xlsx-create/pdf-create）对所有 org 默认可见/可挂载/可执行。
- 已完成:
  - `PLATFORM_ORG_ID` 从 `domain/canvas/platform-org.ts` 挪到 `domain/org-id.ts`（re-export 保留兼容）。
  - 新迁移 `20260827200000_platform_owned_skills.sql`：四张表各加 `_platform_read` SELECT 策略。
  - 查询层五处加 `OR org_id = PLATFORM_ORG_ID`：`pg-skill-contract-repository.ts`
    （`listAll`/`loadMountableRow`）、`pg-agent-run-repository.ts`（`readPinnedSkills`）、
    `pg-capability-repository.ts`（`listByKind`/`listAll`/`findById`）、
    `pg-thread-mounted-skill-reader.ts`（`activeMountedSkillVersionIds`——**真栈测试
    才发现的第五处，contract.md 已补记**，见下方「已知风险」）。
  - `apps/api/scripts/office-docs-skill-content.ts` 新增 `PPTX_CREATE_SKILL_MD`（原创撰写）。
  - `apps/api/scripts/backfill-platform-skills.ts`（新增，幂等，人工触发）。
  - `apps/api/tests/skill/platform-owned-skills-real-stack.test.ts`（新增，V1-V6 真栈门控，9/9 通过）。
  - 修复 3 个既有测试文件的 4 处断言（`skill-contract-crud.test.ts` ×3、
    `list-skills-includes-wave2-imports.test.ts`、`list-skills-org-membership.test.ts`）
    ——它们假设"新 org 的 skill 列表恒为空/恒等于自己种的那几条"，本 delta 之后这个
    假设不再成立（平台官方 skill 现在对所有 org 可见），过滤掉平台条目后断言逐字照旧。
- 运行过的验证:
  - `pnpm --filter @repo/api run typecheck` → 0 error
  - `node .harness/scripts/lint-arch-deps.mjs apps/api/src` → ✅ 1061 files
  - `node apps/api/scripts/lint-permission-paths.mjs` → ✅ 1063 files
  - `tests/skill/` 全量 → 218 passed / 5 skipped / 0 failed
  - `tests/agent-runtime/` `tests/chat/` `tests/canvas/` → 跑中（见下一轮 session-handoff）
- 已记录证据: 见上方验证命令的真实输出（本会话终端记录）。
- 提交记录: 尚未提交——design-delta 相关文档已提交并推送（commit 9e98aabe，
  分支 `worker/usamshen-01-platform-skills`）；本轮代码改动尚在 worktree 里未 commit。
- 已知风险或未解决问题:
  - **真实生产影响**：一旦 `backfillPlatformSkills()` 在某个真实环境跑过，那个环境
    里**任何** org 的 skill 列表从此不再可能是"完全空"——这是设计本意，但如果有
    前端 empty-state 文案假设"skill 列表为空 = 显示引导导入"的 UI 分支，需要人工
    确认这条 UI 逻辑在有平台 skill 时依然表现合理（本 delta 范围只在后端，未检查
    `apps/web` 侧的空态渲染逻辑）。
  - `tests/agent-runtime/`/`tests/chat/`/`tests/canvas/` 的完整回归结果尚未拿到
    （机器负载高，命令跑到后台，下一轮开工先看这三个目录有没有同类"假设空列表"的
    断言需要同样方式修）。
- 下一步最佳动作: 确认 agent-runtime/chat/canvas 三个目录全绿后，跑 backfill 脚本
  的真实调用验证 + 完整 verify（typecheck/lint/test）过一遍，commit、push、开 issue
  + PR（Closes 该 issue），PR 正文如实记录"真栈测试发现的第五处遗漏"这个真实过程。
