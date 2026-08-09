-- #363 收拢 + 组织资料编辑（org-profile-membership delta，contract.md §3）。
--
-- 三件事：
--   ① organizations 加 avatar_artifact_id / description —— 组织资料编辑的落点。
--   ② org_memberships 加 joined_at —— listOrgMembers.out.joinedAt 需要它，
--      0003 建表时没有这一列。回填为本迁移执行时刻：真实入会时间在此之前不可考，
--      这是一处诚实缺口，不是精确值（见 org-admin.ts KNOWN_CONTRACT_GAPS.OA11 ③）。
--   ③ 新表 org_avatar_artifacts —— uploadOrgAvatar 落对象存储后的归属登记，
--      updateOrganization 用它做 AVATAR_ARTIFACT_NOT_OWNED 校验（同组织才能引用）。
--      头像字节本身在对象存储，这张表只存指针 + 校验用的元数据，同 artifacts/
--      artifact_versions 的「PG 元数据 + 对象存储字节」分工，但刻意不复用那两张表——
--      它们的 `source` 枚举、`project_id` 语义都是为项目材料设计的，头像不是材料。
--
-- Replayable：全部 IF NOT EXISTS，migrate:check 会忽略版本表重放每个文件。

/* ─────────────────────────── ① organizations ─────────────────────────── */

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS avatar_artifact_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'organizations'::regclass AND conname = 'organizations_description_len'
  ) THEN
    -- 纯文本上限 500（delta §1 逐字：「超出前端裁断言，不是产品上限的裁决点，属工程默认」）。
    -- 服务端仍加一条防线——contract 的 zod .max(500) 只挡住走 controller 的写路径，
    -- 直接对库写入的路径（迁移脚本、未来的批处理）不该因此免于同一条上限。
    ALTER TABLE organizations ADD CONSTRAINT organizations_description_len CHECK (
      description IS NULL OR char_length(description) <= 500
    );
  END IF;
END $$;

/* ─────────────────────────── ② org_memberships ─────────────────────────── */

ALTER TABLE org_memberships ADD COLUMN IF NOT EXISTS joined_at timestamptz;
UPDATE org_memberships SET joined_at = now() WHERE joined_at IS NULL;
ALTER TABLE org_memberships ALTER COLUMN joined_at SET NOT NULL;
ALTER TABLE org_memberships ALTER COLUMN joined_at SET DEFAULT now();

/* ─────────────────────────── ③ org_avatar_artifacts ─────────────────────────── */

CREATE TABLE IF NOT EXISTS org_avatar_artifacts (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 对象存储里的键，字节真身住在那儿，这里只存指针（同 artifacts 表的分工）。
  object_key   text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5 * 1024 * 1024),
  sha256       text NOT NULL,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_avatar_artifacts_org_idx ON org_avatar_artifacts (org_id);

-- RLS：同 0003/0022 的既有形状——租户表一律 ENABLE + FORCE + 单条 org_id 策略。
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_avatar_artifacts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
  END LOOP;
END
$$;

-- F22 停用冻结：`kernel_apply_org_freeze_policies()` 按 catalog（org_id 列 + 指向
-- organizations 的外键）自动推导，新表建好后调一次即可把它纳入（0022 迁移文件头的先例）。
SELECT kernel_apply_org_freeze_policies();
