/**
 * design-delta `skill-lazy-loading` —— `verification.md` V1-V6，各配反证（本仓九次
 * 栽在"全绿但空转"）。V7（真实 devapp 端到端）不是 vitest 断言，见 verification.md。
 *
 * 沿用 `execute-run-streaming.test.ts` 已验证过的纯内存 fake 模式：`execute-run.ts`
 * 是纯函数式应用层代码，唯一外部依赖是 `ExecuteAgentRunDeps` 四个端口，这里要断言的
 * 是"哪一轮的 system 参数里有什么"这类调用时序，不是任何 SQL/RLS 行为，不需要真库。
 */
import { describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { buildSystemPrompt, executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { MAX_READ_SKILL_ROUNDS } from "../../src/application/agent-run/skill-catalog";
import type {
  AgentRunStore, AppendedRunDelta, AppendedRunStep, ClaimOutcome, ClaimedAgentRun, ModelCallInput,
  ModelCallPort, PinnedSkillContent, RunDelta, RunFailureCode, RunLocator, RunProjection,
  ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import { DEEP_AGENT_PROVIDER_NAME } from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";

const ORG = toOrgId("org-skill-lazy-loading");

const DOCX_SKILL: PinnedSkillContent = {
  versionId: "skill-version-docx",
  stableName: "docx-create",
  name: "Word 文档生成",
  content: [
    "# Word 文档生成（docx-create）",
    "",
    "用这个 skill 从零创建一份 Word 文档。",
    "",
    "## 怎么做",
    "",
    "DOCX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT：用 docx 库拼文档结构。",
  ].join("\n"),
};

const XLSX_SKILL: PinnedSkillContent = {
  versionId: "skill-version-xlsx",
  stableName: "xlsx-create",
  name: "Excel 表格生成",
  content: [
    "# Excel 表格生成（xlsx-create）",
    "",
    "用这个 skill 从零创建一份 Excel 工作簿。",
    "",
    "## 怎么做",
    "",
    "XLSX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT：用 exceljs 库建工作簿。",
  ].join("\n"),
};

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1", requesterUserId: "user-1",
    inputText: "hello", inputAttachments: [], agentId: "agent-1", agentVersionId: "agent-version-1",
    instructions: "be helpful", skillVersionIds: [], modelProvider: "test-provider",
    modelId: "test-model", pendingDecision: null,
    ...overrides,
  };
}

/** 同 `execute-run-streaming.test.ts` 的 `fakeStore`，`readPinnedSkills` 可配置返回值。 */
function fakeStore(
  run: ClaimedAgentRun,
  skills: readonly PinnedSkillContent[] = [],
): AgentRunStore & {
  readonly output: { text: string } | null;
  readonly failedWith: RunFailureCode | null;
} {
  const state = {
    output: null as { text: string } | null,
    failedWith: null as RunFailureCode | null,
  };
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`fakeStore.${name} not expected to be called by this test`);
  };
  return {
    get output() { return state.output; },
    get failedWith() { return state.failedWith; },
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => [{ kind: "executable", run }],
    reclaimStaleRunning: unused("reclaimStaleRunning"),
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => skills,
    appendStep: async (_orgId, _step: AppendedRunStep) => {},
    appendModelDelta: async (_orgId, _delta: AppendedRunDelta) => {},
    readModelDeltas: async (): Promise<readonly RunDelta[]> => [],
    storeOutputAwaitingWriteback: async (_orgId, _runId, output: { text: string }) => {
      state.output = { text: output.text };
    },
    failRun: async (_orgId, _runId, code: RunFailureCode) => { state.failedWith = code; },
    async markAwaitingApproval() { throw new Error("unexpected markAwaitingApproval in this test"); },
    async approveAndRequeue() { throw new Error("unexpected approveAndRequeue in this test"); return false; },
    async editAndRequeue() { throw new Error("unexpected editAndRequeue in this test"); return false; },
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

function deps(runs: AgentRunStore, model: ModelCallPort): ExecuteAgentRunDeps {
  let clock = 0;
  return {
    runs, model,
    clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: vi.fn(),
  };
}

describe("V1 — 未挂 skill：system 逐字节不变", () => {
  it("system 参数与 buildSystemPrompt 的 full 模式(0 个 skill)逐字节相同", async () => {
    const run = baseRun({ skillVersionIds: [] });
    const store = fakeStore(run, []);
    const seenSystems: string[] = [];
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => {
        seenSystems.push(input.system);
        return { text: "hi there" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(seenSystems).toHaveLength(1);
    expect(seenSystems[0]).toBe(buildSystemPrompt(run.instructions, [], null));
    expect(seenSystems[0]).not.toContain("read_skill");
  });

  it("V1-CP 反证：把「未挂 skill 不追加协议段」改成恒真会让上面的断言变红——这里直接证明 catalog 模式对 0 个 skill 的输出与 full 模式相同（本身就是防御性反证，不依赖改代码）", () => {
    expect(buildSystemPrompt("INSTR", [], null, "catalog")).toBe(buildSystemPrompt("INSTR", [], null, "full"));
  });
});

describe("V2 — 挂载 skill 但本轮用不上：system 只含目录，不含全文", () => {
  it("两个 skill 的 stable_name 都在目录里，正文独有句子都不在", async () => {
    const run = baseRun({ skillVersionIds: [DOCX_SKILL.versionId, XLSX_SKILL.versionId] });
    const store = fakeStore(run, [DOCX_SKILL, XLSX_SKILL]);
    const seenSystems: string[] = [];
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => {
        seenSystems.push(input.system);
        return { text: "不需要用任何 skill，直接回答" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(seenSystems).toHaveLength(1);
    const system = seenSystems[0]!;
    expect(system).toContain("docx-create");
    expect(system).toContain("xlsx-create");
    expect(system).not.toContain("DOCX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
    expect(system).not.toContain("XLSX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
  });

  it("V2-CP 反证：目录直接塞全文时，正文独有句子会出现——这里用 full 模式反证目录/全文两种输出真的不同", () => {
    const catalog = buildSystemPrompt("INSTR", [DOCX_SKILL, XLSX_SKILL], null, "catalog");
    const full = buildSystemPrompt("INSTR", [DOCX_SKILL, XLSX_SKILL], null, "full");
    expect(catalog).not.toContain("DOCX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
    expect(full).toContain("DOCX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
  });
});

describe("V3 — 请求 read_skill 后，下一轮 system 真的含全文，且目录条目仍保留", () => {
  it("第一轮请求 docx-create，第二轮 system 含 docx 全文 + xlsx 仍只在目录里", async () => {
    const run = baseRun({ skillVersionIds: [DOCX_SKILL.versionId, XLSX_SKILL.versionId] });
    const store = fakeStore(run, [DOCX_SKILL, XLSX_SKILL]);
    const seenSystems: string[] = [];
    let call = 0;
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => {
        seenSystems.push(input.system);
        call += 1;
        if (call === 1) return { text: "```read_skill\ndocx-create\n```" };
        return { text: "好的，已读到 docx-create 全文，帮你生成周报。" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(seenSystems).toHaveLength(2);
    expect(seenSystems[0]).not.toContain("DOCX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
    expect(seenSystems[1]).toContain("DOCX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
    // xlsx 仍然只在目录里——没有被顺带展开。
    expect(seenSystems[1]).toContain("xlsx-create");
    expect(seenSystems[1]).not.toContain("XLSX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
    expect(store.output?.text).toBe("好的，已读到 docx-create 全文，帮你生成周报。");
    expect(store.failedWith).toBeNull();
  });

  it("V3-CP 反证：把「追加全文」改成「什么都不追加」，appendSkillFullContent 的输出必须真的比输入长且含全文——用真实函数调用反证，不是重放判据", async () => {
    const { appendSkillFullContent } = await import("../../src/application/agent-run/skill-catalog");
    const before = "CATALOG-ONLY";
    const after = appendSkillFullContent(before, DOCX_SKILL);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain("DOCX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
  });
});

describe("V4 — 轮数上限：超过后降级返回，不报错、不死循环", () => {
  it(`模型每一轮都请求 read_skill：complete() 恰好被调用 MAX_READ_SKILL_ROUNDS+1=${MAX_READ_SKILL_ROUNDS + 1} 次，run 成功`, async () => {
    const run = baseRun({ skillVersionIds: [DOCX_SKILL.versionId] });
    const store = fakeStore(run, [DOCX_SKILL]);
    let calls = 0;
    const model: ModelCallPort = {
      complete: async () => {
        calls += 1;
        // 模拟"模型不断请求，从不给出最终答案"的最坏情况。
        return { text: "```read_skill\ndocx-create\n```" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(calls).toBe(MAX_READ_SKILL_ROUNDS + 1);
    expect(store.failedWith).toBeNull();
    // 最后一轮的回复本身（依然是一个 read_skill 请求文本）被当作最终答案写回——
    // 降级行为，不是空白/报错。
    expect(store.output?.text).toBe("```read_skill\ndocx-create\n```");
  });

  it("V4-CP 反证：轮数上限判据若不生效（恒可继续展开），上面这条会因为调用次数不等于上限+1 而红——这里直接证明 MAX_READ_SKILL_ROUNDS 是个正有限数，不是 Infinity", () => {
    expect(MAX_READ_SKILL_ROUNDS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_READ_SKILL_ROUNDS)).toBe(true);
  });
});

describe("V5 — deep-agent provider 路径逐字节不受影响", () => {
  it("modelProvider === DEEP_AGENT_PROVIDER_NAME 时，即使没有 completeWithProgress，system 仍是 full 模式（不受本 delta 影响）", async () => {
    const run = baseRun({
      modelProvider: DEEP_AGENT_PROVIDER_NAME,
      skillVersionIds: [DOCX_SKILL.versionId],
    });
    const store = fakeStore(run, [DOCX_SKILL]);
    const seenSystems: string[] = [];
    const model: ModelCallPort = {
      // 故意不提供 completeWithProgress —— 断言的是 isDeepAgentRun 这一道门本身
      // （不是 wantsProgress 那道门），deep-agent 即使退回 complete() 也不该被
      // 本 delta 的目录模式影响。
      complete: async (input: ModelCallInput) => {
        seenSystems.push(input.system);
        return { text: "ok" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(seenSystems).toHaveLength(1);
    expect(seenSystems[0]).toBe(buildSystemPrompt(run.instructions, [DOCX_SKILL], null, "full"));
    expect(seenSystems[0]).toContain("DOCX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
    expect(seenSystems[0]).not.toContain("read_skill");
  });
});

describe("V6 — read_skill 请求一个未挂载的 skill：诚实拒绝，不静默忽略、不报错中断 run", () => {
  it("请求未挂载的 pdf-create：下一轮 system 含未挂载提示，不含任何 skill 全文；run 正常继续", async () => {
    const run = baseRun({ skillVersionIds: [DOCX_SKILL.versionId] }); // 只挂了 docx
    const store = fakeStore(run, [DOCX_SKILL]);
    const seenSystems: string[] = [];
    let call = 0;
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => {
        seenSystems.push(input.system);
        call += 1;
        if (call === 1) return { text: "```read_skill\npdf-create\n```" }; // 没挂
        return { text: "好的，那我只用 docx-create 帮你。" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(seenSystems).toHaveLength(2);
    expect(seenSystems[1]).toContain("pdf-create");
    expect(seenSystems[1]).toContain("not mounted");
    expect(seenSystems[1]).not.toContain("DOCX_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT");
    expect(store.output?.text).toBe("好的，那我只用 docx-create 帮你。");
    expect(store.failedWith).toBeNull();
  });

  it("V6-CP 反证：appendSkillNotMountedNotice 的输出必须真的提到被拒绝的名字——用真实函数调用反证，不是重放判据", async () => {
    const { appendSkillNotMountedNotice } = await import("../../src/application/agent-run/skill-catalog");
    const notice = appendSkillNotMountedNotice("BASE", "pdf-create");
    expect(notice).toContain("pdf-create");
    expect(notice).toContain("not mounted");
  });
});
