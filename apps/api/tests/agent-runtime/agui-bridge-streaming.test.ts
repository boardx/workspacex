/**
 * #654 阶段2b -- the AG-UI SSE bridge (`POST /copilotkit/agui`) with
 * `KERNEL_MODEL_STREAM_ENABLED=1`: real token-level relay, not 阶段1b's one-shot fallback.
 *
 * A SEPARATE file from `agui-bridge-sse.test.ts`, not an added `describe` block in it:
 * `KERNEL_MODEL_STREAM_ENABLED` is read once by `readModelProviderConfig` at composition
 * time (`ConfiguredModelProvider`'s own file head explains why -- "a mid-flight env change
 * cannot swap a run's provider"), so this file needs its OWN `createApp()` with the flag
 * already set before the Nest app wires its `ModelCallPort`. Running both files' apps in
 * one process with different flag values would mean whichever `createApp()` ran last wins
 * for both.
 *
 * The loopback provider here speaks REAL `text/event-stream` (see
 * `configured-model-provider-stream.test.ts` for the adapter-level version of this same
 * discipline) -- this file is the end-to-end proof that a real SSE upstream response ends
 * up as real, ordered `TEXT_MESSAGE_CONTENT` events on the DOWNSTREAM AG-UI connection.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { AGUI_RUN_PHASE_EVENT_NAME } from "@repo/contracts/agui-state-events";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-agui-bridge-stream";
const PROJECT = "proj-agui-bridge-stream";
const ACTOR = "u-agui-bridge-stream-actor";

const PROVIDER = "agui-bridge-stream-loopback";
const AGENT = "agent-agui-bridge-stream";
const V1 = "agent-version-agui-bridge-stream-v1";
const SKILL = "skill-agui-bridge-stream";
const SV = "skill-version-agui-bridge-stream-v1";
const MODEL = "pinned-model-agui-bridge-stream";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ─────────────────────────── loopback SSE provider ─────────────────────────── */

let providerServer: Server;
let providerBase = "";
let providerCalls = 0;
let sseFragments: string[] = ["The ", "answer ", "streamed ", "in pieces."];

function sseFrame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

async function startProvider(): Promise<void> {
  providerServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      providerCalls += 1;
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
      [SV, ORG, SKILL, SV, sha256("# AG-UI streaming bridge skill"), ACTOR],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, SV, Buffer.from("# AG-UI streaming bridge skill", "utf8"), sha256("# AG-UI streaming bridge skill")],
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
      [V1, ORG, AGENT, V1, sha256("agui streaming bridge instructions"),
        "You are the AG-UI streaming bridge test agent.", [SV], PROVIDER, MODEL, ACTOR],
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

interface ParsedSseEvent {
  readonly type: EventType;
  readonly [key: string]: unknown;
}

function parseSse(raw: string): ParsedSseEvent[] {
  return raw
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as ParsedSseEvent);
}

async function postBridgeTurn(text: string): Promise<{ status: number; events: ParsedSseEvent[] }> {
  const url = new URL(`${BASE}/copilotkit/agui`);
  url.searchParams.set("agentId", AGENT);
  const response = await fetch(url, {
    method: "POST",
    headers: principal(ACTOR, ORG),
    body: JSON.stringify({
      threadId: randomUUID(), runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: text }],
    }),
  });
  const raw = await response.text();
  return { status: response.status, events: response.status === 200 ? parseSse(raw) : [] };
}

/* ─────────────────────────── lifecycle ─────────────────────────── */

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startProvider();
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = providerBase;
  process.env.KERNEL_MODEL_API_KEY = "sk-agui-bridge-stream-do-not-echo";
  process.env.KERNEL_MODEL_STREAM_ENABLED = "1"; // The one thing this file adds vs 阶段1b's suite.
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
  sseFragments = ["The ", "answer ", "streamed ", "in pieces."];
});

beforeEach(async () => {
  providerCalls = 0;
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addSkillVersion();
  await addPublishedAgentVersion();
});

/* ═══════════════════════════ tests ═══════════════════════════ */

describe("POST /copilotkit/agui with KERNEL_MODEL_STREAM_ENABLED=1", () => {
  it(
    "relays each upstream SSE fragment as its own ordered TEXT_MESSAGE_CONTENT event, " +
    "not one final blob -- and does not resend the whole text afterwards",
    async () => {
      const { status, events } = await postBridgeTurn("Stream this, please");
      expect(status).toBe(200);

      // `run_phase` (context_building / model_thinking) is prep-stage progress plumbing --
      // see agui-bridge-state-events.test.ts's PLUMBING_CUSTOM_EVENT_NAMES doc -- and fires
      // an indeterminate number of times (0-2) depending on polling timing, so positional
      // assertions below are taken against the events with it filtered out.
      const nonPhaseEvents = events.filter(
        (e) => !(e.type === EventType.CUSTOM &&
          (e.name === AGUI_RUN_PHASE_EVENT_NAME || e.name === "execution_event")),
      );

      // RUN_STARTED first, THEN DA-19a's CUSTOM chat_thread_id (every real run mints/echoes
      // one via `onThreadResolved`, which fires unconditionally before `onStarted` -- see
      // `agui-bridge.ts`), THEN the streamed content, THEN a lone TEXT_MESSAGE_END -- never
      // a second CONTENT carrying the whole answer again.
      expect(nonPhaseEvents[0]?.type).toBe(EventType.RUN_STARTED);
      expect(nonPhaseEvents[1]?.type).toBe(EventType.CUSTOM);
      expect(nonPhaseEvents[2]?.type).toBe(EventType.TEXT_MESSAGE_START);

      const contentEvents = events.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
      expect(contentEvents.map((e) => e.delta)).toEqual(["The ", "answer ", "streamed ", "in pieces."]);

      const messageId = nonPhaseEvents[2]?.messageId as string;
      expect(contentEvents.every((e) => e.messageId === messageId)).toBe(true);

      // CK-P3（issue #2054）—— 收尾多了一个 `CUSTOM chat_message_id`（回显这条 assistant
      // 消息的真实 `chat_messages.id`），刻意夹在 TEXT_MESSAGE_END 与 RUN_FINISHED 之间：
      // 客户端收到它时气泡已完整，这一轮还没结束。本条用例真正要钉的
      // 「不在末尾把整段文字再发一遍」没有变——尾巴里仍然只有一个 TEXT_MESSAGE_END，
      // 没有第二个 TEXT_MESSAGE_CONTENT。
      const tail = nonPhaseEvents.slice(-3).map((e) => e.type);
      expect(tail).toEqual([
        EventType.TEXT_MESSAGE_END, EventType.CUSTOM, EventType.RUN_FINISHED,
      ]);
      // 显式反证（原来只由 slice(-2) 隐含）：整段重发会多出一条 CONTENT。
      expect(contentEvents).toHaveLength(4);
      const end = events.find((e) => e.type === EventType.TEXT_MESSAGE_END);
      expect(end?.messageId).toBe(messageId);

      // The persisted Chat message is still the full concatenation -- streaming the
      // relay does not change what actually lands in the writeback.
      const persisted = await asApp(ORG, (c) => c.query<{ body: string }>(
        "SELECT body FROM chat_messages WHERE org_id=$1 AND author_kind='agent' ORDER BY created_at DESC LIMIT 1",
        [ORG],
      ));
      expect(persisted.rows[0]?.body).toBe("The answer streamed in pieces.");
      expect(providerCalls).toBe(1);
    },
    30_000,
  );

  it("a single-fragment reply still streams (one TEXT_MESSAGE_CONTENT, not zero)", async () => {
    sseFragments = ["Only one fragment this time."];
    const { events } = await postBridgeTurn("Single fragment");
    const contentEvents = events.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
    expect(contentEvents.map((e) => e.delta)).toEqual(["Only one fragment this time."]);
  }, 30_000);
});
