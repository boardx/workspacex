/**
 * #789 -- native AG-UI `TOOL_CALL_*`/`STEP_*` events over `POST /copilotkit/agui`
 * (chat-ux-acceptance-criteria.md items 2/3: "可见的规划步骤"/"可见的工具调用与进度").
 *
 * Same discipline as `agui-bridge-sse.test.ts`'s own file head: a real HTTP POST hits a
 * real Nest app over a real socket, backed by a real (loopback) `ConfiguredModelProvider`
 * stub -- this drives the PRE-#741 TS tool loop (`KERNEL_TOOL_CALLING_ENABLED=1`, still
 * present on this branch's base) for real, through a REAL pinned Skill, and asserts the
 * resulting `AppendedRunStep` rows come back out the SSE wire as real `@ag-ui/core` event
 * types -- not that the internal `onStep` plumbing was called with the right arguments in
 * isolation. Every event's `type` is checked against the real `EventType` enum, same as
 * that file.
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
process.env.KERNEL_TOOL_CALLING_ENABLED = "1";

const ORG = "org-agui-toolcall";
const PROJECT = "proj-agui-toolcall";
const ACTOR = "u-agui-toolcall-actor";

const PROVIDER = "agui-toolcall-loopback";
const AGENT = "agent-agui-toolcall";
const V1 = "agent-version-agui-toolcall-v1";
const SKILL = "skill-agui-toolcall";
const SV = "skill-version-agui-toolcall-v1";
const MODEL = "pinned-model-agui-toolcall";

const PLANNING_NOTE = "我需要先调用画图技能来完成这个任务";
const SKILL_RESULT = "已生成一张架构图。";
const FINAL_TEXT = "已经帮你画好架构图了，请查收。";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

let providerServer: Server;
let providerBase = "";
let orchestratorCalls = 0;

/** Distinguishes the orchestrator round (request body carries `tools`, per #725's
 * `ConfiguredModelProvider.complete`) from the nested skill-execution round (no `tools`,
 * `executeSkillTool`'s own single system/user call) -- same wire shape a real deployment's
 * provider would see, not a test-only signal. */
async function startProvider(): Promise<void> {
  providerServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { tools?: unknown[] };
      res.writeHead(200, { "content-type": "application/json" });
      if (Array.isArray(body.tools) && body.tools.length > 0) {
        orchestratorCalls += 1;
        if (orchestratorCalls === 1) {
          res.end(JSON.stringify({
            choices: [{
              message: {
                role: "assistant", content: PLANNING_NOTE,
                tool_calls: [{
                  id: "call-1", type: "function",
                  function: { name: SKILL, arguments: JSON.stringify({ task: "画一个架构图" }) },
                }],
              },
            }],
          }));
        } else {
          res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: FINAL_TEXT } }] }));
        }
        return;
      }
      // Nested skill-execution call: no `tools`, real focused system=skill-content call.
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: SKILL_RESULT } }] }));
    });
  });
  await new Promise<void>((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
  const addr = providerServer.address() as AddressInfo;
  providerBase = `http://127.0.0.1:${addr.port}`;
}

async function addSkillVersion(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,'画图技能','enabled',$4,now(),now()) ON CONFLICT DO NOTHING`,
      [SKILL, ORG, SKILL, ACTOR],
    );
    await c.query(
      `INSERT INTO skill_versions
         (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,now(),false)`,
      [SV, ORG, SKILL, SV, sha256("# 画图技能"), ACTOR],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, SV, Buffer.from("# 画图技能", "utf8"), sha256("# 画图技能")],
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
      [V1, ORG, AGENT, V1, sha256("agui toolcall instructions"), "You are the AG-UI tool-call test agent.",
        [SV], PROVIDER, MODEL, ACTOR],
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
  await startProvider();
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = providerBase;
  process.env.KERNEL_MODEL_API_KEY = "sk-agui-toolcall-do-not-echo";
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

afterEach(() => { orchestratorCalls = 0; });

beforeEach(async () => {
  orchestratorCalls = 0;
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addSkillVersion();
  await addPublishedAgentVersion();
});

describe("POST /copilotkit/agui -- 真实工具调用产出原生 STEP_*/TOOL_CALL_* 事件", () => {
  it("一次真实的工具调用循环，产出 STEP_STARTED → 规划文本 → TOOL_CALL_START/ARGS/END/RESULT → STEP_FINISHED，再是最终答案", async () => {
    const events = await postBridgeTurn("画一个架构图");

    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.STEP_STARTED,
      EventType.TEXT_MESSAGE_START, // planning note bubble
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.STEP_FINISHED,
      EventType.TEXT_MESSAGE_START, // final answer bubble
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);

    const stepStarted = events.find((e) => e.type === EventType.STEP_STARTED);
    const stepFinished = events.find((e) => e.type === EventType.STEP_FINISHED);
    expect(stepStarted?.stepName).toBe(SKILL);
    expect(stepFinished?.stepName).toBe(SKILL);

    // The planning note is the model's OWN words, visible as real text -- not synthesized.
    const planningContent = events[3];
    expect(planningContent?.type).toBe(EventType.TEXT_MESSAGE_CONTENT);
    expect(planningContent?.delta).toBe(PLANNING_NOTE);

    const toolStart = events.find((e) => e.type === EventType.TOOL_CALL_START);
    const toolArgs = events.find((e) => e.type === EventType.TOOL_CALL_ARGS);
    const toolEnd = events.find((e) => e.type === EventType.TOOL_CALL_END);
    const toolResult = events.find((e) => e.type === EventType.TOOL_CALL_RESULT);
    expect(toolStart?.toolCallName).toBe(SKILL);
    expect(toolStart?.toolCallId).toBe(toolArgs?.toolCallId);
    expect(toolStart?.toolCallId).toBe(toolEnd?.toolCallId);
    expect(toolStart?.toolCallId).toBe(toolResult?.toolCallId);
    expect(toolArgs?.delta).toContain("画一个架构图");
    expect(toolResult?.content).toBe(SKILL_RESULT);
    expect(toolResult?.role).toBe("tool");

    // Final answer is the REAL text the orchestrator's second round produced, not the
    // skill's own result text leaking through as the reply.
    const finalContent = events[events.length - 3];
    expect(finalContent?.type).toBe(EventType.TEXT_MESSAGE_CONTENT);
    expect(finalContent?.delta).toBe(FINAL_TEXT);

    expect(orchestratorCalls).toBe(2); // announce the tool call, then the final answer round
  }, 30_000);
});
