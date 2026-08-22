-- 修复：`applyBlueprint`（F23 / #1667）真实回归——`blueprint_bindings` 从建表起
-- （0814，`20260814080000_f179_blueprint_versions_and_bindings.sql`）就只
-- `GRANT SELECT, INSERT`，从未 `GRANT UPDATE`。`20260821090000_i1667_apply_blueprint_infra.sql`
-- 给这张表补了 `project_id`/`version_id` 两列，`PgApplyBlueprintRepository.apply()` 里
-- 用 `UPDATE blueprint_bindings SET project_id = $1, version_id = $2 ...` 回填它们——
-- 这是本仓第一处、也是唯一一处 UPDATE 这张表的调用方，但 GRANT 从未跟上。
--
-- 真实症状：`POST /blueprints/:id/apply` 在角色/可见性/版本三道门槛都通过后，
-- 卡在这条 UPDATE 上抛 `permission denied for table blueprint_bindings`
-- （Postgres `42501`），NestJS 全局异常过滤器把它当未识别异常，回 500——
-- fullstack-smoke 的 `blueprint-contract-gap-audit.spec.ts` F23 用例因此持续红，
-- 拦住了此后每一个 PR（实测：直接调试打印原始异常抓到的，见 issue 里的复现记录）。
--
-- ⚠ 只授权 `project_id`/`version_id` 两列的列级 UPDATE，不放开整表 UPDATE——
--   本迁移之后唯一的调用方（`pg-apply-blueprint-repository.ts` 那条 UPDATE）
--   只碰这两列，其余列（`blueprint_id`/`kind`/`created_at`）没有任何写路径需要改，
--   列级授权收窄攻击面，出现第二个改别的列的调用方时应该重新评审，不是顺着这条口子进来。
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'blueprint_bindings' AND column_name = 'project_id'
  ) THEN
    GRANT UPDATE (project_id, version_id) ON blueprint_bindings TO app_rw;
  END IF;
END $$;
