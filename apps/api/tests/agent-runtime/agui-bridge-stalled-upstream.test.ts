/**
 * 「上游卡住」必须变成一条**指名道姓的 RUN_ERROR**，而不是一条什么都不说的
 * `Test timed out in 30000ms`（2026-09-09）。
 *
 * 这是 agui-bridge 系列反复超时那次定位的现场复现，留成常驻回归：上游替身收下请求就
 * 再也不回，run 因此永远走不到终态。修复前（中继预算 900s、`afterAll` 裸 close）这条
 * 的真实输出是——
 *
 *   × counterproof: a stalled upstream  30109ms  → Test timed out in 30000ms.
 *   FAIL [ ... ]  Error: Hook timed out in 120000ms.
 *   Duration 157.42s
 *
 * ——注意它一个字都没说是谁卡住了，而且那条 `Hook timed out` 会把**整个文件**判红。
 * 修复后：中继在测试预算内自己到期，发 RUN_ERROR，用例在 ~21s 内拿到可诊断的结论。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { closeAppDeterministically, closeHttpServerDeterministically } from "../support/close-app";
import {
  AGUI_CHAT_MESSAGE_ID_EVENT_NAME,
  AGUI_RUN_PHASE_EVENT_NAME,
  AguiChatMessageIdValue,
} from "@repo/contracts/agui-state-events";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-agui-stall";
const OTHER_ORG = "org-agui-stall-other";
const PROJECT = "proj-agui-stall";
const ACTOR = "u-agui-stall-actor";

const PROVIDER = "agui-stall-loopback";
const AGENT = "agent-agui-stall";
const V1 = "agent-version-agui-stall-v1";
const SKILL = "skill-agui-stall";
const SV = "skill-version-agui-stall-v1";
const MODEL = "pinned-model-agui-stall";

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
      void res; void nextReplyText; // stand-in: accepts the request, never answers.
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
  await app.listen(0, "127.0.0.1");
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await closeAppDeterministically(app);
  await closeHttpServerDeterministically(providerServer);
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


describe("counterproof: a stalled upstream", () => {
  it("fails with a NAMED relay timeout inside the test budget, not a naked Test timeout", async () => {
    const started = Date.now();
    const r = await postBridgeTurn({ text: "hello" });
    const elapsedMs = Date.now() - started;
    console.log(`[counterproof] elapsedMs=${elapsedMs} types=${JSON.stringify(r.events.map((e) => e.type))}`);
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.type)).toContain(EventType.RUN_ERROR);
    expect(elapsedMs).toBeLessThan(30_000);
  }, 30_000);
});
