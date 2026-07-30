-- 0018 F31: the project file browser -- the row metadata columns, and the ONE place the
-- per-row visibility predicate lives (uc-22-1 R3, contracts/files/usecases.md A 组).
--
-- ## What F31 actually is
--
-- "可见集合 ≡ 检索可见集合": what the list endpoint returns and what retrieval can reach
-- must be THE SAME SET. The only way that survives a second reader being written is for
-- both readers to consult ONE predicate, and for that predicate to live where a reader
-- cannot forget it -- i.e. in SQL, not in application code that each caller re-implements.
--
--   RLS (0003/0006)          the TENANT boundary. Already there, already FORCEd.
--   wsx_visible_artifacts()  the per-row VISIBILITY boundary (scope + owning team).
--
-- The application layer never post-filters rows. That is not a style preference: a post
-- filter makes "the SQL predicate is wrong" and "the SQL predicate is missing" both invisible,
-- because the application quietly re-does the work and every test stays green. The
-- counter-proof in tests/files/artifacts-list-rls.test.ts neuters this function inside a
-- rolled-back transaction and requires the forbidden row to appear in the response payload;
-- if the application were also filtering, that counter-proof could not go red.
--
-- ## ⚠ What this migration deliberately does NOT decide
--
--   * **来源类型词表 (XC-03 / files FS1)**. `artifacts.source` keeps the SEVEN-value CHECK
--     0006 wrote from the SIGNED `artifact.ArtifactSource`. It is NOT widened to the eight
--     values `apps/web/lib/mock/files.ts` uses, and NOT reconciled with the third vocabulary
--     in `segment_text.source_type` (0009: file/survey/interview/workshop/photo/conversation/
--     deep-research/ai-generated). Three vocabularies, pairwise unequal, ruling pending.
--     Nothing here picks one.
--   * **`agenda_segment` ownership (XC-01)**. `agenda_segment_id` is a nullable text column
--     with NO foreign key, because there is no `agenda_segments` table and which bundle owns
--     that entity is unruled. A FK invented here would be this migration answering XC-01.
--
-- Replayable: every statement is IF NOT EXISTS / OR REPLACE, because migrate:check
-- force-replays each file ignoring the version table.

-- ---------------------------------------------------------------------------------------
-- Row metadata the browser shows and 0006 has no column for
-- ---------------------------------------------------------------------------------------
-- ⚠ ADD COLUMN IF NOT EXISTS rather than editing 0006's CREATE TABLE: 0006 is
-- `CREATE TABLE IF NOT EXISTS`, which is a SILENT no-op on a database that already has the
-- table. Editing it would apply to fresh databases only, and the difference would surface as
-- "works on CI, missing column in dev".
ALTER TABLE artifacts
  -- null = 「未归入环节」. The tree's un-segmented node exists BECAUSE this is nullable, and
  -- that node must never be hidden -- otherwise a general upload disappears from the tree and
  -- "the file is gone" is indistinguishable from "the upload never succeeded".
  ADD COLUMN IF NOT EXISTS agenda_segment_id text,
  -- The 机密 badge. Fail-closed default is not available here: existing F04 rows predate the
  -- concept, and marking them confidential would silently reroute them onto the local-model
  -- path (D-U1) without anybody having said so.
  ADD COLUMN IF NOT EXISTS confidential boolean NOT NULL DEFAULT false,
  -- 摄取状态 -- the ONLINE state machine value (artifact.IngestionStatus). NOT the UI view
  -- state: files FS2 rules those two are same-name-different-meaning and must not be merged.
  ADD COLUMN IF NOT EXISTS ingestion_status text NOT NULL DEFAULT 'READY',
  -- V10 (agent 归属): who produced this, as a KIND rather than as a naming convention on
  -- `created_by`. An agent upload must render as "agent name + agent_run_id" and must NOT
  -- render as a person -- a convention like "ids starting with agent-" is a rule no constraint
  -- can hold.
  ADD COLUMN IF NOT EXISTS creator_kind text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS agent_run_id text;

-- The CHECK is added separately and idempotently: ADD CONSTRAINT has no IF NOT EXISTS.
DO $$
BEGIN
  -- Closed enum, a copy of `artifact.IngestionStatus` in packages/contracts. It is not LEFT
  -- as a copy: tests/files/tree-list-metadata.test.ts reads this constraint out of pg_catalog
  -- and asserts it equals the contract enum member for member -- the same technique 0006 uses
  -- for `artifacts.source`.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifacts_ingestion_status_known') THEN
    ALTER TABLE artifacts ADD CONSTRAINT artifacts_ingestion_status_known CHECK (
      ingestion_status IN (
        'RECEIVED', 'QUARANTINED', 'SCANNED', 'STORED', 'EXTRACTED',
        'SEGMENTED', 'ENRICHED', 'INDEXED', 'REVIEW_PENDING', 'READY'
      )
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifacts_creator_kind_known') THEN
    ALTER TABLE artifacts ADD CONSTRAINT artifacts_creator_kind_known
      CHECK (creator_kind IN ('user', 'agent'));
  END IF;

  -- V10 in its assertable form, BOTH ways. Only the first half is obvious, and having only
  -- the first half is how a human upload acquires an agent_run_id a year later with nothing
  -- failing.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifacts_agent_run_id_iff_agent') THEN
    ALTER TABLE artifacts ADD CONSTRAINT artifacts_agent_run_id_iff_agent
      CHECK ((creator_kind = 'agent') = (agent_run_id IS NOT NULL));
  END IF;
END
$$;

-- The browser's default read is "this project, newest first".
CREATE INDEX IF NOT EXISTS artifacts_browser_idx
  ON artifacts (org_id, project_id, created_at DESC);

-- ---------------------------------------------------------------------------------------
-- wsx_visible_artifacts -- the per-row visibility predicate, in SQL, once
-- ---------------------------------------------------------------------------------------
-- ## Why a function and not a policy on `artifacts`
--
-- A RESTRICTIVE policy keyed on `app.current_user_id` would be stronger, and it is the wrong
-- move HERE: every existing fixture and every existing write path opens a tenant transaction
-- that sets `app.current_org` and nothing else, so such a policy would make every one of them
-- read zero rows. That is a change to F01/F04's contract, not to F31's, and it is not this
-- feature's to make. What IS this feature's to make is that the browser has exactly one
-- predicate and cannot bypass it -- which a function gives, and which the
-- `lint-permission-paths` + `Guarded<T>` pair keeps honest.
--
-- ## SECURITY INVOKER, and it is asserted
--
-- Left at the default deliberately. SECURITY DEFINER here would run as the table OWNER, and
-- an owner is not subject to RLS -- the function would return every tenant's artifacts while
-- looking exactly like this one. `artifacts-list-rls.test.ts` reads `prosecdef` from
-- pg_catalog rather than trusting that nobody adds the word later.
--
-- ## The effective scope, and why it is the STRICTEST
--
-- An artifact may carry several `acl_bindings` rows (one per subject). Their scopes are
-- combined the same way `strictestScope()` combines them in TypeScript (domain/identity/
-- permission-decision.ts), because a derived object reachable through several sources takes
-- the strictest, never the union:
--
--   no team-only binding        => org-wide
--   exactly one owning team     => team-only, that team
--   two or more owning teams    => team-only, `__unsatisfiable__`
--
-- ⚠ `__unsatisfiable__` is the SAME sentinel as `UNSATISFIABLE_TEAM` in TypeScript. Two
-- copies of one literal is exactly the failure this repository has hit repeatedly, so it is
-- not left as a comment: `artifacts-list-rls.test.ts` reads this function's body out of
-- pg_catalog and asserts the sentinel it contains equals the exported constant, and a
-- differential test drives the whole (scope × owning team × requester team) matrix through
-- BOTH this SQL and `decide()` and requires identical verdicts.
--
-- `p_requester_team_id` is the requester's ORG team (`org_memberships.team_id`), passed in
-- rather than read here: it is one fact about the requester, not a per-row fact, and reading
-- it per row would be the same query 5000 times.
CREATE OR REPLACE FUNCTION wsx_visible_artifacts(p_project_id text, p_requester_team_id text)
RETURNS TABLE (artifact_id text, scope text, owner_team_id text)
LANGUAGE sql
STABLE
AS $$
  WITH bound AS (
    SELECT a.id AS artifact_id,
           array_agg(DISTINCT b.owner_team_id) FILTER (WHERE b.scope = 'team-only') AS teams
      FROM artifacts a
      LEFT JOIN acl_bindings b
             ON b.org_id = a.org_id
            AND b.object_kind = 'artifact'
            AND b.object_id = a.id
     WHERE a.project_id = p_project_id
     GROUP BY a.id
  ),
  effective AS (
    SELECT artifact_id,
           CASE WHEN teams IS NULL THEN 'org-wide' ELSE 'team-only' END AS scope,
           CASE
             WHEN teams IS NULL THEN NULL
             -- `array_length(x, 1)` is NULL for `{NULL}`, so a team-only binding whose owning
             -- team is null lands in the ELSE branch and is unsatisfiable. That matches
             -- `decide()`: scopePassed requires `org.teamId === scope.ownerTeamId` with a
             -- non-null org team, and null can never satisfy it.
             WHEN array_length(teams, 1) = 1 THEN teams[1]
             ELSE '__unsatisfiable__'
           END AS owner_team_id
      FROM bound
  )
  SELECT e.artifact_id, e.scope, e.owner_team_id
    FROM effective e
   WHERE e.scope = 'org-wide'
      OR (p_requester_team_id IS NOT NULL AND p_requester_team_id = e.owner_team_id);
$$;

REVOKE ALL ON FUNCTION wsx_visible_artifacts(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wsx_visible_artifacts(text, text) TO app_rw;
