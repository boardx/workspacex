/**
 * issue #3346 —— 用户在 chat 上传一张图、随消息发出，**那一轮打给内核的请求体里必须真的
 * 有这张图的字节**。
 *
 * ## 为什么断言落在这里，不落在 UI 或上传接口
 *
 * #3346 的实测形态是「系统看起来正常回答了，实际它没看见证据」：附件卡片正常显示、上传
 * 接口 201、`chat_message_attachments.message_id` 也真的挂上了那条消息
 * （`tests/chat/attachment-mount-roundtrip.test.ts` 在真栈上逐条证过），但模型那一轮
 * 收到的只有文字。所以「附件卡片消失了」「上传返回 200」「message_id 非空」这三种断言
 * **在本缺陷下全都是绿的**——它们无法被证伪，钉不住任何东西。
 *
 * 唯一能被证伪的断言只有一条：**打给模型的那次请求的报文里，有没有这张图的字节**。
 * 本文件因此在真实链路的最后一跳取证——真 `executeQueuedRuns`、真
 * `DeepAgentModelProvider`、真 HTTP，替身只复刻内核四个端点的报文形状（同
 * `deep-agent-produces-files.test.ts` 立下的先例），把 `POST /threads/:id/runs` 的
 * 请求体原样录下来断言。
 *
 * ## 根因（本文件锁住的那件事）
 *
 * `DeepAgentModelProvider` 既没有实现 `supportsVision`，也从不读 `ModelCallInput.images`：
 * `execute-run.ts` 的 `gatherVisionImages` 因此 fail-closed 走诚实降级，`createRun` 的
 * 报文里 user 消息永远是一个字符串。P2（#1561）建的那条像素通路只接到了
 * `ConfiguredModelProvider`（直连 DashScope 的 chat）——而 devapp 的 chat 跑在 deep-agent
 * 上。#1558 的结论「上传路径是通的，理解路径是断的」在 deep-agent 这条轨道上原封未动。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type {
  AgentRunStore, AppendedRunStep, ClaimOutcome, ClaimedAgentRun, PinnedSkillContent,
  RunFailureCode, RunLocator, RunOutputFile, RunProjection, ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";
import type { RunImagePort, RunImageRef, RunImageScope } from "../../src/application/agent-run/run-image-input";
import {
  DEEP_AGENT_PROVIDER_NAME, DeepAgentModelProvider,
} from "../../src/infrastructure/agent-run/deep-agent-model-provider";

const ORG = toOrgId("org-3346");
const ATTACHMENT_ID = "att-3346";
const FILENAME = "截屏2026-09-10 20.02.15.png";

/**
 * 一张**真的 PNG**（1×1，含真实 IHDR/IDAT/IEND 分块）。不用随机字节：`isModelCallImageMime`
 * 之外，链路上任何一处按 magic number 判类型的地方都得认它，用随机字节会把"链路通了"和
 * "字节恰好没被拦下"混成一件事。
 */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_BASE64 = PNG_BYTES.toString("base64");

/* ── 内核替身：只复刻四个端点的报文形状，录下每一次 createRun 的请求体 ───────────── */

interface KernelFake {
  readonly port: number;
  readonly createRunBodies: unknown[];
  close(): Promise<void>;
}

async function startKernelFake(finalReply: string): Promise<KernelFake> {
  const createRunBodies: unknown[] = [];
  let polls = 0;
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/threads") return json(200, { thread_id: "thread-1" });
    if (req.method === "POST" && /^\/threads\/[^/]+\/runs$/.test(url)) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        createRunBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        json(200, { run_id: "run-1" });
      });
      return;
    }
    if (req.method === "GET" && /^\/threads\/[^/]+\/runs\/[^/]+\/stream$/.test(url)) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end("event: end\ndata: {}\n\n");
      return;
    }
    if (req.method === "GET" && /^\/threads\/[^/]+\/runs\/[^/]+$/.test(url)) {
      polls += 1;
      return json(200, { status: polls < 2 ? "pending" : "success" });
    }
    if (req.method === "GET" && /^\/threads\/[^/]+\/state$/.test(url)) {
      if (createRunBodies.length === 0) return json(200, { values: { messages: [] } });
      return json(200, { values: { messages: [{ type: "ai", content: finalReply }] } });
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

/* ── 图像取数端口：真字节，范围就是本轮触发消息（同 `PgRunImageInput` 的 scope） ──── */

function fakeRunImages(): RunImagePort & { readonly scopes: RunImageScope[] } {
  const scopes: RunImageScope[] = [];
  return {
    scopes,
    list: async (_orgId, scope): Promise<readonly RunImageRef[]> => {
      scopes.push(scope);
      return [{ attachmentId: ATTACHMENT_ID, filename: FILENAME, mime: "image/png", byteSize: PNG_BYTES.byteLength }];
    },
    read: async (): Promise<Uint8Array> => new Uint8Array(PNG_BYTES),
  };
}

/* ── store 替身（同 `deep-agent-produces-files.test.ts`，只留这条路径用得到的方法） ── */

interface StoredOutput { readonly text: string; readonly finalStepSeq: number; readonly files?: readonly RunOutputFile[] }

function fakeStore(run: ClaimedAgentRun): AgentRunStore & { readonly output: StoredOutput | null; readonly failedWith: RunFailureCode | null } {
  const state = { output: null as StoredOutput | null, failedWith: null as RunFailureCode | null };
  const unused = (name: string) => async (): Promise<never> => { throw new Error(`fakeStore.${name} unexpected`); };
  return {
    get output() { return state.output; },
    get failedWith() { return state.failedWith; },
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => [{ kind: "executable", run }],
    reclaimStaleRunning: unused("reclaimStaleRunning"),
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => [],
    appendStep: async (_orgId: unknown, _step: AppendedRunStep) => {},
    appendModelDelta: unused("appendModelDelta"),
    readModelDeltas: async () => [],
    storeOutputAwaitingWriteback: async (_orgId: unknown, _runId: unknown, output: StoredOutput) => { state.output = output; },
    failRun: async (_orgId: unknown, _runId: unknown, code: RunFailureCode) => { state.failedWith = code; },
    async markAwaitingToolPermission() { throw new Error("unexpected"); },
    async approveAndRequeue() { throw new Error("unexpected"); return false; },
    async denyAndRequeue() { throw new Error("unexpected"); return false; },
    async editAndRequeue() { throw new Error("unexpected"); return false; },
    claimWritebackPending: unused("claimWritebackPending"),
    commitWriteback: unused("commitWriteback"),
    recordWritebackAttempt: unused("recordWritebackAttempt"),
    reopenForWritebackRetry: unused("reopenForWritebackRetry"),
    appendWritebackFailure: unused("appendWritebackFailure"),
    findLocator: async (): Promise<RunLocator | null> => null,
    findAwaitingToolPermissionRunId: async (): Promise<string | null> => null,
    readRun: async (): Promise<Guarded<RunProjection> | null> => null,
    readThreadHistory: async (): Promise<readonly ThreadHistoryMessage[]> => [],
    readThreadContextState: async () => null,
    upsertThreadContextState: async () => true,
    readRunTranscriptSteps: async () => null,
  };
}

function runWithImage(): ClaimedAgentRun {
  return {
    runId: "run-3346", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-3346",
    requesterUserId: "user-1",
    inputText: "你看 title 是空的",
    inputAttachments: [{ filename: FILENAME, mime: "image/png" }],
    agentId: "agent-1", agentVersionId: "agent-version-1", instructions: "你是通用助手",
    skillVersionIds: [],
    modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "deep-agent",
    pendingDecision: null,
  };
}

/** 这一轮真正打给内核的那份报文（`POST /threads/:id/runs` 的 body）序列化后的全文。 */
async function captureKernelRequest(options: { readonly visionModelIds: ReadonlySet<string> }): Promise<{
  readonly wire: string;
  readonly userMessage: unknown;
  readonly failedWith: RunFailureCode | null;
}> {
  const kernel = await startKernelFake("看起来 title 是空的，可能是渲染问题、视觉误判，或复制时丢了。");
  try {
    const run = runWithImage();
    const store = fakeStore(run);
    const model = new DeepAgentModelProvider({
      baseUrl: `http://127.0.0.1:${String(kernel.port)}`,
      pollIntervalMs: 1,
      timeoutMs: 30_000,
      kernelModelId: "qwen-vl-max",
      visionModelIds: options.visionModelIds,
    });
    let clock = 0;
    const deps: ExecuteAgentRunDeps = {
      runs: store,
      model,
      runImages: fakeRunImages(),
      clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${String(clock)}` },
      log: vi.fn(),
    };
    await executeQueuedRuns(deps, { orgId: ORG });
    const body = kernel.createRunBodies[0] as { input?: { messages?: { role: string; content: unknown }[] } };
    const messages = body.input?.messages ?? [];
    return {
      wire: JSON.stringify(kernel.createRunBodies[0]),
      userMessage: messages.find((m) => m.role === "user")?.content,
      failedWith: store.failedWith,
    };
  } finally {
    await kernel.close();
  }
}

describe("#3346 · 随消息发出的图片必须真的进到那一轮的模型输入里", () => {
  it("部署声明内核模型有视觉能力 ⇒ createRun 报文里带着这张图的真实字节", async () => {
    const captured = await captureKernelRequest({ visionModelIds: new Set(["qwen-vl-max"]) });

    expect(captured.failedWith).toBeNull();
    // ① 会红的那一条：图的字节真的在打给模型的报文里。不是"卡片消失了"、不是"上传 200"。
    expect(captured.wire).toContain(PNG_BASE64);
    // ② 而且它挂在**这一轮的 user 消息**上，不是被塞进 config 或别的角落。
    const content = captured.userMessage as { type: string; text?: string; image_url?: { url: string } }[];
    expect(Array.isArray(content)).toBe(true);
    expect(content.some((part) => part.type === "text" && (part.text ?? "").includes("你看 title 是空的"))).toBe(true);
    expect(content.some((part) => part.type === "image_url"
      && (part.image_url?.url ?? "") === `data:image/png;base64,${PNG_BASE64}`)).toBe(true);
  });

  it("部署未声明视觉能力 ⇒ 图不发出，但模型被**明确告知**它这轮看不到图（诚实降级，不是静默丢弃）", async () => {
    const captured = await captureKernelRequest({ visionModelIds: new Set<string>() });

    expect(captured.failedWith).toBeNull();
    expect(captured.wire).not.toContain(PNG_BASE64);
    // 静默丢弃正是 #1558/#3346 的形态：模型必须知道自己没看到图，才答得出真话。
    expect(captured.wire).toContain("不具备视觉输入能力");
  });
});
