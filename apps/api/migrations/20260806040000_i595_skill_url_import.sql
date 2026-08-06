-- #595 段 2 —— URL 导入的幂等台账。
--
-- 与 `starter_pack_imports` 分开一张表，而不是塞进它：那张表的语义是
-- 「按 packId/packVersion 从注册源导入」，主键语义、失败码集合、审计字段都不同。
-- 合表会让两种导入共用一组 CHECK，而它们的合法状态集并不相同。
--
-- ⚠ 本迁移**不新建** skills / skill_versions / skill_version_files —— URL 导入的
--   产物落在**模型 A 既有的那三张表**上（运行时唯一真读的那套）。这里只记
--   「哪个 idempotencyKey 产出了哪个版本」，好让重复提交回放而不是重复落库。
--
-- ⚠ A/B 模型不收敛（`skill_contracts` 那套与本套互不连通）登记在 #598，本轮不收敛。

CREATE TABLE IF NOT EXISTS skill_url_imports (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  -- 取回**完成后**的最终 URL（重定向可能换了地址）；审计要的是真正读了哪里。
  source_url      text NOT NULL,
  content_digest  text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  skill_id        text NOT NULL,
  version_id      text NOT NULL,
  actor_id        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_url_imports_idem_uniq UNIQUE (org_id, idempotency_key),
  CONSTRAINT skill_url_imports_skill_fk FOREIGN KEY (skill_id, org_id)
    REFERENCES skills (id, org_id) ON DELETE CASCADE,
  CONSTRAINT skill_url_imports_version_fk FOREIGN KEY (version_id, org_id)
    REFERENCES skill_versions (id, org_id) ON DELETE CASCADE
);

ALTER TABLE skill_url_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_url_imports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skill_url_imports_tenant ON skill_url_imports;
CREATE POLICY skill_url_imports_tenant ON skill_url_imports
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON skill_url_imports FROM app_rw;
GRANT SELECT, INSERT ON skill_url_imports TO app_rw;

-- 与 wave2 那张迁移同理：冻结策略只看得见运行时已存在的表，加完新租户表要重放一次。
SELECT kernel_apply_org_freeze_policies();
