-- #459: storage for **declarative-contract Skills** (contract bundle `skills`, F61/F62/F66).
--
-- ## Why new tables instead of extending `skills`
--
-- `20260804031000_wave2_skill_starter_import.sql` built `skills` / `skill_versions` for the
-- **file-package** model (#412): a Skill is a directory of files with exactly one root
-- `SKILL.md`, published through `wave2_publish_skill_version()`. That shape cannot hold a
-- declarative-contract Skill, and the mismatch is structural, not cosmetic:
--
--   * `skills.status CHECK (status IN ('enabled','disabled'))` (:12) cannot hold the
--     lifecycle states this bundle needs (`草稿` / `待审核` / `已启用` / `已停用`).
--   * there is no `duty` / `source` / `visibility` / current-version column;
--   * `skill_versions` has no `state`, and `app_rw` is granted no UPDATE on it, so the only
--     write path is `wave2_publish_skill_version()`, which *requires* a root `SKILL.md`.
--
-- Widening those CHECKs in place would give one table two lifecycles with two meanings for
-- `status`. So the declarative-contract Skill gets its own tables, and the two models meet
-- in exactly one place: `capability_listings`.
--
-- ## One Skill directory (coord-main ruling, #459)
--
-- Rows here are projected into `capability_listings (kind='skill')` by
-- `pg-skill-contract-repository.ts`, the same catalog `/admin/skill` already reads and the
-- same one `pg-skill-starter-import-repository.ts` writes. Two catalogs would be two sources
-- of truth for "which Skills exist" -- the anti-pattern AGENTS.md names by hand.
--
-- ⚠ The projection is written by application code, never here: `apps/api/tests/kernel/
-- no-builtin-capability-lists.test.ts` asserts that no migration INSERTs into
-- `capability_listings`. This file contains no INSERT of any kind.

/* ─────────────────────────── skill_contracts ─────────────────────────── */

CREATE TABLE IF NOT EXISTS skill_contracts (
  id                 text NOT NULL,
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name               text NOT NULL,
  duty               text NOT NULL,
  -- ⚠ System-assigned by entry point, never accepted from the caller (contract I-11 /
  -- `domain/skill/source-tag.ts`). A caller-supplied `source` is rejected as
  -- `SOURCE_TAG_IMMUTABLE` before this row is ever built.
  source             text NOT NULL CHECK (source IN ('自建', '晋升生成', 'CC')),
  -- ⚠ **Four states, deliberately** -- this is divergence D08 (`domain/skill/skill-status.ts`,
  -- registered in `apps/web/lib/contract-divergences.ts`), still unresolved. `domain.md` I-1
  -- says "exactly four"; `packages/contracts/src/skills.ts` `SkillStatus` says five (it adds
  -- `被退回`). The domain layer implements the four-state side and does not touch the signed
  -- contract, so the only values the application can ever produce are these four. Storing a
  -- CHECK of five would claim a state no code path can reach or leave.
  -- Resolving D08 is a sign-off action, not an implementation action.
  status             text NOT NULL CHECK (status IN ('草稿', '待审核', '已启用', '已停用')),
  visibility         text NOT NULL CHECK (visibility IN ('org-wide', 'team-only')),
  owner_team_id      text REFERENCES teams (id) ON DELETE SET NULL,
  -- ⚠ Nullable and it stays nullable: a fresh draft has no *effective* version. The contract's
  -- `SkillListItem.currentVersionId` is `.nullable()` for the same reason.
  current_version_id text,
  -- `已归档` is not a fifth state: it is the subclass `status = 已停用 ∧ archived = true`
  -- (domain.md section 2). Keeping it a boolean is what stops it becoming one.
  archived           boolean NOT NULL DEFAULT false,
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT skill_contracts_id_org_uniq UNIQUE (id, org_id)
);

ALTER TABLE skill_contracts DROP CONSTRAINT IF EXISTS skill_contracts_team_only_needs_team;
ALTER TABLE skill_contracts ADD CONSTRAINT skill_contracts_team_only_needs_team
  CHECK (visibility <> 'team-only' OR owner_team_id IS NOT NULL);

ALTER TABLE skill_contracts DROP CONSTRAINT IF EXISTS skill_contracts_archived_only_when_disabled;
ALTER TABLE skill_contracts ADD CONSTRAINT skill_contracts_archived_only_when_disabled
  CHECK (NOT archived OR status = '已停用');

-- Mirrors `capability_listings_uniq UNIQUE (org_id, kind, name)`. Without it the projection
-- into the shared catalog would fail *after* this row was written, i.e. the two would drift.
CREATE UNIQUE INDEX IF NOT EXISTS skill_contracts_name_uniq
  ON skill_contracts (org_id, name);

CREATE INDEX IF NOT EXISTS skill_contracts_org_status_idx
  ON skill_contracts (org_id, status);

/* ───────────────────── skill_contract_versions ───────────────────── */

CREATE TABLE IF NOT EXISTS skill_contract_versions (
  id                   text NOT NULL,
  org_id               text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  skill_id             text NOT NULL,
  version_number       integer NOT NULL CHECK (version_number > 0),
  -- Contract `SkillVersionState` verbatim (5 values, no divergence here). `SkillVersion.state`
  -- and `Skill.status` are two fields and must not be derived from one another (domain.md §2).
  state                text NOT NULL
    CHECK (state IN ('草稿', '待审核', '已生效', '已归档', '待上线')),
  prompt_template      text NOT NULL,
  input_schema         text NOT NULL,
  output_schema        text NOT NULL,
  data_scope           jsonb NOT NULL,
  reads_raw_transcript boolean NOT NULL,
  fallback_declaration text NOT NULL,
  -- `createSkillDraft.in.modelRef` / `publishNewVersion`. Stored on the *version*, not the
  -- Skill: it is part of the declaration a version pins, so a later version may name a
  -- different model without rewriting history (I-6).
  model_ref            text NOT NULL,
  content_hash         text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT skill_contract_versions_id_org_uniq UNIQUE (id, org_id),
  CONSTRAINT skill_contract_versions_skill_fk FOREIGN KEY (skill_id, org_id)
    REFERENCES skill_contracts (id, org_id) ON DELETE CASCADE,
  CONSTRAINT skill_contract_versions_number_uniq UNIQUE (org_id, skill_id, version_number),
  CONSTRAINT skill_contract_versions_scope_is_array CHECK (jsonb_typeof(data_scope) = 'array')
);

CREATE INDEX IF NOT EXISTS skill_contract_versions_skill_idx
  ON skill_contract_versions (org_id, skill_id, version_number);

/* ──────────────── skill_contract_reference_snapshots ──────────────── */

-- Feeds the R7 gate "no disable without an enumerated reference list": `disableSkill` rejects
-- with `REFERENCES_NOT_ENUMERATED` unless the caller's `referenceSnapshotId` is the *latest*
-- row here for that Skill (`domain/skill/reference-enumeration.ts`).
--
-- ⚠ Nothing writes this table yet. `listReferences` -- the only producer -- was moved out of
-- #459 by coord-main. That is not a hole: with no producer, no snapshot is ever fresh, so
-- `disableSkill` fails closed for every caller. The table exists so the port has a real
-- adapter rather than a stub that would have to be replaced (and re-reviewed) later.
CREATE TABLE IF NOT EXISTS skill_contract_reference_snapshots (
  id                  text NOT NULL,
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  skill_id            text NOT NULL,
  in_flight_projects  jsonb NOT NULL,
  template_bindings   jsonb NOT NULL,
  agent_mounts        jsonb NOT NULL,
  -- 非 null ⇒ 上面三项是**部分结果**（规模大时 `listReferences` 转异步）。
  -- 「空数组」与「这一类我还没查完」必须可分辨，契约 :861 逐字。
  async_task_id       text,
  taken_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT skill_contract_reference_snapshots_id_org_uniq UNIQUE (id, org_id),
  CONSTRAINT skill_contract_reference_snapshots_skill_fk FOREIGN KEY (skill_id, org_id)
    REFERENCES skill_contracts (id, org_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS skill_contract_reference_snapshots_latest_idx
  ON skill_contract_reference_snapshots (org_id, skill_id, taken_at DESC);

/* ─────────────────────────── RLS ─────────────────────────── */

ALTER TABLE skill_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_contract_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_contract_reference_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_contract_reference_snapshots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skill_contracts_tenant ON skill_contracts;
CREATE POLICY skill_contracts_tenant ON skill_contracts
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS skill_contract_versions_tenant ON skill_contract_versions;
CREATE POLICY skill_contract_versions_tenant ON skill_contract_versions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS skill_contract_reference_snapshots_tenant ON skill_contract_reference_snapshots;
CREATE POLICY skill_contract_reference_snapshots_tenant ON skill_contract_reference_snapshots
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON skill_contracts, skill_contract_versions, skill_contract_reference_snapshots
  FROM app_rw;
-- `skill_contracts` needs UPDATE: `status` / `current_version_id` change over the lifecycle.
GRANT SELECT, INSERT, UPDATE ON skill_contracts TO app_rw;
-- ⚠ Versions get **no UPDATE and no DELETE**, on purpose. I-6: "a version snapshot is
-- immutable; publishing vN+1 archives vN". The grant is the structural half of that rule --
-- rewriting a shipped version in place requires a migration, which is a reviewable change,
-- rather than one more UPDATE in a repository nobody re-reads.
GRANT SELECT, INSERT ON skill_contract_versions TO app_rw;
GRANT SELECT, INSERT ON skill_contract_reference_snapshots TO app_rw;

-- F22's catalog-driven organization freeze only sees tables that existed when it last ran.
-- Reapply the single-source helper so a frozen organization can still read these Skills but
-- cannot create, version, or disable them.
SELECT kernel_apply_org_freeze_policies();
