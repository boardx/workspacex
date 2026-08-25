/**
 * #789 -- native AG-UI `TOOL_CALL_*`/`STEP_*` events over `POST /copilotkit/agui`
 * (chat-ux-acceptance-criteria.md items 2/3: "可见的规划步骤"/"可见的工具调用与进度").
 *
 * Same discipline as `agui-bridge-sse.test.ts`'s own file head: a real HTTP POST hits a
 * real Nest app over a real socket, and asserts the resulting `AppendedRunStep` rows come
 * back out the SSE wire as real `@ag-ui/core` event types -- not that the internal `onStep`
 * plumbing was called with the right arguments in isolation. Every event's `type` is checked
 * against the real `EventType` enum, same as that file.
 *
 * 2026-08-09 补：原版本驱动的是 #741 已经下线的 TS 工具循环（`KERNEL_TOOL_CALLING_ENABLED`
 * + `ConfiguredModelProvider` 假 OpenAI `tool_calls` 响应）——这条测试是 #796 在 #751
 * 合并**之前**写的，`main` 上 #751 落地后这条测试驱动的执行路径已经不存在（那个环境变量
 * 与假响应形状变成了死代码，run 退化成纯文本单次调用，只产出 5 个事件而不是期望的 14
 * 个）。改为驱动**当前真实的**路径：`DeepAgentModelProvider`（#740/#747）对着一个真实的
 * loopback LangGraph 服务器（同 `deep-agent-model-provider.test.ts` 的手法），
 * `completeWithProgress`（#742/#756/#788）在轮询里把 `AIMessage.tool_calls` 与配对的
 * `ToolMessage` 结果翻译成一个 `ModelCallProgressEvent`，`execute-run.ts` 把它记成一条真实
 * 的 `tool_call` run step，桥接层（#789，本文件测的对象）再把那条 step 翻译成
 * `STEP_STARTED → ... → STEP_FINISHED` 的原生 AG-UI 事件序列——桥接层本身的翻译逻辑完全
 * 没变，变的只是这个测试怎么让一条真实的 `tool_call` step 产生出来。
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

const ORG = "org-agui-toolcall";
const PROJECT = "proj-agui-toolcall";
const ACTOR = "u-agui-toolcall-actor";

const AGENT = "agent-agui-toolcall";
const V1 = "agent-version-agui-toolcall-v1";
const SKILL = "skill-agui-toolcall";
const SV = "skill-version-agui-toolcall-v1";
const MODEL = "pinned-model-agui-toolcall";

const PLANNING_NOTE = "我需要先调用画图技能来完成这个任务";
const SKILL_RESULT = "已生成一张架构图。";
const FINAL_TEXT = "已经帮你画好架构图了，请查收。";
const TOOL_CALL_ID = "call-1";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

let langgraphServer: Server;
let langgraphBase = "";
let threadId = "";
let runId = "";
/** `min(count, len-1)` 索引法，同 `deep-agent-model-provider.test.ts`：第一次轮询看到
 * 只有人类消息（还没有工具调用），后续轮询看到完整的最终状态（工具调用+结果+最终答案
 * 全部到位）——`extractToolCallEvents` 自己的 `alreadyEmitted` 去重保证同一个工具调用
 * 不会被上报两次，所以"后续轮询都返回同一个完整状态"是安全的，不需要为每一次轮询单独
 * 建一个中间态。 */
let stateCallCount = 0;
let statusCallCount = 0;

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
    if (req.method === "GET" && url === `/threads/${threadId}/runs/${runId}`) {
      const status = statusCallCount === 0 ? "running" : "success";
      statusCallCount += 1;
      return respond(res, 200, { status });
    }
    if (req.method === "GET" && url === `/threads/${threadId}/state`) {
      const messages = stateCallCount === 0
        ? [{ type: "human", content: "画一个架构图" }]
        : [
          { type: "human", content: "画一个架构图" },
          {
            type: "ai", content: PLANNING_NOTE,
            tool_calls: [{
              id: TOOL_CALL_ID, name: "call_skill",
              args: { skill_stable_name: SKILL, task: "画一个架构图" },
            }],
          },
          { type: "tool", tool_call_id: TOOL_CALL_ID, content: SKILL_RESULT },
          { type: "ai", content: FINAL_TEXT },
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
});

beforeEach(async () => {
  threadId = `thread-${randomUUID()}`;
  runId = `run-${randomUUID()}`;
  stateCallCount = 0;
  statusCallCount = 0;
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

    // DA-19a -- every real run also mints/echoes a CUSTOM chat_thread_id event right after
    // RUN_STARTED (`onThreadResolved` fires unconditionally before `onStarted`, see
    // agui-bridge.ts / copilotkit-agui.controller.ts's own doc); permanent fixture, not a
    // one-off variant.
    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.CUSTOM,
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
      // CK-P3 (issue #2054) -- `CUSTOM chat_message_id`：回显最终那条 assistant 消息的
      // 真实 `chat_messages.id`。位置刻意在最终气泡的 TEXT_MESSAGE_END 之后、
      // RUN_FINISHED 之前：它指的是**落库的那条最终回复**，不是中途的规划气泡
      // （规划气泡本身不落 chat_messages，也就没有 id 可回显）。
      EventType.CUSTOM,
      EventType.RUN_FINISHED,
    ]);

    // #789 的桥接层用持久化的 tool_call step 自己的 toolName 当 stepName——那是
    // execute-run.ts 里 completeWithProgress 分支记录的 `call_skill`（deepagents 的
    // 通用工具名，见 tools.py），不是被调用的那个 skill 自己的名字（`SKILL` 常量），
    // 这条断言直接反映 #740 的架构：工具集合是 `list_org_skills`/`call_skill` 这两个
    // 通用工具，skill 本身是它们的参数，不是各自的工具。
    const stepStarted = events.find((e) => e.type === EventType.STEP_STARTED);
    const stepFinished = events.find((e) => e.type === EventType.STEP_FINISHED);
    expect(stepStarted?.stepName).toBe("call_skill");
    expect(stepFinished?.stepName).toBe("call_skill");

    // The planning note is the model's OWN words, visible as real text -- not synthesized.
    // Index 4, not 3: DA-19a's CUSTOM chat_thread_id shifted every following index by one.
    const planningContent = events[4];
    expect(planningContent?.type).toBe(EventType.TEXT_MESSAGE_CONTENT);
    expect(planningContent?.delta).toBe(PLANNING_NOTE);

    const toolStart = events.find((e) => e.type === EventType.TOOL_CALL_START);
    const toolArgs = events.find((e) => e.type === EventType.TOOL_CALL_ARGS);
    const toolEnd = events.find((e) => e.type === EventType.TOOL_CALL_END);
    const toolResult = events.find((e) => e.type === EventType.TOOL_CALL_RESULT);
    expect(toolStart?.toolCallName).toBe("call_skill");
    expect(toolStart?.toolCallId).toBe(toolArgs?.toolCallId);
    expect(toolStart?.toolCallId).toBe(toolEnd?.toolCallId);
    expect(toolStart?.toolCallId).toBe(toolResult?.toolCallId);
    expect(toolArgs?.delta).toContain(SKILL);
    expect(toolArgs?.delta).toContain("画一个架构图");
    expect(toolResult?.content).toBe(SKILL_RESULT);
    expect(toolResult?.role).toBe("tool");

    // Final answer is the REAL text the deepagents run's last AI message produced, not the
    // skill's own result text leaking through as the reply.
    // ⚠ 取「最后一条 TEXT_MESSAGE_CONTENT」，不是从队尾数第 N 个。原来写的是
    //   `events[events.length - 3]`，CK-P3（#2054）在 RUN_FINISHED 前多插一个
    //   `CUSTOM chat_message_id` 就把它整个错开了——而这条断言真正要说的是
    //   「最终答案气泡的正文」（本轮有两条 TEXT_MESSAGE_CONTENT：规划气泡与最终答案，
    //   最后一条即最终答案），跟它距离流末尾几格无关。按语义定位不会因为将来又多一个
    //   收尾事件而再红一次。上面那条逐条序列断言已经在钉「事件序列本身」了，
    //   这里不需要第二份对位置的隐式依赖。
    const contents = events.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
    const finalContent = contents[contents.length - 1];
    expect(contents).toHaveLength(2);
    expect(finalContent?.delta).toBe(FINAL_TEXT);

    // 轮询循环真的被走过（不是第一次查询就判定终态）——第一次看到 running，第二次才成功。
    expect(statusCallCount).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
