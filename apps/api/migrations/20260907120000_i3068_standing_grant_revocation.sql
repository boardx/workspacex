-- issue #3068 —— 「以后都允许」（`scope='forever'`）此前没有任何撤销路径：
-- `tool_permission_grants` 在 F06 的迁移
-- （`20260905120000_f06_tool_permission_tiering.sql`）末尾逐字写着
--
--   > 只增不改不删：授权记录本身是审计留痕（R9）…撤销/管理不在本 phase 范围（R6 不包含）
--   > ——没有 UPDATE/DELETE 授权即是这个纪律在权限层面的落地。
--
-- 而 `tool-permission-card.tsx` 给用户看的原话是「可在下次弹出时改选拒绝以撤销」——
-- 组织级授权一旦落下，那个弹层再也不会出现，这句话承诺的撤销方式在结构上不可能发生。
-- 一次点击 = 永久且不可达。coordinator 在 #3068 裁决 C1：加撤销路径。
--
-- ⚠ 顺带修一个此前从未生效的既有路径：F11 的 `revokeAllForRun`
-- （`pg-tool-permission-grant-repository.ts`，插话导致方向性改变时整体撤销本 run 授权）
-- 发的是 `DELETE`，而 app_rw **从来没有 DELETE 权限**——那条撤销在真库上一定抛
-- `permission denied for table tool_permission_grants`。它此前只有内存替身覆盖，
-- 所以没有任何门控看见过。本迁移一并补上。
--
-- 审计留痕怎么办：撤销**不是**把历史抹掉——`tool_permission_revocations` append-only
-- 记下"谁在何时撤销了哪条组织级授权、那条授权当初是谁批的"，R9 的可审计性因此比
-- 「不许删」更强，而不是更弱（不许删换来的是一个永远收不回的权限）。
CREATE TABLE IF NOT EXISTS tool_permission_revocations (
  id                   text PRIMARY KEY,
  org_id               text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  grant_id             text NOT NULL,
  tool_name            text NOT NULL,
  granted_by_user_id   text NULL,
  granted_at           timestamptz NOT NULL,
  revoked_by_user_id   text NOT NULL,
  revoked_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tool_permission_revocations_org_idx
  ON tool_permission_revocations (org_id, revoked_at DESC);

ALTER TABLE tool_permission_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_permission_revocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tool_permission_revocations_tenant ON tool_permission_revocations;
CREATE POLICY tool_permission_revocations_tenant ON tool_permission_revocations
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON tool_permission_revocations FROM app_rw;
-- 只增不改不删——这张表本身才是那条纪律真正的落点。
GRANT SELECT, INSERT ON tool_permission_revocations TO app_rw;

-- 授权表本身现在需要 DELETE：撤销即删除那一行（生效判断只看 `tool_permission_grants`
-- 是否有行，留一列 `revoked_at` 会让 `hasGrant` 的谓词多一条永远要记得带的条件——
-- 忘带就是"撤销了却仍然放行"，那是最糟的失败方向）。留痕在上面那张表。
GRANT DELETE ON tool_permission_grants TO app_rw;

SELECT kernel_apply_org_freeze_policies();
