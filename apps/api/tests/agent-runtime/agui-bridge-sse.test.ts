/**
 * #654 Phase 1b -- the AG-UI SSE bridge (`POST /copilotkit/agui`).
 *
 * ## What this proves, over a REAL socket
 *
 * A real HTTP POST hits a real Nest app, backed by a real Postgres and a real (loopback)
 * model provider -- no port is stubbed at the boundary this file cares about. The response
 * is parsed as an actual `text/event-stream` body (`data: <json>\n\n` frames), not read out
 * of an internal object, so a bug in the SSE framing itself (missing blank line, wrong
 * content-type, JSON that doesn't round-trip) would fail this file the same way it would
 * fail a real AG-UI client.
 *
 * Every event's `type` is checked against `@ag-ui/core`'s own `EventType` enum -- the same
 * package `@ag-ui/client`'s `HttpAgent` uses to parse the stream -- so "the shape this
 * bridge emits" and "the shape a real AG-UI client accepts" cannot silently drift apart in
 * this test file itself.
 *
 * The assistant text asserted in "succeeds" is the EXACT bytes the loopback provider stub
 * put on the wire (see `no-tool-run-writeback.test.ts`'s own file head for why that
 * discipline matters) -- proving the bridge relays the real writeback, not a fabricated
 * reply.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-agui-bridge";
const OTHER_ORG = "org-agui-bridge-other";
const PROJECT = "proj-agui-bridge";
const ACTOR = "u-agui-bridge-actor";

const PROVIDER = "agui-bridge-loopback";
const AGENT = "agent-agui-bridge";
const V1 = "agent-version-agui-bridge-v1";
const SKILL = "skill-agui-bridge";
const SV = "skill-version-agui-bridge-v1";
const MODEL = "pinned-model-agui-bridge";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ─────────────────────────── loopback provider ─────────────────────────── */

let providerServer: Server;
let providerBase = "";
let nextReplyText = "durable AG-UI reply from the loopback provider";
let providerCalls = 0;

async function startProvider(): Promise<void> {
  providerServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      providerCalls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: nextReplyText } }] }));
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
      [SV, ORG, SKILL, SV, sha256("# AG-UI bridge skill"), ACTOR],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, SV, Buffer.from("# AG-UI bridge skill", "utf8"), sha256("# AG-UI bridge skill")],
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
      [V1, ORG, AGENT, V1, sha256("agui bridge instructions"), "You are the AG-UI bridge test agent.",
        [SV], PROVIDER, MODEL, ACTOR],
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

/** Parses a real `text/event-stream` body into the individual `data:` JSON frames. */
function parseSse(raw: string): ParsedSseEvent[] {
  return raw
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as ParsedSseEvent);
}

async function postBridgeTurn(input: {
  text: string; agentId?: string; agentIdSource?: string; user?: string; org?: string;
  chatThreadId?: string;
}): Promise<{ status: number; contentType: string | null; events: ParsedSseEvent[] }> {
  const agentId = input.agentId === undefined ? AGENT : input.agentId;
  const url = new URL(`${BASE}/copilotkit/agui`);
  if (agentId !== "") url.searchParams.set("agentId", agentId);
  if (input.agentIdSource !== undefined) url.searchParams.set("agentIdSource", input.agentIdSource);
  const response = await fetch(url, {
    method: "POST",
    headers: principal(input.user ?? ACTOR, input.org ?? ORG),
    body: JSON.stringify({
      threadId: randomUUID(), runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: input.text }],
      ...(input.chatThreadId !== undefined ? { forwardedProps: { chatThreadId: input.chatThreadId } } : {}),
    }),
  });
  const raw = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    events: response.status === 200 ? parseSse(raw) : [],
  };
}

/* ─────────────────────────── lifecycle ─────────────────────────── */

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startProvider();
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = providerBase;
  process.env.KERNEL_MODEL_API_KEY = "sk-agui-bridge-do-not-echo";
  // Unset (autostart default ON): `kick()` after accept must actually drive execution in
  // the background for the bridge's own poll loop to observe a terminal status -- this
  // file is proving the REAL request/response round trip, not driving `tick()` by hand.
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
});

beforeEach(async () => {
  providerCalls = 0;
  nextReplyText = "durable AG-UI reply from the loopback provider";
  await resetOrgs(ORG, OTHER_ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await seedOrg({ orgId: OTHER_ORG, projectId: `${PROJECT}-other` });
  await addSkillVersion();
  await addPublishedAgentVersion();
});

/* ═══════════════════════════ tests ═══════════════════════════ */

describe("POST /copilotkit/agui", () => {
  it(
    "wraps a real agent-run create+poll turn into a well-formed AG-UI SSE event sequence, " +
    "carrying the writeback's real bytes -- not a fabricated reply",
    async () => {
      nextReplyText = "durable AG-UI reply from the loopback provider";
      const { status, contentType, events } = await postBridgeTurn({
        text: "Hello from an AG-UI client",
      });

      expect(status).toBe(200);
      expect(contentType).toContain("text/event-stream");

      // Every event's `type` is a real `@ag-ui/core` `EventType` member -- proves this
      // bridge's wire format is what a real `HttpAgent` (via `@ag-ui/client`) parses.
      for (const event of events) {
        expect(Object.values(EventType)).toContain(event.type);
      }

      // DA-19a -- every real run now also mints/echoes a `CUSTOM chat_thread_id` event
      // right after RUN_STARTED (see `copilotkit-agui.controller.ts`'s own doc), so it's
      // a permanent fixture of this sequence, not a one-off variant.
      expect(events.map((e) => e.type)).toEqual([
        EventType.RUN_STARTED,
        EventType.CUSTOM,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.RUN_FINISHED,
      ]);

      const content = events.find((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
      expect(content?.delta).toBe("durable AG-UI reply from the loopback provider");

      const start = events.find((e) => e.type === EventType.TEXT_MESSAGE_START);
      expect(start?.role).toBe("assistant");
      expect(start?.messageId).toBe(content?.messageId);
      const end = events.find((e) => e.type === EventType.TEXT_MESSAGE_END);
      expect(end?.messageId).toBe(content?.messageId);

      expect(providerCalls).toBe(1);

      // The reply is the persisted Chat message's real bytes, read via the same store the
      // Chat UI reads -- not text invented by the bridge.
      const persisted = await asApp(ORG, (c) => c.query<{ body: string }>(
        "SELECT body FROM chat_messages WHERE org_id=$1 AND author_kind='agent' ORDER BY created_at DESC LIMIT 1",
        [ORG],
      ));
      expect(persisted.rows[0]?.body).toBe("durable AG-UI reply from the loopback provider");
    },
    30_000,
  );

  it("opens a fresh personal thread per turn (single-round scope) rather than requiring one", async () => {
    const before = await asApp(ORG, (c) => c.query("SELECT count(*)::int AS n FROM chat_threads WHERE org_id=$1", [ORG]));
    await postBridgeTurn({ text: "First turn" });
    const afterFirst = await asApp(ORG, (c) => c.query("SELECT count(*)::int AS n FROM chat_threads WHERE org_id=$1", [ORG]));
    expect((afterFirst.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n + 1);

    await postBridgeTurn({ text: "Second turn, independent" });
    const afterSecond = await asApp(ORG, (c) => c.query("SELECT count(*)::int AS n FROM chat_threads WHERE org_id=$1", [ORG]));
    expect((afterSecond.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n + 2);
  }, 30_000);

  it("emits RUN_ERROR (not a fabricated success) when the Agent id is unpublished", async () => {
    const { status, events } = await postBridgeTurn({ text: "Hello", agentId: "no-such-agent" });
    expect(status).toBe(200); // The SSE channel itself opens; the failure travels IN the stream.
    expect(events.map((e) => e.type)).toEqual([EventType.RUN_ERROR]);
    expect(events[0]?.code).toBe("AGENT_NOT_FOUND");
  }, 30_000);

  // #2038 —— 「没带 agentId = 服务端按 org 解析动态默认」取代了旧的「没带就 422」。
  // devapp 实测事故：默认靠全局单值 env，配错（填成 agent_versions.id）整条轨道死掉。
  it("#2038: no agentId at all -> resolves the org's deterministic default and completes a REAL turn", async () => {
    nextReplyText = "reply from the org default agent";
    const { status, events } = await postBridgeTurn({ text: "Hello with no agent chosen", agentId: "" });
    expect(status).toBe(200);
    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED, EventType.CUSTOM, EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END, EventType.RUN_FINISHED,
    ]);
    // 反证：回复是默认 agent 那次 run 的真实 writeback 字节，不是伪造的成功。
    const content = events.find((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
    expect(content?.delta).toBe("reply from the org default agent");
    expect(providerCalls).toBe(1);
  }, 30_000);

  it("#2038: a MISCONFIGURED env default (agentIdSource=env-default, unresolvable id) falls back " +
    "to the org default instead of killing the whole track -- the devapp incident's exact shape", async () => {
    nextReplyText = "fallback saved this turn";
    const { status, events } = await postBridgeTurn({
      text: "env default is a version id by mistake",
      agentId: "agent-version-5c3eb303-misconfigured", agentIdSource: "env-default",
    });
    expect(status).toBe(200);
    expect(events.map((e) => e.type)).toContain(EventType.RUN_FINISHED);
    const content = events.find((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
    expect(content?.delta).toBe("fallback saved this turn");
    expect(providerCalls).toBe(1);
  }, 30_000);

  it("#2038: a VALID env default (agentIdSource=env-default) is used as-is -- back-compat, no fallback", async () => {
    nextReplyText = "env default still honoured";
    const { status, events } = await postBridgeTurn({
      text: "env default is valid", agentId: AGENT, agentIdSource: "env-default",
    });
    expect(status).toBe(200);
    const content = events.find((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
    expect(content?.delta).toBe("env default still honoured");
  }, 30_000);

  it("#2038: an org with NO published agent at all still 422s honestly (nothing to default to)", async () => {
    await addOrgMember(OTHER_ORG, ACTOR, "consultant", null);
    const response = await fetch(`${BASE}/copilotkit/agui`, {
      method: "POST",
      headers: principal(ACTOR, OTHER_ORG),
      body: JSON.stringify({
        threadId: randomUUID(), runId: randomUUID(),
        messages: [{ id: randomUUID(), role: "user", content: "Hello" }],
      }),
    });
    expect(response.status).toBe(422);
  });

  it("DA-19a: RUN_STARTED is ALWAYS the first event -- CUSTOM chat_thread_id (when present) " +
    "comes right after it, never before (a real @ag-ui/client HttpAgent rejects the whole " +
    "stream otherwise -- see the controller file head)", async () => {
    const { events } = await postBridgeTurn({ text: "First turn, no chatThreadId yet" });
    expect(events[0]?.type).toBe(EventType.RUN_STARTED);
    const custom = events.find((e) => e.type === EventType.CUSTOM && (e as { name?: string }).name === "chat_thread_id");
    expect(custom).toBeDefined();
    expect(events.indexOf(custom!)).toBe(1); // immediately after RUN_STARTED
    expect(typeof (custom as { value?: unknown }).value).toBe("string");
  }, 30_000);

  it("DA-19a: reusing the CUSTOM-reported chat_thread_id on the next turn continues the " +
    "SAME Chat thread (real cross-turn continuation, not a fresh thread every time)", async () => {
    const before = await asApp(ORG, (c) => c.query("SELECT count(*)::int AS n FROM chat_threads WHERE org_id=$1", [ORG]));

    const first = await postBridgeTurn({ text: "First message please remember 42" });
    const firstCustom = first.events.find(
      (e) => e.type === EventType.CUSTOM && (e as { name?: string }).name === "chat_thread_id",
    ) as { value: string } | undefined;
    expect(firstCustom).toBeDefined();
    const chatThreadId = firstCustom!.value;

    const afterFirst = await asApp(ORG, (c) => c.query("SELECT count(*)::int AS n FROM chat_threads WHERE org_id=$1", [ORG]));
    expect((afterFirst.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n + 1);

    const second = await postBridgeTurn({ text: "Second message, same thread", chatThreadId });
    const secondCustom = second.events.find(
      (e) => e.type === EventType.CUSTOM && (e as { name?: string }).name === "chat_thread_id",
    ) as { value: string } | undefined;
    expect(secondCustom?.value).toBe(chatThreadId); // same Chat thread id echoed back

    // No SECOND thread got created -- both turns landed in the one Chat thread.
    const afterSecond = await asApp(ORG, (c) => c.query("SELECT count(*)::int AS n FROM chat_threads WHERE org_id=$1", [ORG]));
    expect((afterSecond.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n + 1);

    // Both turns' messages are really persisted on the SAME thread row.
    const messages = await asApp(ORG, (c) => c.query<{ body: string; author_kind: string }>(
      "SELECT body, author_kind FROM chat_messages WHERE org_id=$1 AND thread_id=$2 ORDER BY created_at ASC",
      [ORG, chatThreadId],
    ));
    expect(messages.rows.filter((m) => m.author_kind === "human").map((m) => m.body)).toEqual([
      "First message please remember 42",
      "Second message, same thread",
    ]);
  }, 30_000);

  it("422s when the AG-UI body carries no user message", async () => {
    const url = new URL(`${BASE}/copilotkit/agui`);
    url.searchParams.set("agentId", AGENT);
    const response = await fetch(url, {
      method: "POST",
      headers: principal(ACTOR, ORG),
      body: JSON.stringify({ threadId: randomUUID(), runId: randomUUID(), messages: [] }),
    });
    expect(response.status).toBe(422);
  });
});
