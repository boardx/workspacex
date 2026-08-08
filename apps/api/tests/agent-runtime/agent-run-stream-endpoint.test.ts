/**
 * #654 阶段2c — `GET /agent-runs/:runId/stream`, the additive SSE relay for a run created
 * the ORDINARY way (`POST /chat/threads/:id/messages`, same as production `/chat` does
 * today) -- deliberately NOT via the AG-UI bridge, to prove this endpoint carries none of
 * `runAguiBridgeTurn`'s "always opens a fresh thread" limitation (`stream-run.ts` file head).
 *
 * Real Postgres, real loopback SSE provider, real HTTP round trip -- same discipline as
 * `agui-bridge-streaming.test.ts` and `no-tool-run-writeback.test.ts`.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i654-stream-ep";
const OTHER_ORG = "org-i654-stream-ep-other";
const PROJECT = "proj-i654-stream-ep";
const THREAD = "thread-i654-stream-ep";
const ACTOR = "u-i654-stream-ep-actor";
const OUTSIDER = "u-i654-stream-ep-outsider";

const PROVIDER = "i654-stream-ep-loopback";
const AGENT = "agent-i654-stream-ep";
const V1 = "agent-version-i654-stream-ep-v1";
const SKILL = "skill-i654-stream-ep";
const SV = "skill-version-i654-stream-ep-v1";
const MODEL = "pinned-model-i654-stream-ep";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ─────────────────────────── loopback SSE provider ─────────────────────────── */

let providerServer: Server;
let providerBase = "";
let sseFragments: string[] = ["Streamed ", "over ", "the ", "existing ", "thread."];

function sseFrame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

async function startProvider(): Promise<void> {
  providerServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const fragment of sseFragments) res.write(sseFrame(fragment));
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise<void>((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
  const addr = providerServer.address() as AddressInfo;
  providerBase = `http://127.0.0.1:${addr.port}`;
}

/* ─────────────────────────── catalog fixtures ─────────────────────────── */

async function addSkillVersion(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [SKILL, ORG, SKILL, SKILL, ACTOR],
    );
    await c.query(
      `INSERT INTO skill_versions
         (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,now(),false)`,
      [SV, ORG, SKILL, SV, sha256("# i654 stream endpoint skill"), ACTOR],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, SV, Buffer.from("# i654 stream endpoint skill", "utf8"), sha256("# i654 stream endpoint skill")],
    );
    await c.query("SELECT wave2_publish_skill_version($1,$2)", [ORG, SV]);
  });
}

async function addPublishedAgentVersion(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [AGENT, ORG, AGENT, AGENT, ACTOR],
    );
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,'[]'::jsonb,$10,now(),now())`,
      [V1, ORG, AGENT, V1, sha256("i654 stream endpoint instructions"),
        "You are the i654 stream endpoint test agent.", [SV], PROVIDER, MODEL, ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [V1, AGENT, ORG]);
  });
}

/* ─────────────────────────── HTTP helpers ─────────────────────────── */

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

interface ParsedEvent { readonly [key: string]: unknown }

function parseSse(raw: string): ParsedEvent[] {
  return raw
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as ParsedEvent);
}

async function postMessage(text: string, agentId = AGENT, org = ORG, user = ACTOR): Promise<{
  status: number; agentRunId: string; messageId: string;
}> {
  const response = await fetch(`${BASE}/chat/threads/${THREAD}/messages`, {
    method: "POST",
    headers: principal(user, org),
    body: JSON.stringify({ clientMessageId: randomUUID(), text, agentId }),
  });
  if (response.status !== 202) return { status: response.status, agentRunId: "", messageId: "" };
  const body = await response.json() as { agentRunId: string; message: { id: string } };
  return { status: 202, agentRunId: body.agentRunId, messageId: body.message.id };
}

async function getStream(runId: string, user = ACTOR, org = ORG): Promise<{ status: number; events: ParsedEvent[] }> {
  const response = await fetch(`${BASE}/agent-runs/${runId}/stream`, { headers: principal(user, org) });
  const raw = response.status === 200 ? await response.text() : "";
  return { status: response.status, events: response.status === 200 ? parseSse(raw) : [] };
}

/* ─────────────────────────── lifecycle ─────────────────────────── */

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startProvider();
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = providerBase;
  process.env.KERNEL_MODEL_API_KEY = "sk-i654-stream-ep-do-not-echo";
  process.env.KERNEL_MODEL_STREAM_ENABLED = "1";
  delete process.env.KERNEL_AGENT_RUN_AUTOSTART;
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => providerServer.close(() => resolve()));
  delete process.env.KERNEL_MODEL_STREAM_ENABLED;
});

afterEach(() => {
  sseFragments = ["Streamed ", "over ", "the ", "existing ", "thread."];
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
  const otherFx = await seedOrg({ orgId: OTHER_ORG, projectId: `${PROJECT}-other` });
  await addOrgMember(OTHER_ORG, OUTSIDER, "consultant", otherFx.teams.energy!);
  await addSkillVersion();
  await addPublishedAgentVersion();
});

/* ═══════════════════════════ tests ═══════════════════════════ */

describe("GET /agent-runs/:runId/stream", () => {
  it(
    "relays a run created through the ORDINARY POST /chat/threads/:id/messages path -- " +
    "same thread, not a fresh one -- as ordered delta events then a final succeeded event",
    async () => {
      const { status: postStatus, agentRunId } = await postMessage("Stream this over the existing thread");
      expect(postStatus).toBe(202);

      const { status, events } = await getStream(agentRunId);
      expect(status).toBe(200);
      expect(events.filter((e) => e.type === "delta").map((e) => e.text)).toEqual([
        "Streamed ", "over ", "the ", "existing ", "thread.",
      ]);
      expect(events.at(-1)).toMatchObject({ type: "final", status: "succeeded" });

      // Still the SAME thread -- no second thread was created for this turn, unlike the
      // AG-UI bridge's own (documented, unchanged) behaviour.
      const threadCount = await asApp(ORG, (c) =>
        c.query("SELECT count(*)::int AS n FROM chat_threads WHERE org_id=$1", [ORG]));
      expect((threadCount.rows[0] as { n: number }).n).toBe(1);

      const persisted = await asApp(ORG, (c) => c.query<{ body: string }>(
        "SELECT body FROM chat_messages WHERE org_id=$1 AND author_kind='agent' ORDER BY created_at DESC LIMIT 1",
        [ORG],
      ));
      expect(persisted.rows[0]?.body).toBe("Streamed over the existing thread.");
    },
    30_000,
  );

  it("404s for a run id that does not exist, before opening the SSE stream", async () => {
    const { status } = await getStream("no-such-run-id");
    expect(status).toBe(404);
  });

  it("404s for another tenant's run -- not a distinguishable 403 (Chat's I-3 rule)", async () => {
    const { agentRunId } = await postMessage("Only visible to its own org");
    const { status } = await getStream(agentRunId, OUTSIDER, OTHER_ORG);
    expect(status).toBe(404);
  }, 30_000);

  it("a run already terminal by the time the connection opens gets one final event, no deltas replayed", async () => {
    const { agentRunId } = await postMessage("Already done by the time we connect");
    // Let the run actually finish before opening the stream at all.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const { status, events } = await getStream(agentRunId);
    expect(status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "final", status: "succeeded" });
  }, 30_000);
});
