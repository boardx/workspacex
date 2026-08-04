/**
 * Wave 2 / #415 — durable Chat acceptance and stable message pagination.
 *
 * The Agent catalog tables below are a controlled database fixture for the published-Agent
 * repository contract owned by #417. They are deliberately test-only: #415 consumes that
 * boundary and must not create, publish, or mutate Agents/Skills itself.
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs,
  seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
process.env.KERNEL_AGENT_CATALOG_SCHEMA = "chat_wave2_fixture";

const ORG = "org-wave2-chat-write";
const PROJECT = "proj-wave2-chat-write";
const THREAD = "thread-wave2-chat-write";
const ACTOR = "u-wave2-chat-write";
const AGENT = "agent-wave2-published";
const VERSION = "agent-version-wave2-v1";
const SKILLS = ["skill-version-research-v2", "skill-version-synthesis-v4"];
let BASE: string;
let app: NestExpressApplication;

const headers = {
  "x-kernel-test-principal": `${ACTOR}:${ORG}`,
  "content-type": "application/json",
};

async function createAgentFixtureTables(): Promise<void> {
  await asOwner(async (c) => {
    await c.query(`
      CREATE SCHEMA IF NOT EXISTS chat_wave2_fixture;
      CREATE TABLE IF NOT EXISTS chat_wave2_fixture.agents (
        id text PRIMARY KEY,
        -- Test-only #417 boundary: no organization FK, so this fixture cannot masquerade as
        -- a production tenant table or enter the freeze-policy catalog.
        org_id text NOT NULL,
        status text NOT NULL,
        published_version_id text NULL
      );
      CREATE TABLE IF NOT EXISTS chat_wave2_fixture.agent_versions (
        id text PRIMARY KEY,
        org_id text NOT NULL,
        agent_id text NOT NULL REFERENCES chat_wave2_fixture.agents(id) ON DELETE CASCADE,
        skill_version_ids jsonb NOT NULL,
        model_provider text NOT NULL,
        model_id text NOT NULL,
        published_at timestamptz NULL
      );
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
  });
}

async function publishAgent(opts: { enabled?: boolean; published?: boolean } = {}): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO chat_wave2_fixture.agents (id, org_id, status, published_version_id)
       VALUES ($1,$2,$3,$4)`,
      [AGENT, ORG, opts.enabled === false ? "disabled" : "enabled",
        opts.published === false ? null : VERSION],
    );
    if (opts.published !== false) {
      await c.query(
        `INSERT INTO chat_wave2_fixture.agent_versions
           (id, org_id, agent_id, skill_version_ids, model_provider, model_id, published_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,now())`,
        [VERSION, ORG, AGENT, JSON.stringify(SKILLS), "dashscope", "qwen-plus"],
      );
    }
  });
}

const postMessage = (body: Record<string, unknown>) =>
  fetch(`${BASE}/chat/threads/${THREAD}/messages`, {
    method: "POST", headers, body: JSON.stringify(body),
  });

const listMessages = (query = "") =>
  fetch(`${BASE}/chat/threads/${THREAD}/messages${query}`, { headers });

async function writeCounts(): Promise<{ messages: number; runs: number }> {
  return asApp(ORG, async (c) => {
    const messages = await c.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM chat_messages WHERE thread_id=$1",
      [THREAD],
    );
    const runs = await c.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM agent_runs WHERE thread_id=$1",
      [THREAD],
    );
    return { messages: Number(messages.rows[0]!.count), runs: Number(runs.rows[0]!.count) };
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await createAgentFixtureTables();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await asOwner((c) => c.query("DROP SCHEMA IF EXISTS chat_wave2_fixture CASCADE"));
});

beforeEach(async () => {
  await asOwner(async (c) => {
    await c.query("DELETE FROM chat_wave2_fixture.agent_versions");
    await c.query("DELETE FROM chat_wave2_fixture.agents");
  });
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
});

describe("POST /chat/threads/:threadId/messages", () => {
  it.each([
    ["missing", {}],
    ["empty", { agentId: "" }],
    ["unknown", { agentId: "agent-does-not-exist" }],
  ])("rejects a %s agentId with 422 and writes neither message nor run", async (_case, extra) => {
    const response = await postMessage({
      clientMessageId: randomUUID(), text: "Durable, not synthetic", ...extra,
    });
    expect(response.status).toBe(422);
    expect(await writeCounts()).toEqual({ messages: 0, runs: 0 });
  });

  it("rejects an unpublished Agent before either write", async () => {
    await publishAgent({ published: false });
    const response = await postMessage({
      clientMessageId: randomUUID(), text: "Do not accept this", agentId: AGENT,
    });
    expect(response.status).toBe(422);
    expect(await writeCounts()).toEqual({ messages: 0, runs: 0 });
  });

  it("keeps an archived thread read-only and writes neither message nor run", async () => {
    await publishAgent();
    await asApp(ORG, (c) => c.query("UPDATE chat_threads SET archived=true WHERE id=$1", [THREAD]));
    const response = await postMessage({
      clientMessageId: randomUUID(), text: "Must remain read-only", agentId: AGENT,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reasonCode: "THREAD_ARCHIVED_READONLY" });
    expect(await writeCounts()).toEqual({ messages: 0, runs: 0 });
  });

  it("atomically persists one human message and one queued run with the exact published snapshot", async () => {
    await publishAgent();
    const clientMessageId = randomUUID();
    const response = await postMessage({ clientMessageId, text: "Analyse this", agentId: AGENT });
    expect(response.status).toBe(202);
    const body = await response.json() as {
      message: { id: string; text: string; clientMessageId: string; authorKind: string };
      agentRunId: string; runStatus: string;
    };
    expect(body).toMatchObject({
      message: { text: "Analyse this", clientMessageId, authorKind: "human" },
      runStatus: "queued",
    });
    expect(body).not.toHaveProperty("reply");

    const stored = await asApp(ORG, async (c) => c.query(
      `SELECT r.id, r.agent_version_id, r.skill_version_ids, r.model_provider, r.model_id,
              r.status, r.input_message_id, m.body, m.client_message_id
         FROM agent_runs r JOIN chat_messages m ON m.id=r.input_message_id
        WHERE r.id=$1`,
      [body.agentRunId],
    ));
    expect(stored.rows).toEqual([expect.objectContaining({
      id: body.agentRunId,
      agent_version_id: VERSION,
      skill_version_ids: SKILLS,
      model_provider: "dashscope",
      model_id: "qwen-plus",
      status: "queued",
      input_message_id: body.message.id,
      body: "Analyse this",
      client_message_id: clientMessageId,
    })]);
  });

  it("returns the original result for exact replay, even after the Agent becomes disabled", async () => {
    await publishAgent();
    const request = { clientMessageId: randomUUID(), text: "Only once", agentId: AGENT };
    const first = await postMessage(request);
    const firstBody = await first.json();
    await asApp(ORG, (c) => c.query(
      "UPDATE chat_wave2_fixture.agents SET status='disabled' WHERE id=$1", [AGENT],
    ));
    const replay = await postMessage(request);
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual(firstBody);
    expect(await writeCounts()).toEqual({ messages: 1, runs: 1 });
  });

  it("rejects changed text or selected Agent for the same idempotency identity", async () => {
    await publishAgent();
    const clientMessageId = randomUUID();
    await postMessage({ clientMessageId, text: "Original", agentId: AGENT });
    const changed = await postMessage({ clientMessageId, text: "Changed", agentId: AGENT });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ reasonCode: "IDEMPOTENCY_CONFLICT" });
    const changedAgent = await postMessage({
      clientMessageId, text: "Original", agentId: "different-agent",
    });
    expect(changedAgent.status).toBe(409);
    expect(await changedAgent.json()).toMatchObject({ reasonCode: "IDEMPOTENCY_CONFLICT" });
    expect(await writeCounts()).toEqual({ messages: 1, runs: 1 });
  });

  it("collapses concurrent identical requests to one durable message/run pair", async () => {
    await publishAgent();
    const request = { clientMessageId: randomUUID(), text: "Race-safe", agentId: AGENT };
    const responses = await Promise.all([postMessage(request), postMessage(request)]);
    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies[1]).toEqual(bodies[0]);
    expect(await writeCounts()).toEqual({ messages: 1, runs: 1 });
  });
});

describe("GET /chat/threads/:threadId/messages", () => {
  it("uses an opaque (createdAt,messageId) cursor with no gaps or duplicates at equal timestamps", async () => {
    for (const id of ["same-time-c", "same-time-a", "same-time-b", "later-d"]) {
      await addChatMessage({ orgId: ORG, id, threadId: THREAD, authorId: ACTOR, body: id });
    }
    await asApp(ORG, (c) => c.query(
      `UPDATE chat_messages SET created_at='2026-08-04T00:00:00Z'
        WHERE thread_id=$1 AND id LIKE 'same-time-%'`,
      [THREAD],
    ));

    const first = await listMessages("?limit=2");
    expect(first.status).toBe(200);
    const page1 = await first.json() as { messages: { id: string }[]; nextCursor: string | null };
    expect(page1.messages.map((m) => m.id)).toEqual(["same-time-a", "same-time-b"]);
    expect(page1.nextCursor).toEqual(expect.any(String));

    const second = await listMessages(`?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`);
    const page2 = await second.json() as { messages: { id: string }[]; nextCursor: string | null };
    expect(page2.messages.map((m) => m.id)).toEqual(["same-time-c", "later-d"]);
    expect(new Set([...page1.messages, ...page2.messages].map((m) => m.id)).size).toBe(4);
  });

  it("defaults to 50, caps at 100, and rejects malformed cursors", async () => {
    for (let i = 0; i < 105; i++) {
      await addChatMessage({
        orgId: ORG, id: `page-${String(i).padStart(3, "0")}`, threadId: THREAD,
        authorId: ACTOR, body: `message ${i}`,
      });
    }
    const defaultPage = await (await listMessages()).json() as { messages: unknown[] };
    expect(defaultPage.messages).toHaveLength(50);
    const capped = await (await listMessages("?limit=999")).json() as { messages: unknown[] };
    expect(capped.messages).toHaveLength(100);
    expect((await listMessages("?cursor=not-an-opaque-cursor")).status).toBe(400);
  });
});
