/*
 * Phase 20 WS02 —— Work Skill 目录行 `skill_catalog_entries`（ADR-117 #3：manifest 不可变、目录行可变）。
 *
 * 契约束 `work-skill-meta`（domain.md SkillCatalogEntry / I-8 / I-14）。本迁移**不改** `skill_versions`
 * 的结构：`metadata.work` 的解析结果写在既有 `skill_versions.manifest` jsonb 的 `work` 子键里。
 *   · 每个 Skill 至多一行（PK org_id, skill_id）；同组织 stable_id 唯一（E2）。
 *   · channel ∈ candidate / verified / deprecated；新行默认 candidate；deprecated 为终态由应用层转移表守（WS03）。
 *   · successor 不得自指（E3 的 DB 兜底；存在性/成环由应用层判）。
 *   · RLS 按 org_id；app_rw 只有 SELECT / INSERT / UPDATE（目录行不物理删除，随 org 级联）。
 *   · 检索：search_document 上 simple 全文索引（内置，不依赖扩展）；trigram 等由 WS03 目录搜索按需追加。
 */
CREATE TABLE IF NOT EXISTS skill_catalog_entries (
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  skill_id           text NOT NULL,
  stable_id          text NOT NULL CHECK (stable_id ~ '^S[0-9]{3}$'),
  domain             text NOT NULL CHECK (length(domain) BETWEEN 1 AND 64),
  channel            text NOT NULL DEFAULT 'candidate'
                       CHECK (channel IN ('candidate', 'verified', 'deprecated')),
  successor_skill_id text,
  search_document    text NOT NULL DEFAULT '',
  updated_by         text NOT NULL,
  updated_at         timestamptz NOT NULL,
  PRIMARY KEY (org_id, skill_id),
  CONSTRAINT skill_catalog_entries_skill_fk
    FOREIGN KEY (skill_id, org_id) REFERENCES skills (id, org_id) ON DELETE CASCADE,
  CONSTRAINT skill_catalog_entries_successor_fk
    FOREIGN KEY (successor_skill_id, org_id) REFERENCES skills (id, org_id),
  CONSTRAINT skill_catalog_entries_successor_not_self CHECK (successor_skill_id IS DISTINCT FROM skill_id),
  CONSTRAINT skill_catalog_entries_stable_id_uniq UNIQUE (org_id, stable_id)
);

CREATE INDEX IF NOT EXISTS skill_catalog_entries_org_domain_channel_idx
  ON skill_catalog_entries (org_id, domain, channel, stable_id);
CREATE INDEX IF NOT EXISTS skill_catalog_entries_search_fts_idx
  ON skill_catalog_entries USING gin (to_tsvector('simple', search_document));

ALTER TABLE skill_catalog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_catalog_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skill_catalog_entries_tenant ON skill_catalog_entries;
CREATE POLICY skill_catalog_entries_tenant ON skill_catalog_entries
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON skill_catalog_entries FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON skill_catalog_entries TO app_rw;
