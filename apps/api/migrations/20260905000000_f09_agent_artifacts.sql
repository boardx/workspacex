-- Phase 14 F09 -- Artifact 领域模型 + 版本化 API（`requirements/04-artifacts-steering.md`
-- R3/R7，`contracts/artifacts-steering/domain.md` I-1～I-4）。
--
-- 两张表，不是一张：`agent_artifacts`（聚合根，name/kind 创建后不变）+
-- `agent_artifact_versions`（有序、创建后追加，不可变）。这面镜像
-- `agent_runs`/`agent_run_steps`（`20260805110000_wave2_agent_run_execution.sql`）已经
-- 用过的形状——同样是"父行不可变 + 子表 append-only"，同样的两道防线（GRANT 只给
-- SELECT/INSERT、trigger 拒绝 UPDATE/DELETE）理由完全相同,这里不重复展开,直接照抄。
--
-- ⚠ 命名 `agent_artifacts`，不是 `artifacts`：`0006-f04-artifact-model.sql` 已经用
-- `artifacts`/`artifact_versions` 命名了 phase-00 的另一个领域概念（项目产出物，
-- 绑定/定版/下游引用那一套）。两者语义完全不同——这里是"agent 一次工具调用产出的
-- 文件，可以基于某个版本继续修改触发新 run"——撞名字只会让人以为是同一张表。

CREATE TABLE IF NOT EXISTS agent_artifacts (
  id          text PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id   text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- 与 `ArtifactKind`（`packages/contracts/src/artifacts-steering.ts`）取值集合一一对应。
  CONSTRAINT agent_artifacts_kind_check CHECK (kind IN ('pdf', 'docx', 'png', 'other'))
);

CREATE INDEX IF NOT EXISTS agent_artifacts_thread_idx
  ON agent_artifacts (org_id, thread_id, created_at, id);

-- I-1：每个版本必须能明确追溯到产生它的 run/step——外键本身就是这条不变量的一部分
-- （字段非空由 NOT NULL 保证，"确实存在"由 FK 保证），不是只在应用层断言。
CREATE TABLE IF NOT EXISTS agent_artifact_versions (
  id                  text PRIMARY KEY,
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  artifact_id         text NOT NULL REFERENCES agent_artifacts (id) ON DELETE CASCADE,
  version             integer NOT NULL CHECK (version >= 1),
  produced_by_run_id  text NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  produced_by_step_id text NOT NULL REFERENCES agent_run_steps (id) ON DELETE CASCADE,
  change_note         text NOT NULL,
  storage_key         text NOT NULL,
  size_bytes          bigint NOT NULL CHECK (size_bytes >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- 服务端计算版本号（当前最大 + 1），这条唯一约束是并发追加时的最后一道闸：
  -- 两次几乎同时的 `continueArtifact` 完成回调都算出同一个"下一个版本号"时，
  -- 后写入的一方撞唯一键失败，而不是悄悄产生两个"version=2"。
  CONSTRAINT agent_artifact_versions_version_uniq UNIQUE (org_id, artifact_id, version)
);

CREATE INDEX IF NOT EXISTS agent_artifact_versions_artifact_idx
  ON agent_artifact_versions (org_id, artifact_id, version);

-- I-2：版本不可变——"继续修改"总是追加新版本，不是原地更新。同
-- `wave2_agent_run_step_append_only()` 的形状：组织级联删除放行，其余一律拒绝。
CREATE OR REPLACE FUNCTION f09_agent_artifacts_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'agent_artifacts rows are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_artifacts_append_only_trg ON agent_artifacts;
CREATE TRIGGER agent_artifacts_append_only_trg BEFORE UPDATE OR DELETE ON agent_artifacts
  FOR EACH ROW EXECUTE FUNCTION f09_agent_artifacts_append_only();

CREATE OR REPLACE FUNCTION f09_agent_artifact_versions_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'agent_artifact_versions rows are append-only (I-2: versions are immutable)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_artifact_versions_append_only_trg ON agent_artifact_versions;
CREATE TRIGGER agent_artifact_versions_append_only_trg BEFORE UPDATE OR DELETE ON agent_artifact_versions
  FOR EACH ROW EXECUTE FUNCTION f09_agent_artifact_versions_append_only();

ALTER TABLE agent_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_artifacts_tenant ON agent_artifacts;
CREATE POLICY agent_artifacts_tenant ON agent_artifacts
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON agent_artifacts FROM app_rw;
GRANT SELECT, INSERT ON agent_artifacts TO app_rw;

ALTER TABLE agent_artifact_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_artifact_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_artifact_versions_tenant ON agent_artifact_versions;
CREATE POLICY agent_artifact_versions_tenant ON agent_artifact_versions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON agent_artifact_versions FROM app_rw;
GRANT SELECT, INSERT ON agent_artifact_versions TO app_rw;

-- 组织冻结策略（合规冻结时禁写），与其余租户表一致。
SELECT kernel_apply_org_freeze_policies();
