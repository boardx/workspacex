/**
 * The `chat_wave2_fixture` mock Agent catalog (#417 stand-in), used by every caller that
 * sets `KERNEL_AGENT_CATALOG_SCHEMA=chat_wave2_fixture` to avoid depending on the real
 * catalog import pipeline.
 *
 * #651: this used to be declared TWICE — once here-equivalent inline in
 * `message-write-roundtrip.test.ts`, once inline in `scripts/seed-chat-read-e2e.ts` — and
 * the two copies drifted. #414/#499 added `v.instructions` to
 * `PgPublishedAgentReader.resolvePublished`'s SELECT (`pg-chat-message-command-repository.ts`)
 * and #595 Line A updated the `message-write-roundtrip.test.ts` copy to match, but the
 * `seed-chat-read-e2e.ts` copy was never touched. The result: every real message POST that
 * went through the `chat-read.spec.ts` E2E fixture hit `column v.instructions does not
 * exist` and returned 500 instead of the contracted 202 — on `main`, silently, because the
 * two copies of "what this mock table looks like" were never checked against each other.
 *
 * Single declaration now. Both callers import this; there is no second copy left to drift.
 */
import type pg from "pg";

export interface FixtureClient {
  query: pg.Client["query"];
}

/** Creates the schema + both tables + RLS + grants. Idempotent (safe to call every run). */
export async function createChatWave2FixtureSchema(client: FixtureClient): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS chat_wave2_fixture;
    CREATE TABLE IF NOT EXISTS chat_wave2_fixture.agents (
      id text PRIMARY KEY,
      -- Test-only #417 boundary: no organization FK, so this fixture cannot masquerade as
      -- a production tenant table or enter the freeze-policy catalog.
      org_id text NOT NULL,
      status text NOT NULL,
      published_version_id text NULL,
      -- #2038: PgPublishedAgentReader.resolveDefaultAgentId ORDER BYs on these two
      -- production columns (20260804150000_wave2_agent_starter_import.sql:9,13). Nullable /
      -- defaulted so existing fixture INSERTs stay valid; the reader's ORDER BY is written
      -- null-safe (COALESCE) for exactly this shape. Same strict-subset discipline as
      -- agent_versions.instructions below. First hit for real: the chat-read e2e stack's
      -- default-resolution turns 500ed with "column a.stable_name does not exist".
      stable_name text NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS chat_wave2_fixture.agent_versions (
      id text PRIMARY KEY,
      org_id text NOT NULL,
      agent_id text NOT NULL REFERENCES chat_wave2_fixture.agents(id) ON DELETE CASCADE,
      skill_version_ids jsonb NOT NULL,
      model_provider text NOT NULL,
      model_id text NOT NULL,
      -- Mirrors the real agent_versions (20260804150000_wave2_agent_starter_import.sql:27,
      -- instructions text NOT NULL). NOT NULL DEFAULT so this table's shape stays a strict
      -- subset of the production columns PgPublishedAgentReader.resolvePublished actually
      -- reads, never a superset it invents.
      instructions text NOT NULL DEFAULT '',
      published_at timestamptz NULL
    );
    -- A long-lived dev stack (WORKSPACEX_KEEP_TEST_STACK=1) reuses this table across runs;
    -- CREATE TABLE IF NOT EXISTS is then a no-op against an older shape, so a column added
    -- here must also be added to whatever already exists.
    ALTER TABLE chat_wave2_fixture.agent_versions ADD COLUMN IF NOT EXISTS instructions text NOT NULL DEFAULT '';
    ALTER TABLE chat_wave2_fixture.agents ADD COLUMN IF NOT EXISTS stable_name text NULL;
    ALTER TABLE chat_wave2_fixture.agents ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    DO $$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY['agents', 'agent_versions'] LOOP
        EXECUTE format('ALTER TABLE chat_wave2_fixture.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE chat_wave2_fixture.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON chat_wave2_fixture.%I', t || '_tenant', t);
        EXECUTE format(
          'CREATE POLICY %I ON chat_wave2_fixture.%I USING (org_id = current_setting(''app.current_org'', true)) WITH CHECK (org_id = current_setting(''app.current_org'', true))',
          t || '_tenant', t
        );
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON chat_wave2_fixture.%I TO app_rw', t);
      END LOOP;
      GRANT USAGE ON SCHEMA chat_wave2_fixture TO app_rw;
    END $$;
  `);
}
