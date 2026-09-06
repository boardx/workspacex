/**
 * issue #2768/#2778 -- the SAME assistant sentence must not surface as two separate
 * `TEXT_MESSAGE_*` bubbles over `POST /copilotkit/agui` when `KERNEL_DEEP_AGENT_STREAM_
 * ENABLED=1` (devapp's own config).
 *
 * ## The bug this file is the regression guard for
 *
 * `deep-agent-model-provider.ts`'s `extractToolCallEvents` copies the model's own
 * `AIMessage.content` (the sentence right before a tool call) into that step's
 * `planningNote`. `copilotkit-agui.controller.ts`'s `writeToolCallStep` renders a NEW text
 * bubble for a non-empty `planningNote` (chat-ux-acceptance-criteria.md item 2, "可见的
 * 规划步骤") -- correct when nothing else would ever surface that text. But when streaming
 * is enabled, that EXACT text was ALREADY delivered, token by token, into the turn's ONE
 * running answer bubble via `onDelta` BEFORE the tool call is even recorded (`tryStreamRun`'s
 * `messages-tuple` frames arrive over the wire well before the state-polling loop notices
 * the tool call) -- so the planning-note bubble duplicates it. A real devapp capture (see
 * #2768's evidence comment) showed exactly this: two `TEXT_MESSAGE_START`s, different
 * `messageId`s, byte-identical `TEXT_MESSAGE_CONTENT`.
 *
 * `agui-bridge-tool-call-events.test.ts` (same fixture shape, streaming OFF) intentionally
 * keeps asserting TWO bubbles (planning note + final answer) -- that is still correct
 * there, since without streaming the planning-note bubble is the ONLY place that text ever
 * surfaces. This file is the missing combination: streaming ON *and* a tool call carrying a
 * planning note, which no existing file covered before this fix.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { DEEP_AGENT_PROVIDER_NAME } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-agui-planning-dedup";
const PROJECT = "proj-agui-planning-dedup";
const ACTOR = "u-agui-planning-dedup-actor";

const AGENT = "agent-agui-planning-dedup";
const V1 = "agent-version-agui-planning-dedup-v1";
const SKILL = "skill-agui-planning-dedup";
const SV = "skill-version-agui-planning-dedup-v1";
const MODEL = "pinned-model-agui-planning-dedup";

const PLANNING_NOTE = "我来用 PDF 技能生成一份「我能做什么」的说明文档。";
const PLANNING_CHUNKS = ["我来用 PDF ", "技能生成一份", "「我能做什么」的说明文档。"];
const SKILL_RESULT = "已生成 PDF。";
const FINAL_TEXT = "我已经根据你的要求生成了 PDF，请查看附件。";
const FINAL_CHUNKS = ["我已经根据你的要求生成了 ", "PDF，请查看附件。"];
const TOOL_CALL_ID = "call-1";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

let langgraphServer: Server;
let langgraphBase = "";
let threadId = "";
let runId = "";
let stateCallCount = 0;
let statusCallCount = 0;
let streamFinished = false;

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startLanggraphServer(): Promise<void> {
  langgraphServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/threads") {
      return respond(res, 200, { thread_id: threadId });
    }
    if (req.method === "POST" && url === `/threads/${threadId}/runs`) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => respond(res, 200, { run_id: runId }));
      return;
    }
    // DA-03 -- the real `messages-tuple` streaming endpoint: ONE ongoing connection for the
    // WHOLE run, same as a real engine (see `deep-agent-model-provider.ts`'s own `createRun`
    // comment on why `stream_mode` is declared at run-creation time, not per-message) --
    // delivers the pre-tool-call planning sentence's tokens, THEN (the graph continuing
    // past the tool call within the SAME connection) the final answer's tokens too. No
    // `tool_call_id` on any chunk (matches real-engine observation documented on
    // `tryStreamRun`'s own head).
    if (req.method === "GET" && url === `/threads/${threadId}/runs/${runId}/stream`) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const [id, chunks] of [["planning", PLANNING_CHUNKS], ["final", FINAL_CHUNKS]] as const) for (const chunk of chunks) {
        res.write(`event: messages\ndata: [{"content": ${JSON.stringify(chunk)}, "type": "AIMessageChunk", "id": ${JSON.stringify(id)}}, {}]\n\n`);
      }
      streamFinished = true;
      res.end();
      return;
    }
    if (req.method === "GET" && url === `/threads/${threadId}/runs/${runId}`) {
      const status = !streamFinished && statusCallCount === 0 ? "running" : "success";
      statusCallCount += 1;
      return respond(res, 200, { status });
    }
    if (req.method === "GET" && url === `/threads/${threadId}/state`) {
      const messages = !streamFinished && stateCallCount === 0
        ? [{ type: "human", content: "生成一个 pdf，总结你可以做的事情" }]
        : [
          { type: "human", content: "生成一个 pdf，总结你可以做的事情" },
          {
            type: "ai", id: "planning", content: PLANNING_NOTE,
            tool_calls: [{
              id: TOOL_CALL_ID, name: "call_skill",
              args: { skill_stable_name: SKILL, task: "生成一份说明文档 PDF" },
            }],
          },
          { type: "tool", tool_call_id: TOOL_CALL_ID, content: SKILL_RESULT },
          { type: "ai", id: "final", content: FINAL_TEXT },
        ];
      stateCallCount += 1;
      return respond(res, 200, { values: { messages } });
    }
    respond(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => langgraphServer.listen(0, "127.0.0.1", resolve));
  const addr = langgraphServer.address() as AddressInfo;
  langgraphBase = `http://127.0.0.1:${addr.port}`;
}

async function addSkillVersion(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,'PDF 生成','enabled',$4,now(),now()) ON CONFLICT DO NOTHING`,
      [SKILL, ORG, SKILL, ACTOR],
    );
    await c.query(
      `INSERT INTO skill_versions
         (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,now(),false)`,
      [SV, ORG, SKILL, SV, sha256("# PDF 生成技能"), ACTOR],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, SV, Buffer.from("# PDF 生成技能", "utf8"), sha256("# PDF 生成技能")],
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
      [V1, ORG, AGENT, V1, sha256("agui planning dedup instructions"), "You are the AG-UI planning-note dedup test agent.",
        [SV], DEEP_AGENT_PROVIDER_NAME, MODEL, ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [V1, AGENT, ORG]);
  });
}

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

async function postBridgeTurn(text: string): Promise<ParsedSseEvent[]> {
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
  expect(response.status, raw).toBe(200);
  return parseSse(raw);
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startLanggraphServer();
  process.env.KERNEL_DEEP_AGENT_BASE_URL = langgraphBase;
  process.env.KERNEL_DEEP_AGENT_POLL_INTERVAL_MS = "5";
  process.env.KERNEL_DEEP_AGENT_TIMEOUT_MS = "10000";
  // The one thing this file adds vs `agui-bridge-tool-call-events.test.ts`: real deep-agent
  // token streaming turned on, composed into the Nest app at construction time (same
  // discipline `agui-bridge-streaming.test.ts`'s own `KERNEL_MODEL_STREAM_ENABLED` head
  // comment explains -- a mid-flight env change cannot swap a run's provider).
  process.env.KERNEL_DEEP_AGENT_STREAM_ENABLED = "1";
  delete process.env.KERNEL_AGENT_RUN_AUTOSTART;
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => langgraphServer.close(() => resolve()));
  delete process.env.KERNEL_DEEP_AGENT_STREAM_ENABLED;
});

beforeEach(async () => {
  threadId = `thread-${randomUUID()}`;
  runId = `run-${randomUUID()}`;
  stateCallCount = 0;
  statusCallCount = 0;
  streamFinished = false;
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addSkillVersion();
  await addPublishedAgentVersion();
});

describe("POST /copilotkit/agui + KERNEL_DEEP_AGENT_STREAM_ENABLED=1 -- 规划文案不重复", () => {
  it("流式已经送过的规划句子，不会再作为 planningNote 气泡重复发一遍", async () => {
    const events = await postBridgeTurn("生成一个 pdf，总结你可以做的事情");

    const contentEvents = events.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
    const bubbleTextById = new Map<string, string>();
    for (const e of contentEvents) {
      const id = e.messageId as string;
      bubbleTextById.set(id, (bubbleTextById.get(id) ?? "") + (e.delta as string));
    }
    const bubbleTexts = [...bubbleTextById.values()];

    // The journal preserves the upstream planning/final message identities instead
    // of merging them. Both appear once; no synthetic planning-note copy is added.
    expect(bubbleTexts, JSON.stringify(bubbleTexts)).toEqual([PLANNING_NOTE, FINAL_TEXT]);
    expect(bubbleTexts.filter(t=>t===PLANNING_NOTE)).toHaveLength(1);
    expect([...bubbleTextById.keys()].some(id=>id.endsWith(':planning'))).toBe(true);
    expect([...bubbleTextById.keys()].some(id=>id.endsWith(':final'))).toBe(true);

    // 工具调用本身的可见性不受影响：STEP_*/TOOL_CALL_* 序列照常出现。
    const stepStarted = events.find((e) => e.type === EventType.STEP_STARTED);
    const toolResult = events.find((e) => e.type === EventType.TOOL_CALL_RESULT);
    expect(stepStarted?.stepName).toBe("call_skill");
    expect(toolResult?.content).toBe(SKILL_RESULT);

    // 持久化的最终回复仍然是模型真实终稿，不受本次修复影响。
    const persisted = await asApp(ORG, (c) => c.query<{ body: string }>(
      "SELECT body FROM chat_messages WHERE org_id=$1 AND author_kind='agent' ORDER BY created_at DESC LIMIT 1",
      [ORG],
    ));
    expect(persisted.rows[0]?.body).toBe(FINAL_TEXT);
  }, 30_000);
});
