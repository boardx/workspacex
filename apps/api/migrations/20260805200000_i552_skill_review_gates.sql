-- #552: the **two gate records** and the reviewer-function assignment, i.e. the storage half of
-- "there is no path that turns a Skill into 已启用".
--
-- ## What was actually missing
--
-- `domain/skill/security-gate.ts` and `application/skill/review-skill-version.ts` were fully
-- implemented and unit-tested, but nothing persisted their inputs or their outputs:
--
--   * `GateState.scan` had **no producer** -- `gatesAllowEnable` therefore returned
--     `GATE_NOT_PASSED` for every caller, because `scan === null` means "never scanned",
--     not "clean";
--   * `ReviewerFunctionPort` (`application/skill/ports.ts`) had **no adapter** -- there was
--     no table anywhere saying who holds `methodology-reviewer` / `security-reviewer`;
--   * the human gate produced no record, so I-3's "every 已启用 Skill can be traced back to
--     two gate records" was not answerable even in principle.
--
-- ⚠ There is still **no** `POST /skills/:id/enable`, and this migration adds no way to reach
-- `已启用` other than through the review record below. `SKILLS_FORBIDDEN_ROUTES` names the
-- shape being avoided; the storage-layer equivalent is that nothing here writes
-- `skill_contracts.status` -- that column is only ever moved by `applyTransition`, which
-- carries both `from` and `to`.

/* ─────────────── skill_contract_security_scans (gate 1, automatic) ─────────────── */

-- One row per scan run. **Append-only**: re-scanning a version adds a row rather than
-- overwriting, so "this version was once rejected and then passed" stays visible. The gate
-- reads the *latest* row (`ORDER BY scanned_at DESC LIMIT 1`).
--
-- ⚠ `verdict` is the contract's `SecurityScanVerdict` verbatim, three values. `risk-pending-confirm`
-- is **not** an error (contract comment, verbatim): its findings are handed to the reviewer for
-- item-by-item acknowledgement, and `gatesAllowEnable` refuses to enable until every
-- `riskItemId` in `findings` appears in the review's `risk_acks`.
CREATE TABLE IF NOT EXISTS skill_contract_security_scans (
  id          text NOT NULL,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  skill_id    text NOT NULL,
  version_id  text NOT NULL,
  verdict     text NOT NULL CHECK (verdict IN ('pass', 'risk-pending-confirm', 'reject')),
  findings    jsonb NOT NULL,
  scanned_by  text NOT NULL,
  scanned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT skill_contract_security_scans_id_org_uniq UNIQUE (id, org_id),
  CONSTRAINT skill_contract_security_scans_version_fk FOREIGN KEY (version_id, org_id)
    REFERENCES skill_contract_versions (id, org_id) ON DELETE CASCADE,
  CONSTRAINT skill_contract_security_scans_findings_is_array
    CHECK (jsonb_typeof(findings) = 'array')
);

CREATE INDEX IF NOT EXISTS skill_contract_security_scans_latest_idx
  ON skill_contract_security_scans (org_id, version_id, scanned_at DESC);

/* ─────────────── skill_contract_reviews (gate 2, human) ─────────────── */

-- One row per human decision. `reviewSkillVersion` returns `reviewRecordId`, and the contract
-- requires it: a decision that cannot be pointed at afterwards is indistinguishable from one
-- that never happened (same argument as I-23's audit rule for bypass attempts).
--
-- ⚠ `reviewer_id <> submitter_id` is **not** a CHECK here. Self-review is rejected by
-- `domain/skill/review-authorization.ts` with two *different* codes depending on whether the
-- org has a second methodology reviewer (`SELF_REVIEW_FORBIDDEN` vs `NO_SECOND_REVIEWER`,
-- A4). A CHECK would collapse both into one opaque 23514 and move the rule to a second place.
CREATE TABLE IF NOT EXISTS skill_contract_reviews (
  id           text NOT NULL,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  skill_id     text NOT NULL,
  version_id   text NOT NULL,
  submitter_id text NOT NULL,
  reviewer_id  text NOT NULL,
  decision     text NOT NULL CHECK (decision IN ('approve', 'reject')),
  -- The contract makes `reason` `.min(1)`: an approval with no stated reason cannot be
  -- reviewed later, and `risk-pending-confirm` acknowledgements ride along with it.
  reason       text NOT NULL CHECK (length(btrim(reason)) > 0),
  risk_acks    jsonb NOT NULL,
  reviewed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT skill_contract_reviews_id_org_uniq UNIQUE (id, org_id),
  CONSTRAINT skill_contract_reviews_version_fk FOREIGN KEY (version_id, org_id)
    REFERENCES skill_contract_versions (id, org_id) ON DELETE CASCADE,
  CONSTRAINT skill_contract_reviews_acks_is_array CHECK (jsonb_typeof(risk_acks) = 'array')
);

CREATE INDEX IF NOT EXISTS skill_contract_reviews_latest_idx
  ON skill_contract_reviews (org_id, version_id, reviewed_at DESC);

/* ─────────────── skill_reviewer_functions (I-5) ─────────────── */

-- Who may press approve, assigned by an org admin. **The two functions do not merge** (I-5 /
-- V14): a `security-reviewer` calling `reviewSkillVersion` gets `REVIEWER_FUNCTION_MISMATCH`.
--
-- ⚠ PRIMARY KEY is `(org_id, principal_id)` -- **one function per person per org**, not a set.
-- A person holding both functions is exactly the merge I-5 forbids, and the place to make
-- that unrepresentable is here, not in a validation someone can forget to call.
--
-- ⚠ Deliberately NOT derived from `org_memberships.org_role`. "Is an admin" and "may approve a
-- Skill" are two different facts; deriving one from the other would make `security-reviewer`
-- unrepresentable and quietly delete the only case I-5 is about.
CREATE TABLE IF NOT EXISTS skill_reviewer_functions (
  org_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  principal_id      text NOT NULL,
  reviewer_function text NOT NULL
    CHECK (reviewer_function IN ('methodology-reviewer', 'security-reviewer')),
  assigned_by       text NOT NULL,
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, principal_id)
);

CREATE INDEX IF NOT EXISTS skill_reviewer_functions_by_function_idx
  ON skill_reviewer_functions (org_id, reviewer_function);

/* ─────────────────────────── RLS ─────────────────────────── */

ALTER TABLE skill_contract_security_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_contract_security_scans FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_contract_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_contract_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_reviewer_functions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_reviewer_functions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skill_contract_security_scans_tenant ON skill_contract_security_scans;
CREATE POLICY skill_contract_security_scans_tenant ON skill_contract_security_scans
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS skill_contract_reviews_tenant ON skill_contract_reviews;
CREATE POLICY skill_contract_reviews_tenant ON skill_contract_reviews
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS skill_reviewer_functions_tenant ON skill_reviewer_functions;
CREATE POLICY skill_reviewer_functions_tenant ON skill_reviewer_functions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

/* ─────────────────────────── grants ─────────────────────────── */

-- Both gate records are **append-only**: no UPDATE, no DELETE. Rewriting a scan verdict or a
-- review decision in place would defeat the traceability I-3 asks for, and the grant is the
-- structural half of that rule (same reasoning as `skill_contract_versions` in #459).
REVOKE ALL ON skill_contract_security_scans, skill_contract_reviews, skill_reviewer_functions
  FROM app_rw;
GRANT SELECT, INSERT ON skill_contract_security_scans TO app_rw;
GRANT SELECT, INSERT ON skill_contract_reviews TO app_rw;
-- Assignments change over time (people join, change function, leave).
GRANT SELECT, INSERT, UPDATE, DELETE ON skill_reviewer_functions TO app_rw;

-- ⚠ **Column-level** UPDATE on `skill_contract_versions.state`, and only that column.
--
-- #459 granted versions `SELECT, INSERT` only, citing I-6 ("a version snapshot is immutable").
-- That is right about the *declaration*, and this grant does not weaken it: `prompt_template`,
-- `input_schema`, `output_schema`, `data_scope`, `reads_raw_transcript`,
-- `fallback_declaration`, `model_ref` and `content_hash` remain un-updatable, so rewriting a
-- shipped version's content still requires a reviewable migration.
--
-- `state` is a different thing and domain.md §2 says so verbatim: `SkillVersion.state` and
-- `Skill.status` "are two fields and must not be derived from one another". A version's
-- lifecycle (草稿 → 待审核 → 已生效) *has* to move, otherwise the human gate cannot record
-- its outcome anywhere except on the Skill row -- which would be the derivation §2 forbids.
GRANT UPDATE (state) ON skill_contract_versions TO app_rw;

-- F22's catalog-driven organization freeze only sees tables that existed when it last ran.
SELECT kernel_apply_org_freeze_policies();
