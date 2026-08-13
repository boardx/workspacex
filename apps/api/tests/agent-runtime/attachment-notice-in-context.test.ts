/**
 * V9-b 前置 A（#970）—— 附件**元数据**进 agent 上下文。
 *
 * 反证的是 devapp 实测的那条 bug：用户传了附件、问「附件是什么」，AI 矢口否认有附件——
 * 因为 run 组装历史时只读消息正文，附件表压根没查。这里在应用层用纯内存 fake 验证：
 *   ① `withAttachmentNotice` 纯函数把 filename/mime 渲染成一行诚实提示；
 *   ② `executeQueuedRuns` 把**当前触发消息**（`inputAttachments`）与**历史消息**
 *      （`ThreadHistoryMessage.attachments`）的附件都折进模型真正收到的 `user`/`history`。
 * 附件**内容**不在本件范围（那是 B/F153/anydoc）——这里只证「模型知道有附件」。
 *
 * 用纯内存 fake 而非真实 Postgres 的理由同 execute-run-streaming.test.ts 头注：这里验的是
 * 端口调用的参数（模型收到什么），不是 SQL/RLS；readThreadHistory 的真实 SQL 聚合另有 DB 测。
 */
import { describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import {
  executeQueuedRuns, withAttachmentNotice, type ExecuteAgentRunDeps,
} from "../../src/application/agent-run/execute-run";
import type {
  AgentRunStore, AppendedRunDelta, AppendedRunStep, ClaimOutcome, ClaimedAgentRun, ModelCallInput,
  ModelCallPort, PinnedSkillContent, RunDelta, RunFailureCode, RunLocator, RunProjection,
  ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";

const ORG = toOrgId("org-i970-attach");

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-now", requesterUserId: "user-1",
    inputText: "附件是什么？", inputAttachments: [], agentId: "agent-1",
    agentVersionId: "agent-version-1", instructions: "你是通用助手", skillVersionIds: [],
    modelProvider: "test-provider", modelId: "test-model", ...overrides,
  };
}

function fakeStore(run: ClaimedAgentRun, history: readonly ThreadHistoryMessage[]): AgentRunStore {
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`fakeStore.${name} not expected in this test`);
  };
  return {
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => [{ kind: "executable", run }],
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => [],
    appendStep: async (_o, _s: AppendedRunStep) => {},
    appendModelDelta: async (_o, _d: AppendedRunDelta) => {},
    readModelDeltas: async (): Promise<readonly RunDelta[]> => [],
    storeOutputAwaitingWriteback: async () => {},
    failRun: async (_o, _r, _c: RunFailureCode) => {},
    claimWritebackPending: unused("claimWritebackPending"),
    commitWriteback: unused("commitWriteback"),
    recordWritebackAttempt: unused("recordWritebackAttempt"),
    reopenForWritebackRetry: unused("reopenForWritebackRetry"),
    appendWritebackFailure: unused("appendWritebackFailure"),
    findLocator: async (): Promise<RunLocator | null> => null,
    readRun: async (): Promise<Guarded<RunProjection> | null> => null,
    readThreadHistory: async (): Promise<readonly ThreadHistoryMessage[]> => history,
    readThreadContextState: async () => null,
    upsertThreadContextState: async () => true,
  };
}

function deps(runs: AgentRunStore, model: ModelCallPort): ExecuteAgentRunDeps {
  let clock = 0;
  return {
    runs, model,
    clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: vi.fn(),
  };
}

describe("withAttachmentNotice（纯函数）", () => {
  const png = { filename: "架构图.png", mime: "image/png" };

  it("无附件 → 原样返回，不加任何噪声", () => {
    expect(withAttachmentNotice("你好", [])).toBe("你好");
    expect(withAttachmentNotice("你好", undefined)).toBe("你好");
  });

  it("附件未抽取（pending/缺省）→ 文件名+MIME 出现，且诚实说内容还读不到（不装作能读）", () => {
    const out = withAttachmentNotice("附件是什么？", [png]);
    expect(out).toContain("架构图.png");
    expect(out).toContain("image/png");
    expect(out).toContain("正在提取中"); // 未抽取时的诚实兜底
    expect(out.startsWith("附件是什么？")).toBe(true);
  });

  it("V9-b：extracted → 把抽取内容摘录折进上下文（模型真能读文件了）", () => {
    const out = withAttachmentNotice("总结一下这份文件", [{
      filename: "简历.pdf", mime: "application/pdf",
      extractionStatus: "extracted", extractedExcerpt: "# 张三\n资深后端工程师，8 年经验。",
    }]);
    expect(out).toContain("简历.pdf");
    expect(out).toContain("张三"); // 真内容进了上下文
    expect(out).toContain("资深后端工程师");
  });

  it("V9-b：unsupported（图片）→ 明说抽不出文本；failed → 明说提取失败", () => {
    const img = withAttachmentNotice("", [{ filename: "照片.png", mime: "image/png", extractionStatus: "unsupported" }]);
    expect(img).toContain("无法提取文本内容");
    const failed = withAttachmentNotice("", [{ filename: "坏了.pdf", mime: "application/pdf", extractionStatus: "failed" }]);
    expect(failed).toContain("内容提取失败");
  });

  it("多附件用顿号连接；空正文时只有提示、无前导换行", () => {
    const out = withAttachmentNotice("", [png, { filename: "规模.xlsx", mime: "application/vnd.ms-excel" }]);
    expect(out).toContain("架构图.png（image/png）");
    expect(out).toContain("规模.xlsx");
    expect(out.startsWith("\n")).toBe(false);
    expect(out.startsWith("［附件")).toBe(true);
  });
});

describe("executeQueuedRuns —— 附件元数据折进模型上下文（#970 反证）", () => {
  it("当前触发消息的附件 → 折进模型收到的 user 文本（『刚传完就问』这条路径）", async () => {
    const run = baseRun({ inputAttachments: [{ filename: "简历.pdf", mime: "application/pdf" }] });
    let captured: ModelCallInput | null = null;
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => { captured = input; return { text: "我看到你传了简历.pdf", tokens: 3 }; },
    };

    const n = await executeQueuedRuns(deps(fakeStore(run, []), model), { orgId: ORG });

    expect(n).toBe(1);
    expect(captured).not.toBeNull();
    // 模型真正收到的 user 里带了附件名 + 类型——不再是矢口否认。
    expect(captured!.user).toContain("简历.pdf");
    expect(captured!.user).toContain("application/pdf");
    // 原问题文本仍在。
    expect(captured!.user).toContain("附件是什么？");
  });

  it("历史消息的附件 → 折进对应那轮的 history content（不串到别的轮）", async () => {
    const history: readonly ThreadHistoryMessage[] = [
      { role: "user", content: "看看这个", attachments: [{ filename: "合同.pdf", mime: "application/pdf" }] },
      { role: "assistant", content: "收到" },
    ];
    const run = baseRun();
    let captured: ModelCallInput | null = null;
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => { captured = input; return { text: "ok", tokens: 1 }; },
    };

    const n = await executeQueuedRuns(deps(fakeStore(run, history), model), { orgId: ORG });

    expect(n).toBe(1);
    const turns = captured!.history ?? [];
    expect(turns).toHaveLength(2);
    // 带附件那轮的 content 折进了附件名；不带附件的助手轮保持原样、不被污染。
    expect(turns[0]!.content).toContain("看看这个");
    expect(turns[0]!.content).toContain("合同.pdf");
    expect(turns[1]!.content).toBe("收到");
  });
});
