/**
 * #1747 —— 走 deep-agent 的 chat 也能**真的产出文件**。
 *
 * ## 这支门控锁的是什么
 *
 * 改动之前的实测形态（devapp 数据库，不是日志）：最近三次挂了 skill 的 deep-agent run
 * `pinned=1` 但 `files=0`，其中一次 `status=succeeded` ⇒ 不是超时，是这条路根本不产文件。
 *
 * 根因有两条，都在这里被锁住：
 *
 * 1. `execute-run.ts` 的 `completeWithProgress` 分支（deep-agent 走的那条）**从来没有传
 *    `skills`**，于是远端 `call_skill` 拿到的 `org_skills` 恒为空——挂了技能等于没挂。
 * 2. deep-agent 的最终 `AIMessage` 是编排模型对工具结果的**转述散文**；子模型写出来的
 *    ```run_script 块留在 `ToolMessage` 里，从来没进过 `maybeRunSkillScript` 检查的那段
 *    文本，于是判据永远不成立，沙箱一次都不被调用。
 *
 * ## 用的是真代码，不是"在断言层面演一遍"
 *
 * | 环节 | 这里用的 |
 * |---|---|
 * | 执行编排 | 真 `executeQueuedRuns`（`execute-run.ts` 本体） |
 * | deep-agent provider | 真 `DeepAgentModelProvider`，走**真 HTTP** |
 * | deep-agent 服务 | 本文件里的确定性替身，四个端点照 provider 自己文档的形状 |
 * | 沙箱 | 真 `HttpSkillSandbox`，走**真 HTTP**，上游是既有的 `loopback-skill-sandbox-behavior` |
 * | 产物合法性 | 真 `inspectPptx`（`@repo/skill-sandbox/ooxml`），解 zip、解 slide XML |
 *
 * 只有 `AgentRunStore` 是内存替身——`storeOutputAwaitingWriteback` 的 `files` 落到
 * `agent_runs.model_output_files` 那一格由 #1624 既有的真栈门控
 * （`tests/chat/chat-skill-mount-produces-pptx-real-stack.test.ts`）锁，本次改动一行没动
 * 那段 SQL，不在这里造第二份。
 *
 * ## 为什么替身服务器写在本文件里，而不是 import `scripts/loopback-deep-agent-provider.ts`
 *
 * 那支是「import 即监听固定端口」的进程入口，且行为写死（固定工具名、固定回复），没有
 * 让工具结果携带任意脚本块的入口。与 `loopback-skill-sandbox-behavior.ts` 头注里那条
 * 一样的处境，只是那边已经抽过一层、这边还没有。这里刻意**只**复刻四个端点的报文形状
 * （唯一事实源是 `deep-agent-model-provider.ts` 自己的文档与读取代码），不复刻任何行为
 * 语义，所以不构成第二份事实源。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inspectPptx } from "@repo/skill-sandbox/ooxml";
import { toOrgId } from "../../src/domain/org-id";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type {
  AgentRunStore, AppendedRunStep, ClaimOutcome, ClaimedAgentRun, PinnedSkillContent,
  RunFailureCode, RunLocator, RunOutputFile, RunProjection, ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";
import type { ObjectStore } from "../../src/application/artifact/ports";
import { buildSystemPrompt } from "../../src/application/agent-run/execute-run";
import { RUN_SCRIPT_PROTOCOL_PROMPT } from "../../src/application/skill/run-script-with-retries";
import { DeepAgentModelProvider, DEEP_AGENT_PROVIDER_NAME } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { HttpSkillSandbox } from "../../src/infrastructure/skill/http-skill-sandbox";
import {
  startLoopbackSkillSandbox,
  type LoopbackSandboxHandle,
} from "../../scripts/loopback-skill-sandbox-behavior";

const ORG = toOrgId("org-i1747");

const PPTX_SKILL: PinnedSkillContent = {
  versionId: "skill-version-pptx",
  content: "# pptx\n用 pptxgenjs 生成演示文稿。",
  stableName: "pptx",
  name: "PPTX 生成",
};

/**
 * 子模型（远端 `call_skill` 里那次独立调用）按协议写出来的脚本块，原样出现在
 * `ToolMessage` 里。⚠ 这段文本**不会**逐字出现在最终回复中——那正是 #1747 的形态。
 */
const TOOL_RESULT_WITH_SCRIPT = [
  "我按 pptx 技能生成了脚本：",
  "",
  "```run_script",
  "const PptxGenJS = require('pptxgenjs');",
  "const pres = new PptxGenJS();",
  "pres.addSlide().addText('季度回顾', { x: 0.5, y: 0.5 });",
  "pres.addSlide().addText('风险', { x: 0.5, y: 0.5 });",
  "pres.writeFile({ fileName: process.env.SKILL_SANDBOX_OUT_DIR + '/quarterly.pptx' });",
  "```",
].join("\n");

/** 编排模型的最终回复：**转述**，一个代码围栏都没有。 */
const FINAL_PROSE_REPLY = "我已经调用 pptx 技能，把季度回顾和风险两页做好了。";

/* ── deep-agent 服务替身（只复刻报文形状，见文件头注） ─────────────────────────────── */

interface DeepAgentFakeOptions {
  /** 工具结果正文。`null` ⇒ 这一轮完全没有工具调用（T2 的普通对话形态）。 */
  readonly toolResult: string | null;
  readonly finalReply: string;
}

interface DeepAgentFakeHandle {
  readonly port: number;
  /** 每次 `POST /threads/:id/runs` 的请求体，供断言 `org_skills` / `script_protocol`。 */
  readonly createRunBodies: unknown[];
  close(): Promise<void>;
}

async function startDeepAgentFake(options: DeepAgentFakeOptions): Promise<DeepAgentFakeHandle> {
  const createRunBodies: unknown[] = [];
  const polls = new Map<string, number>();

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "POST" && url === "/threads") {
      json(200, { thread_id: "thread-1" });
      return;
    }
    if (req.method === "POST" && /^\/threads\/[^/]+\/runs$/.test(url)) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        createRunBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        json(200, { run_id: "run-1" });
      });
      return;
    }
    if (req.method === "GET" && /^\/threads\/[^/]+\/runs\/[^/]+$/.test(url)) {
      // 先 pending 再 success：让真实的轮询循环真的转一圈，而不是首次即终态。
      const seen = (polls.get("run-1") ?? 0) + 1;
      polls.set("run-1", seen);
      json(200, { status: seen < 2 ? "pending" : "success" });
      return;
    }
    if (req.method === "GET" && /^\/threads\/[^/]+\/state$/.test(url)) {
      const messages: Record<string, unknown>[] = [{ type: "human", content: "帮我做一份季度回顾的 deck" }];
      if (options.toolResult !== null) {
        messages.push({
          type: "ai",
          content: "我先把任务交给 pptx 技能。",
          tool_calls: [{ id: "call-1", name: "call_skill", args: { skill_stable_name: "pptx", task: "季度回顾" } }],
        });
        messages.push({ type: "tool", tool_call_id: "call-1", content: options.toolResult });
      }
      messages.push({ type: "ai", content: options.finalReply });
      json(200, { values: { messages } });
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    createRunBodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/* ── 内存替身：只有 store 与对象存储 ─────────────────────────────────────────────── */

interface StoredOutput {
  readonly text: string;
  readonly finalStepSeq: number;
  readonly files?: readonly RunOutputFile[];
}

function fakeStore(
  run: ClaimedAgentRun,
  pinnedSkills: readonly PinnedSkillContent[],
): AgentRunStore & {
  readonly steps: AppendedRunStep[];
  readonly output: StoredOutput | null;
  readonly failedWith: RunFailureCode | null;
} {
  const state = {
    steps: [] as AppendedRunStep[],
    output: null as StoredOutput | null,
    failedWith: null as RunFailureCode | null,
  };
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`fakeStore.${name} not expected to be called by this test`);
  };
  return {
    get steps() { return state.steps; },
    get output() { return state.output; },
    get failedWith() { return state.failedWith; },
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => [{ kind: "executable", run }],
    reclaimStaleRunning: unused("reclaimStaleRunning"),
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => pinnedSkills,
    appendStep: async (_orgId, step: AppendedRunStep) => { state.steps.push(step); },
    appendModelDelta: unused("appendModelDelta"),
    readModelDeltas: async () => [],
    storeOutputAwaitingWriteback: async (_orgId, _runId, output: StoredOutput) => { state.output = output; },
    failRun: async (_orgId, _runId, code: RunFailureCode) => { state.failedWith = code; },
    async markAwaitingApproval() { throw new Error('unexpected markAwaitingApproval in this test'); },
    async approveAndRequeue() { throw new Error('unexpected approveAndRequeue in this test'); return false; },
    async editAndRequeue() { throw new Error('unexpected editAndRequeue in this test'); return false; },
    claimWritebackPending: unused("claimWritebackPending"),
    commitWriteback: unused("commitWriteback"),
    recordWritebackAttempt: unused("recordWritebackAttempt"),
    reopenForWritebackRetry: unused("reopenForWritebackRetry"),
    appendWritebackFailure: unused("appendWritebackFailure"),
    findLocator: async (): Promise<RunLocator | null> => null,
    findAwaitingApprovalRunId: async (): Promise<string | null> => null,
    readRun: async (): Promise<Guarded<RunProjection> | null> => null,
    readThreadHistory: async (): Promise<readonly ThreadHistoryMessage[]> => [],
    readThreadContextState: async () => null,
    upsertThreadContextState: async () => true,
  };
}

function memoryObjectStore(): ObjectStore & { readonly keys: string[] } {
  const bytesByKey = new Map<string, Uint8Array>();
  const keys: string[] = [];
  return {
    keys,
    putOnce: async (key, bytes) => { keys.push(key); bytesByKey.set(key, bytes); },
    get: async (key) => bytesByKey.get(key) ?? null,
    head: async (key) => {
      const bytes = bytesByKey.get(key);
      return bytes === undefined ? null : { sizeBytes: bytes.length, mime: "application/octet-stream" };
    },
  };
}

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1747", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1",
    requesterUserId: "user-1", inputText: "帮我做一份季度回顾的 deck", inputAttachments: [],
    agentId: "agent-1", agentVersionId: "agent-version-1", instructions: "你是通用助手",
    skillVersionIds: [PPTX_SKILL.versionId],
    modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "deep-agent",
    pendingDecision: null,
    ...overrides,
  };
}

/* ── 用例 ───────────────────────────────────────────────────────────────────────── */

let sandbox: LoopbackSandboxHandle;

beforeAll(async () => { sandbox = await startLoopbackSkillSandbox(0); });
afterAll(async () => { await sandbox?.close(); });

interface RunOnceInput {
  readonly deepAgent: DeepAgentFakeHandle;
  readonly pinnedSkills?: readonly PinnedSkillContent[];
  /** 不注入沙箱/对象存储 ⇒ 这条路径整段不存在。 */
  readonly withSandbox?: boolean;
}

async function runOnce(input: RunOnceInput): Promise<{
  readonly store: ReturnType<typeof fakeStore>;
  readonly objects: ReturnType<typeof memoryObjectStore>;
  readonly sandboxRuns: number;
}> {
  const pinnedSkills = input.pinnedSkills ?? [PPTX_SKILL];
  const run = baseRun({ skillVersionIds: pinnedSkills.map((s) => s.versionId) });
  const store = fakeStore(run, pinnedSkills);
  const objects = memoryObjectStore();
  const model = new DeepAgentModelProvider({
    baseUrl: `http://127.0.0.1:${String(input.deepAgent.port)}`,
    pollIntervalMs: 1,
    timeoutMs: 30_000,
  });
  let clock = 0;
  const deps: ExecuteAgentRunDeps = {
    runs: store,
    model,
    clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${String(clock)}` },
    log: vi.fn(),
    ...(input.withSandbox === false ? {} : {
      sandbox: new HttpSkillSandbox({ baseUrl: `http://127.0.0.1:${String(sandbox.port)}` }),
      objects,
    }),
  };

  const before = sandbox.runCount();
  await executeQueuedRuns(deps, { orgId: ORG });
  return { store, objects, sandboxRuns: sandbox.runCount() - before };
}

describe("T1 端到端：deep-agent + 挂 pptx skill ⇒ 真的产出合法 .pptx", () => {
  it("脚本从 call_skill 的工具结果里被抠出来、真的执行、产物字节是合法 OOXML", async () => {
    const deepAgent = await startDeepAgentFake({
      toolResult: TOOL_RESULT_WITH_SCRIPT,
      finalReply: FINAL_PROSE_REPLY,
    });
    try {
      const { store, objects, sandboxRuns } = await runOnce({ deepAgent });

      expect(store.failedWith).toBeNull();
      expect(sandboxRuns).toBe(1);

      // ① `agent_runs.model_output_files` 的那一条（这里是它写进 store 的形态）。
      const files = store.output?.files ?? [];
      expect(files).toHaveLength(1);
      expect(files[0]!.name).toBe("quarterly.pptx");
      expect(files[0]!.mime)
        .toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
      expect(files[0]!.objectKey).toBe("agent-run-outputs/run-1747/quarterly.pptx");

      // ② 字节真的是一个能被解析的 .pptx，不是"回了一个文件"。
      const bytes = await objects.get(files[0]!.objectKey);
      expect(bytes).not.toBeNull();
      const deck = inspectPptx(Buffer.from(bytes!));
      expect(deck.slideCount).toBe(2);

      // ③ 写回给用户的正文是编排模型的原话 + 产物说明，**不是**工具结果正文。
      expect(store.output?.text).toContain(FINAL_PROSE_REPLY);
      expect(store.output?.text).toContain("quarterly.pptx");

      // ④ 两条根因各自被锁：org_skills 真的带上了，script_protocol 真的送过去了。
      const body = deepAgent.createRunBodies[0] as {
        config: { configurable: { org_skills: unknown[]; script_protocol?: string } };
      };
      expect(body.config.configurable.org_skills).toHaveLength(1);
      expect(body.config.configurable.script_protocol).toBe(RUN_SCRIPT_PROTOCOL_PROMPT);
    } finally {
      await deepAgent.close();
    }
  });

  it("T1-CP 反证：沙箱回 0 字节产物 ⇒ OOXML 断言必须红", async () => {
    // 触发标记喂给既有的 loopback 沙箱（`__LOOPBACK_EMPTY_FILE__`），走的是同一条真实链路。
    const deepAgent = await startDeepAgentFake({
      toolResult: [
        "```run_script",
        "// __LOOPBACK_EMPTY_FILE__",
        "require('fs').writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/quarterly.pptx', '');",
        "```",
      ].join("\n"),
      finalReply: FINAL_PROSE_REPLY,
    });
    try {
      const { store, objects } = await runOnce({ deepAgent });
      const files = store.output?.files ?? [];
      expect(files).toHaveLength(1);
      expect(files[0]!.sizeBytes).toBe(0);
      const bytes = await objects.get(files[0]!.objectKey);
      // ⇒ 上面那条用例的 `inspectPptx(...)` 若拿到这样的字节，会抛。
      expect(() => inspectPptx(Buffer.from(bytes!))).toThrow();
    } finally {
      await deepAgent.close();
    }
  });

  it("T1-CP 反证②：脚本只在最终回复里找 ⇒ 一个文件都产不出来（这就是改动前的形态）", async () => {
    // 工具结果不带脚本、最终回复也不带脚本 = 改动前 deep-agent 那条路的真实样子。
    const deepAgent = await startDeepAgentFake({
      toolResult: "我可以帮你把要点整理成演示文稿的大纲，你想讲几页？",
      finalReply: FINAL_PROSE_REPLY,
    });
    try {
      const { store, sandboxRuns } = await runOnce({ deepAgent });
      expect(sandboxRuns).toBe(0);
      expect(store.output?.files ?? []).toHaveLength(0);
      expect(store.output?.text).toBe(FINAL_PROSE_REPLY);
    } finally {
      await deepAgent.close();
    }
  });
});

describe("T2 不回归：没挂 skill 的普通 deep-agent 对话逐字不变", () => {
  it("没挂 skill ⇒ 沙箱一次都不被调用，正文逐字是模型原话，script_protocol 不出现在请求里", async () => {
    const deepAgent = await startDeepAgentFake({ toolResult: null, finalReply: "今天北京多云，22 到 29 度。" });
    try {
      const { store, objects, sandboxRuns } = await runOnce({ deepAgent, pinnedSkills: [] });

      expect(store.failedWith).toBeNull();
      expect(sandboxRuns).toBe(0);
      expect(objects.keys).toEqual([]);
      expect(store.output).toEqual({
        text: "今天北京多云，22 到 29 度。", finalStepSeq: 3, files: [],
      });

      const body = deepAgent.createRunBodies[0] as {
        config: { configurable: Record<string, unknown> };
        input: { messages: { role: string; content: string }[] };
      };
      // 协议这个键**根本不出现**——不是出现一个空串。
      expect(Object.keys(body.config.configurable)).toEqual(["org_skills"]);
      expect(body.config.configurable.org_skills).toEqual([]);
      // system prompt 里也一个字都没多。
      const system = body.input.messages.find((m) => m.role === "system");
      expect(system?.content ?? "").not.toContain("run_script");
    } finally {
      await deepAgent.close();
    }
  });

  it("T2-CP 反证：挂了 skill 的同一条链路上，那两样确实会出现——证明上面的『不出现』不是恒真", async () => {
    const deepAgent = await startDeepAgentFake({ toolResult: null, finalReply: "好的。" });
    try {
      await runOnce({ deepAgent });
      const body = deepAgent.createRunBodies[0] as {
        config: { configurable: Record<string, unknown> };
        input: { messages: { role: string; content: string }[] };
      };
      expect(Object.keys(body.config.configurable).sort()).toEqual(["org_skills", "script_protocol"]);
      expect(body.input.messages.find((m) => m.role === "system")?.content).toContain("run_script");
    } finally {
      await deepAgent.close();
    }
  });

  it("不注入沙箱/对象存储 ⇒ 挂了 skill 也不送协议，行为与接沙箱之前相同", async () => {
    const deepAgent = await startDeepAgentFake({
      toolResult: TOOL_RESULT_WITH_SCRIPT, finalReply: FINAL_PROSE_REPLY,
    });
    try {
      const { store, sandboxRuns } = await runOnce({ deepAgent, withSandbox: false });
      expect(sandboxRuns).toBe(0);
      // #742 Gap 1: finalStepSeq is 5, not 4 -- the one tool call (call-1) now writes TWO
      // ledger rows (an `in_progress` row when announced, a `succeeded` row when answered),
      // sharing `tool_call_id`, not one -- see `AppendedRunStep.toolCallId`'s own doc. The
      // terminal `model_called` step's seq shifts accordingly; this is the correct new
      // count, not a regression.
      expect(store.output).toEqual({ text: FINAL_PROSE_REPLY, finalStepSeq: 5, files: [] });
      const body = deepAgent.createRunBodies[0] as { config: { configurable: Record<string, unknown> } };
      expect(Object.keys(body.config.configurable)).toEqual(["org_skills"]);
    } finally {
      await deepAgent.close();
    }
  });
});

describe("T4（#2534）deep-agent 的 system prompt 只放目录，skill 全文只经 org_skills 到远端", () => {
  /*
   * #2519 之后 run 默认加载组织全部已启用 skill；#2515 曾在执行期再并一份平台 skill
   * 进 `toolSkills`（`readPlatformSkills`），两套叠加。#2534 收敛：哪些 skill 参与这次
   * run **只由快照决定**（`fakeStore` 的 `readPinnedSkills` 就是快照），执行期不再另读
   * 目录；system prompt 对 deep-agent 只放目录（`buildDeepAgentSkillCatalogBlock`），
   * 全文经 `org_skills` 由远端 `call_skill` 按需取。
   */
  it("system 含每个 skill 的目录条目、不含任何一份全文；org_skills 含全部全文；沙箱协议照送", async () => {
    const deepAgent = await startDeepAgentFake({ toolResult: null, finalReply: "好的。" });
    try {
      const pdf: PinnedSkillContent = {
        versionId: "skill-version-pdf", stableName: "pdf-create", name: "PDF 文档生成",
        content: "# pdf-create\n生成 PDF 文档。\n\nPDF_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT",
      };
      const { store } = await runOnce({ deepAgent, pinnedSkills: [PPTX_SKILL, pdf] });
      expect(store.failedWith).toBeNull();
      const body = deepAgent.createRunBodies[0] as {
        input: { messages: { role: string; content: string }[] };
        config: { configurable: { org_skills: { stable_name: string; content: string }[]; script_protocol?: string } };
      };
      const system = body.input.messages.find((m) => m.role === "system")?.content ?? "";
      expect(system).toContain("- pptx:");
      expect(system).toContain("- pdf-create:");
      expect(system).toContain("call_skill");
      // 反证的核心：全文独有句子**不在** system 里（此前 #725 的老办法会把它贴进去）。
      expect(system).not.toContain("PDF_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
      expect(system).not.toContain("read_skill");
      expect(body.config.configurable.org_skills.map((s) => s.stable_name)).toEqual(["pptx", "pdf-create"]);
      expect(body.config.configurable.org_skills[1]!.content).toContain("PDF_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
      expect(body.config.configurable.script_protocol).toBe(RUN_SCRIPT_PROTOCOL_PROMPT);
    } finally {
      await deepAgent.close();
    }
  });

  it("执行期不再另读任何目录：快照里只有 pptx ⇒ org_skills 也只有 pptx（curated 覆盖在 deep-agent 上同样成立）", async () => {
    const deepAgent = await startDeepAgentFake({ toolResult: null, finalReply: "好的。" });
    try {
      await runOnce({ deepAgent, pinnedSkills: [PPTX_SKILL] });
      const body = deepAgent.createRunBodies[0] as {
        config: { configurable: { org_skills: { stable_name: string }[] } };
      };
      expect(body.config.configurable.org_skills.map((s) => s.stable_name)).toEqual(["pptx"]);
    } finally {
      await deepAgent.close();
    }
  });

  it("T4-CP 反证：full 模式会把全文贴进 system——证明上面「不含全文」不是恒真", () => {
    const pdf = { versionId: "v", stableName: "pdf-create", name: "n", content: "# x\n\nPDF_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT" };
    expect(buildSystemPrompt("i", [pdf], null, "full")).toContain("PDF_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
    expect(buildSystemPrompt("i", [pdf], null, "deep-agent-catalog")).not.toContain("PDF_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
  });
});

describe("T3 失败诚实：脚本恒失败 ⇒ 真实 stderr 出现，且不翻译成「请重试」", () => {
  it("三次都失败 ⇒ 消息里带沙箱返回的 stderr 原文", async () => {
    const deepAgent = await startDeepAgentFake({
      toolResult: [
        "```run_script",
        "// __LOOPBACK_ALWAYS_FAIL__",
        "throw new Error('boom');",
        "```",
      ].join("\n"),
      finalReply: FINAL_PROSE_REPLY,
    });
    try {
      const { store } = await runOnce({ deepAgent });
      const text = store.output?.text ?? "";

      // 真实 stderr 原文（`LOOPBACK_REAL_STDERR` 的首行）逐字出现。
      expect(text).toContain("TypeError: pres.ShapeType is not a function");
      expect(text).toContain("SCRIPT_FAILED_AFTER_RETRIES");
      // ⚠ #660 / #1611 栽过两次的那条：不许翻译成安慰话。
      expect(text).not.toMatch(/请重试|please try again/i);
      // 失败不是"这条消息没人答"——run 没有被 fail 掉，用户拿到的是一条带真因的回复。
      expect(store.failedWith).toBeNull();
      expect(store.output?.files ?? []).toHaveLength(0);
    } finally {
      await deepAgent.close();
    }
  });

  it("T3-CP 反证：同一条断言喂给「翻译成请重试」的文案 ⇒ 必红", () => {
    const translated = "生成失败，请重试。";
    expect(translated).toMatch(/请重试|please try again/i);
    expect(translated).not.toContain("TypeError: pres.ShapeType is not a function");
  });
});
