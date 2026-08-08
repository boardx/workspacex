/**
 * #725 -- the tool-calling loop in `execute-run.ts`'s `executeClaimed`.
 *
 * Same philosophy as `execute-run-streaming.test.ts`'s own header: `execute-run.ts` is pure
 * application code over `ExecuteAgentRunDeps`'s four ports, so a fully in-memory fake
 * `AgentRunStore`/`ModelCallPort` is the right level to prove "the loop calls the tool it
 * said it would, records a real step for it, feeds the real result back, and stops if the
 * model never gives a final answer" -- none of which is a SQL/RLS behaviour.
 */
import { describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import {
  buildOrchestratorSystemPrompt, executeQueuedRuns, MAX_TOOL_LOOP_ROUNDS,
  type ExecuteAgentRunDeps,
} from "../../src/application/agent-run/execute-run";
import type {
  AgentRunStore, AppendedRunDelta, AppendedRunStep, ClaimOutcome, ClaimedAgentRun,
  ModelCallInput, ModelCallPort, PinnedSkillContent, RunDelta, RunFailureCode, RunLocator,
  RunProjection, ThreadHistoryMessage, ToolCallRequest,
} from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";

const ORG = toOrgId("org-i725-tool-loop");

const SKILL: PinnedSkillContent & { stableName: string; name: string } = {
  versionId: "skill-version-1",
  content: "# 帮我写一段介绍",
  stableName: "beautiful-article",
  name: "Beautiful Article",
};

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1",
    inputText: "帮我写一篇文章", agentId: "agent-1", agentVersionId: "agent-version-1",
    instructions: "be helpful", skillVersionIds: [SKILL.versionId],
    modelProvider: "test-provider", modelId: "test-model", ...overrides,
  };
}

function fakeStore(
  run: ClaimedAgentRun,
  pinnedSkills: readonly PinnedSkillContent[] = [SKILL],
): AgentRunStore & {
  readonly steps: AppendedRunStep[];
  readonly output: { text: string; finalStepSeq: number } | null;
  readonly failedWith: RunFailureCode | null;
} {
  const state = {
    steps: [] as AppendedRunStep[],
    output: null as { text: string; finalStepSeq: number } | null,
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
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => pinnedSkills,
    appendStep: async (_orgId, step: AppendedRunStep) => { state.steps.push(step); },
    appendModelDelta: async (_orgId, _delta: AppendedRunDelta) => {
      throw new Error("no delta append expected on the tool-loop path");
    },
    readModelDeltas: async (): Promise<readonly RunDelta[]> => [],
    storeOutputAwaitingWriteback: async (
      _orgId, _runId, output: { text: string; finalStepSeq: number },
    ) => { state.output = output; },
    failRun: async (_orgId, _runId, code: RunFailureCode) => { state.failedWith = code; },
    claimWritebackPending: unused("claimWritebackPending"),
    commitWriteback: unused("commitWriteback"),
    recordWritebackAttempt: unused("recordWritebackAttempt"),
    reopenForWritebackRetry: unused("reopenForWritebackRetry"),
    appendWritebackFailure: unused("appendWritebackFailure"),
    findLocator: async (): Promise<RunLocator | null> => null,
    readRun: async (): Promise<Guarded<RunProjection> | null> => null,
    readThreadHistory: async (): Promise<readonly ThreadHistoryMessage[]> => [],
  };
}

function deps(runs: AgentRunStore, model: ModelCallPort): ExecuteAgentRunDeps {
  let clock = 0;
  return {
    runs, model,
    clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: vi.fn(),
    // #725 is gated (`KERNEL_TOOL_CALLING_ENABLED`) so pre-#725 deployments/tests keep the
    // exact old behaviour by default -- this file's whole point is proving the GATED-ON
    // behaviour, so it opts in explicitly rather than relying on a default.
    toolCallingEnabled: true,
  };
}

describe("buildOrchestratorSystemPrompt", () => {
  it("在原有 buildSystemPrompt 输出（含技能全文，保持既有契约不变）之上追加工具清单", () => {
    const prompt = buildOrchestratorSystemPrompt(
      "be helpful",
      [{ versionId: SKILL.versionId, content: SKILL.content }],
      [{ name: "beautiful-article", description: "调用「Beautiful Article」…", parametersSchema: {} }],
    );
    expect(prompt).toContain("be helpful");
    expect(prompt).toContain(SKILL.content); // pre-#725 contract: full Skill body still present
    expect(prompt).toContain("beautiful-article"); // #725 addition: the tool it can also invoke
  });
});

describe("executeQueuedRuns — tool-calling loop (#725)", () => {
  it("模型直接给最终答案、不调用任何工具：行为与零工具时完全一致", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => {
        expect(input.tools).toHaveLength(1);
        expect(input.toolExchange ?? []).toEqual([]);
        return { text: "这是最终答案" };
      },
    };

    const n = await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(n).toBe(1);
    expect(store.output).toEqual({ text: "这是最终答案", finalStepSeq: 3 });
    expect(store.failedWith).toBeNull();
    expect(store.steps.map((s) => s.kind)).toEqual(["context_built", "model_called"]);
  });

  it("调用一次工具后给出最终答案：真的执行了一次嵌套 complete()，记录了 tool_call 步骤，结果喂回模型", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    let round = 0;
    const seenSkillCalls: ModelCallInput[] = [];
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => {
        round += 1;
        if (round === 1) {
          expect(input.toolExchange ?? []).toEqual([]);
          const toolCalls: ToolCallRequest[] = [
            { id: "call-1", name: "beautiful-article", argumentsJson: '{"task":"写一段介绍"}' },
          ];
          // A provider MAY return plain-language content alongside `tool_calls` on the
          // same message (chat-ux-acceptance-criteria.md item 2 -- "可见的规划步骤").
          return { text: "我需要一段介绍文字，调用 beautiful-article 来生成它。", toolCalls };
        }
        if (input.system === SKILL.content) {
          // The NESTED skill-execution call: system is ONLY the skill body, never mixed
          // with the orchestrator's own instructions or other skills.
          seenSkillCalls.push(input);
          return { text: "技能真实产出的文章内容" };
        }
        // Round 2, orchestrator sees the real tool result fed back.
        expect(input.toolExchange).toEqual([
          {
            kind: "assistant_tool_calls",
            toolCalls: [
              { id: "call-1", name: "beautiful-article", argumentsJson: '{"task":"写一段介绍"}' },
            ],
          },
          { kind: "tool_result", toolCallId: "call-1", name: "beautiful-article", content: "技能真实产出的文章内容" },
        ]);
        return { text: "基于工具结果的最终回答" };
      },
    };

    const n = await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(n).toBe(1);
    expect(seenSkillCalls).toHaveLength(1);
    expect(seenSkillCalls[0]!.user).toBe("写一段介绍");
    expect(store.output).toEqual({ text: "基于工具结果的最终回答", finalStepSeq: 4 });
    expect(store.failedWith).toBeNull();

    const toolStep = store.steps.find((s) => s.kind === "tool_call")!;
    expect(toolStep).toBeDefined();
    expect(toolStep.status).toBe("succeeded");
    expect(toolStep.toolName).toBe("beautiful-article");
    expect(toolStep.toolArgsSummary).toContain("写一段介绍");
    expect(toolStep.toolResultSummary).toContain("技能真实产出的文章内容");
    expect(toolStep.planningNote).toBe("我需要一段介绍文字，调用 beautiful-article 来生成它。");
    expect(toolStep.seq).toBe(3);

    const finalStep = store.steps.find((s) => s.kind === "model_called")!;
    expect(finalStep.seq).toBe(4);
  });

  it("模型请求了一个未挂载的工具：不崩溃，记为失败的 tool_call 步骤，把'未知工具'如实喂回模型", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    let round = 0;
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => {
        round += 1;
        if (round === 1) {
          return {
            text: "",
            toolCalls: [{ id: "call-1", name: "not-a-real-tool", argumentsJson: "{}" }],
          };
        }
        const toolResult = input.toolExchange?.find((t) => t.kind === "tool_result");
        expect(toolResult && "content" in toolResult ? toolResult.content : "")
          .toContain("未知工具");
        return { text: "已根据现有信息回答" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    const toolStep = store.steps.find((s) => s.kind === "tool_call")!;
    expect(toolStep.status).toBe("failed");
    expect(toolStep.failureCode).toBe("MODEL_CALL_FAILED");
    // The model called the tool with no accompanying plain-language text this round --
    // `planningNote` stays null rather than being synthesized.
    expect(toolStep.planningNote).toBeNull();
    expect(store.output).toEqual({ text: "已根据现有信息回答", finalStepSeq: 4 });
  });

  it("循环超过上限仍未给出最终答案：优雅失败为 TOOL_LOOP_LIMIT_EXCEEDED，不是挂死也不是编造回复", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    let round = 0;
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => {
        // Only the ORCHESTRATOR round (the call carrying `tools`) keeps asking for another
        // tool -- the NESTED per-tool-call execution (`system === skill body`, no `tools`)
        // answers normally, so this fixture isolates "the loop itself never terminates"
        // from "one skill call happened to fail", which is a different, already-covered
        // scenario.
        if (input.tools === undefined) return { text: "技能真实执行的结果" };
        round += 1;
        return {
          text: "",
          toolCalls: [{ id: `call-${round}`, name: "beautiful-article", argumentsJson: "{}" }],
        };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(round).toBe(MAX_TOOL_LOOP_ROUNDS);
    expect(store.output).toBeNull();
    expect(store.failedWith).toBe("TOOL_LOOP_LIMIT_EXCEEDED");
    // One tool_call step per round, THEN the terminal (failed) model_called step, and no
    // step lands on a `seq` a tool_call step already used.
    const seqs = store.steps.map((s) => s.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(store.steps.at(-1)!.kind).toBe("model_called");
    expect(store.steps.at(-1)!.status).toBe("failed");
  });

  it("零个挂载技能：走原有单次调用路径，不构建任何工具、不传 toolExchange", async () => {
    const run = baseRun({ skillVersionIds: [] });
    const store = fakeStore(run, []);
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => {
        expect(input.tools).toBeUndefined();
        expect(input.toolExchange).toBeUndefined();
        return { text: "老路径的回答" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(store.output).toEqual({ text: "老路径的回答", finalStepSeq: 3 });
  });

  it("KERNEL_TOOL_CALLING_ENABLED 关闭（默认）：即使挂载了技能也走老路径，不构建工具" +
    "——保护 #654 阶段2a 的流式行为和既有 mega-prompt 契约不被静默改变", async () => {
    const run = baseRun(); // pins SKILL, same as the "on" tests above
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async (input: ModelCallInput) => {
        expect(input.tools).toBeUndefined();
        expect(input.toolExchange).toBeUndefined();
        // The pre-#725 contract: the Skill's own content is still in the system prompt.
        expect(input.system).toContain(SKILL.content);
        return { text: "未开关时的老路径回答" };
      },
    };

    const runDeps = deps(store, model);
    await executeQueuedRuns({ ...runDeps, toolCallingEnabled: false }, { orgId: ORG });

    expect(store.output).toEqual({ text: "未开关时的老路径回答", finalStepSeq: 3 });
    expect(store.steps.map((s) => s.kind)).toEqual(["context_built", "model_called"]);
  });
});
