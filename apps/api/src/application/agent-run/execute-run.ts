/**
 * `executeAgentRun` -- the Wave 2 §5 slice, and nothing else.
 *
 * ## What this function is allowed to decide
 *
 * Almost nothing. The Agent version, the ordered Skill versions, the provider and the
 * model were all decided at acceptance and are read off the claimed run. This code picks
 * no model, resolves no head, retries no provider, and invents no reply. It builds one
 * prompt out of already-pinned inputs, makes one call, and records what happened.
 *
 * ## Failure is a recorded transition, never a thrown surprise
 *
 * Every failure path lands on `failRun` with an enumerated code AND appends the failed
 * step. A run that dies without either is indistinguishable from one nobody started, and
 * "the message just never got answered" is the single hardest report to act on.
 *
 * ## Empty content is a failure, not an empty reply
 *
 * If the provider returns no usable text, the run fails. Storing `""` and letting #413
 * write it back would put a blank assistant message in a human's thread and mark the run
 * succeeded -- a fabricated reply with extra steps.
 *
 * ## #725 -- the tool-calling loop, and how it stays "almost nothing" too
 *
 * A run whose pinned Skills produce at least one tool definition (`buildToolDefinitions`,
 * non-empty exactly when `skillVersionIds` is non-empty) goes through `executeToolLoop`
 * instead of the single call below. It still decides no model, resolves no head and
 * invents no reply -- it is bounded (`MAX_TOOL_LOOP_ROUNDS`), every round it fails closed
 * on the SAME `ModelCallError` discipline, and a round that calls a tool records a REAL
 * `tool_call` step for that REAL nested `complete()` call before continuing, never a
 * fabricated "step" describing something that did not happen. A run with zero pinned
 * Skills takes the exact pre-#725 code path, unchanged.
 */
import { createHash } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import { buildToolDefinitions, indexSkillsByToolName, type SkillForTool } from "./tool-definitions";
import type {
  AgentRunClock, AgentRunStore, ClaimedAgentRun, ModelCallPort,
  RunFailureCode, RunStepKind, ThreadHistoryMessage, ToolDefinition, ToolExchangeTurn,
} from "./ports";
import { ModelCallError } from "./ports";

/**
 * #709 -- token-budget-aware multi-turn context.
 *
 * `HISTORY_MAX_MESSAGES` bounds what `AgentRunStore.readThreadHistory` is even ASKED for
 * (a row cap enforced in SQL, see that method's own comment). `HISTORY_MAX_CHARS` is the
 * second, tighter bound applied here in application code: a deployment has no tokenizer
 * (the `tokens` field on `ModelCallPort`'s return type says so explicitly), so this project
 * has no honest way to count tokens -- inventing one would be exactly the "heuristic
 * presented as a real measurement" `ModelCallPort.complete`'s own doc comment already
 * rules out for usage reporting. A character budget is not "tokens" and is not labelled as
 * one; it is a simple, conservative proxy good enough for the one thing this MVP needs:
 * never let history grow without bound. ~4 chars/token is a common rough ratio for English
 * and CJK-mixed text (CJK runs lower, closer to ~1.5-2 chars/token, which makes this budget
 * MORE conservative for the CJK content that dominates this codebase's fixtures, not less)
 * -- `HISTORY_MAX_CHARS` at 12,000 stays comfortably under the smallest realistic context
 * window even under that denser encoding, while `HISTORY_MAX_MESSAGES` keeps a very long,
 * short-message thread (e.g. quick back-and-forth) from turning into thousands of tiny
 * history entries before the char budget even gets a chance to trim it.
 */
export const HISTORY_MAX_MESSAGES = 20;
export const HISTORY_MAX_CHARS = 12_000;

/**
 * Drop the OLDEST messages first until the remaining, still-chronologically-ordered suffix
 * fits `maxChars` of combined `content` length. `messages` is already oldest-first (what
 * `readThreadHistory` returns); the result stays oldest-first so callers never have to
 * re-sort before splicing it into a `role`-ordered messages array.
 *
 * A single message longer than `maxChars` on its own is kept whole rather than truncated
 * mid-sentence -- cutting a stored message's text would make the model see words that were
 * never actually said in that message, which is a subtly different failure from "this turn
 * wasn't included at all". The budget is enforced by DROPPING turns, never by editing one.
 */
export function trimHistoryToBudget(
  messages: readonly ThreadHistoryMessage[],
  maxChars: number,
): readonly ThreadHistoryMessage[] {
  if (maxChars <= 0) return [];
  let total = 0;
  let firstKeptIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const next = total + messages[i]!.content.length;
    // The oldest kept message is allowed to push the running total over budget by itself
    // (see the doc comment: a single long message is kept whole, not truncated) -- but a
    // SECOND message would not be added once the budget is already spent.
    if (next > maxChars && total > 0) break;
    total = next;
    firstKeptIndex = i;
  }
  return messages.slice(firstKeptIndex);
}

export interface ExecuteAgentRunDeps {
  readonly runs: AgentRunStore;
  readonly model: ModelCallPort;
  readonly clock: AgentRunClock;
  /** Server-side only. Provider detail goes here and nowhere near a response. */
  readonly log: (message: string, detail: Record<string, unknown>) => void;
  /**
   * #725, read once at composition time (`KERNEL_TOOL_CALLING_ENABLED`) -- same rollout
   * discipline `ConfiguredModelProvider`'s own `streamEnabled` already established for
   * #654 阶段2a, and for the identical reason: measured, not assumed. The tool loop always
   * calls `complete()`, never `completeStream()` (see that method's own doc comment), so
   * turning it on UNCONDITIONALLY the moment any Skill is pinned would silently take
   * streaming away from every run that happens to have Skills pinned, whether or not this
   * deployment has verified the new request/response shape end-to-end yet. Default
   * `false`/absent reproduces every byte of pre-#725 behaviour: `tools` stays empty and
   * every run takes the exact old code path regardless of what is pinned.
   */
  readonly toolCallingEnabled?: boolean;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * The prompt.
 *
 * The Skill bodies are joined in the SNAPSHOT'S order. Sorting them, deduplicating them or
 * reading them back in database order would each silently discard part of what was pinned
 * -- ordering is a property of `skillVersionIds`, which is why it is an array in both the
 * `agent_versions` column and the run row.
 *
 * Exported so `trial-run-agent.ts` (#595 Line A) builds the identical prompt shape for a
 * trial run instead of re-deriving "instructions then skills, joined by blank lines" a
 * second time -- that phrase is the one place this project's answer to "what does an Agent
 * actually see" lives, and a second copy is exactly the drift AGENTS.md calls out by name.
 */
export function buildSystemPrompt(
  instructions: string,
  skills: readonly { readonly versionId: string; readonly content: string }[],
): string {
  return [instructions, ...skills.map((s) => s.content)].join("\n\n");
}

/**
 * #725 -- `buildSystemPrompt`'s output PLUS an explicit tool-usage preamble, for a run
 * whose Skills became tools.
 *
 * Deliberately built ON TOP of `buildSystemPrompt`, never replacing it: the pinned Skills'
 * full content stays in the orchestrator's own prompt exactly as it did before #725 (the
 * pre-existing behavioural contract this project already signed off on --
 * `no-tool-run-writeback.test.ts`'s "sends the pinned model, the credential, and the
 * ordered Skill content" asserts the system prompt literally CONTAINS each Skill's body,
 * in pinned order, and #725 does not get to unilaterally amend that). What #725 ADDS is
 * the tool list and the instruction to actually invoke a tool rather than only reason from
 * memorized Skill text -- the orchestrator now has BOTH the content AND a way to trigger a
 * real, separate, focused execution of it and see the real result, which is the gap
 * chat-ux-acceptance-criteria.md items 2-4 describe.
 */
export function buildOrchestratorSystemPrompt(
  instructions: string,
  skills: readonly { readonly versionId: string; readonly content: string }[],
  tools: readonly ToolDefinition[],
): string {
  const toolList = tools.map((t) => `- ${t.name}：${t.description}`).join("\n");
  return [
    buildSystemPrompt(instructions, skills),
    "以上内容里，每一份技能同时也是你可以调用的工具，工具名与它对应关系如下——调用" +
      "工具会让这份技能针对具体任务真正执行一次并返回结果，而不是让你凭已经看到的" +
      "技能说明直接编答案。收到任务后先想清楚要不要调用、调用哪一个，再决定直接回答" +
      "还是调用工具；调用后请根据工具返回的真实结果继续，不要忽略它自说自话。可用" +
      "工具：\n" + toolList,
  ].join("\n\n");
}

/** The one place a step becomes durable, so no path can record half of one. */
async function record(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  input: {
    runId: string; seq: number; kind: RunStepKind; startedAt: string;
    inputDigest: string | null; outputDigest: string | null; failureCode: RunFailureCode | null;
    toolName?: string | null; toolArgsSummary?: string | null; toolResultSummary?: string | null;
  },
): Promise<void> {
  await deps.runs.appendStep(orgId, {
    runId: input.runId,
    seq: input.seq,
    kind: input.kind,
    status: input.failureCode === null ? "succeeded" : "failed",
    startedAt: input.startedAt,
    endedAt: deps.clock.now(),
    inputDigest: input.inputDigest,
    outputDigest: input.outputDigest,
    failureCode: input.failureCode,
    toolName: input.toolName ?? null,
    toolArgsSummary: input.toolArgsSummary ?? null,
    toolResultSummary: input.toolResultSummary ?? null,
  });
}

/**
 * Bounded per §"循环要有上限" -- 6 rounds of "model asks for tools → tools run → results fed
 * back" before the loop gives up rather than running forever. Each round is one
 * `complete()` call that may request zero, one or several tool calls; zero means the model
 * gave its final answer and the loop returns immediately, so a plain "answer without any
 * tool" run still costs exactly one round, same as before #725.
 */
export const MAX_TOOL_LOOP_ROUNDS = 6;

const SUMMARY_MAX_CHARS = 500;

/** Truncated for on-run visibility (chat-ux-acceptance-criteria.md item 3), never the full
 * argument/result text -- see `AgentRunStep.toolArgsSummary`'s own doc comment for why this
 * is intentionally NOT a digest. */
function summarize(text: string, maxChars = SUMMARY_MAX_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

/**
 * Run one pinned Skill AS a tool (#725) -- a SEPARATE, focused `complete()` call whose
 * system prompt is only that Skill's content, never mixed with the orchestrator's other
 * pinned Skills or its own instructions. This is the "real execution" #725 exists to add:
 * before this, invoking a Skill was never anything more than the orchestrator reasoning
 * from its content already sitting in one shared mega-prompt -- no separate call, no
 * separate result, nothing an executor could point at as "this actually ran". `tool_call`
 * steps below are that missing, verifiable, separate execution.
 *
 * Never throws: a failure here becomes a result the ORCHESTRATOR model gets to see and
 * react to (retry differently, try another tool, apologize), the same way a human handing
 * off a subtask learns "that failed" instead of the whole effort silently vanishing.
 */
async function executeSkillTool(
  deps: ExecuteAgentRunDeps,
  run: ClaimedAgentRun,
  skill: SkillForTool,
  task: string,
): Promise<{ readonly resultText: string; readonly failureCode: RunFailureCode | null }> {
  try {
    const completion = await deps.model.complete({
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      system: skill.content,
      user: task,
    });
    if (completion.text.trim() === "") {
      throw new ModelCallError("MODEL_CALL_FAILED", "skill tool call returned empty content");
    }
    return { resultText: completion.text, failureCode: null };
  } catch (e) {
    const code: RunFailureCode = e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED";
    deps.log("agent run tool call failed", {
      runId: run.runId,
      tool: skill.stableName,
      code,
      detail: e instanceof ModelCallError ? e.detail : "unexpected skill tool call failure",
    });
    return { resultText: `技能「${skill.name}」执行失败（${code}）。`, failureCode: code };
  }
}

/** The `task` argument out of a tool call's raw JSON, tolerantly: a model that returns
 * malformed JSON or omits `task` still gets SOME text handed to the Skill (the raw
 * argument string) rather than the whole round failing outright -- the Skill call may
 * still fail on its own merits, but not because this layer refused to try. */
function extractTaskArgument(argumentsJson: string): string {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    if (parsed !== null && typeof parsed === "object" && "task" in parsed) {
      const task = (parsed as Record<string, unknown>).task;
      if (typeof task === "string" && task.trim() !== "") return task;
    }
  } catch {
    // Falls through to the raw text below -- see this function's own doc comment.
  }
  return argumentsJson;
}

/**
 * The bounded tool-calling loop (#725). Returns the final answer text.
 *
 * `seqCursor` is a MUTABLE holder, not a return value, precisely so the caller can still
 * read "how many steps did this loop actually record" after a THROW, not only on success --
 * see `AgentRunStore.storeOutputAwaitingWriteback`'s own doc comment for why the terminal
 * `model_called` step (recorded by the caller, success OR failure) must never land on a
 * `seq` a `tool_call` step already used. It starts at `seqCursor.value` and is advanced by
 * exactly one per recorded `tool_call` step, so whatever it holds when this function
 * returns OR throws is always the next unused `seq`.
 *
 * Throws `ModelCallError("TOOL_LOOP_LIMIT_EXCEEDED", …)` when `MAX_TOOL_LOOP_ROUNDS` rounds
 * pass without a final answer -- the caller fails the run exactly like any other
 * `ModelCallError`, never fabricating a "looks like a plan" reply instead.
 */
async function executeToolLoop(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  run: ClaimedAgentRun,
  input: {
    readonly system: string;
    readonly history: readonly ThreadHistoryMessage[];
    readonly skills: readonly SkillForTool[];
    readonly tools: readonly ToolDefinition[];
    readonly seqCursor: { value: number };
  },
): Promise<{ readonly text: string }> {
  const byToolName = indexSkillsByToolName(input.skills);
  let toolExchange: ToolExchangeTurn[] = [];

  for (let round = 0; round < MAX_TOOL_LOOP_ROUNDS; round += 1) {
    const completion = await deps.model.complete({
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      system: input.system,
      user: run.inputText,
      history: input.history,
      tools: input.tools,
      toolExchange,
    });

    if (!completion.toolCalls || completion.toolCalls.length === 0) {
      if (completion.text.trim() === "") {
        throw new ModelCallError(
          "MODEL_CALL_FAILED",
          "provider returned neither content nor a tool call",
        );
      }
      return { text: completion.text };
    }

    toolExchange = [
      ...toolExchange,
      { kind: "assistant_tool_calls", toolCalls: completion.toolCalls },
    ];

    for (const call of completion.toolCalls) {
      const stepStartedAt = deps.clock.now();
      const skill = byToolName.get(call.name);
      const task = extractTaskArgument(call.argumentsJson);

      const { resultText, failureCode } = skill === undefined
        ? {
          resultText:
            `未知工具「${call.name}」：本次运行挂载的技能里没有这一个，`
            + "换一个已列出的工具，或直接根据已有信息回答。",
          failureCode: "MODEL_CALL_FAILED" as RunFailureCode,
        }
        : await executeSkillTool(deps, run, skill, task);

      await record(deps, orgId, {
        runId: run.runId, seq: input.seqCursor.value, kind: "tool_call", startedAt: stepStartedAt,
        inputDigest: sha256(call.argumentsJson), outputDigest: sha256(resultText),
        failureCode,
        toolName: call.name,
        toolArgsSummary: summarize(call.argumentsJson),
        toolResultSummary: summarize(resultText),
      });
      input.seqCursor.value += 1;

      toolExchange = [
        ...toolExchange,
        { kind: "tool_result", toolCallId: call.id, name: call.name, content: resultText },
      ];
    }
  }

  throw new ModelCallError(
    "TOOL_LOOP_LIMIT_EXCEEDED",
    `tool loop did not reach a final answer within ${MAX_TOOL_LOOP_ROUNDS} rounds`,
  );
}

async function executeClaimed(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  run: ClaimedAgentRun,
): Promise<void> {
  /* ── step: context_built ── */
  const contextStartedAt = deps.clock.now();
  const contextInput = sha256(
    JSON.stringify([run.agentVersionId, run.skillVersionIds, run.inputMessageId]),
  );
  let system: string;
  let toolSkills: readonly SkillForTool[] = [];
  let tools: readonly ToolDefinition[] = [];
  try {
    const skills = await deps.runs.readPinnedSkills(orgId, run.skillVersionIds);
    if (skills.length !== run.skillVersionIds.length) {
      // Fail closed. A run that quietly proceeds with two of its three pinned Skills has
      // produced an answer from a configuration nobody ever approved.
      throw new ModelCallError(
        "SKILL_VERSION_UNAVAILABLE",
        `pinned ${run.skillVersionIds.length}, retrieved ${skills.length}`,
      );
    }
    // #725: any pinned Skill turns this run into a tool-calling run. Zero pinned Skills
    // (`tools.length === 0` below) takes the EXACT pre-#725 prompt/call shape -- see
    // `buildOrchestratorSystemPrompt`'s own doc comment for what a non-empty `tools` adds
    // on top of that same shape.
    toolSkills = skills;
    tools = deps.toolCallingEnabled ? buildToolDefinitions(skills) : [];
    system = tools.length > 0
      ? buildOrchestratorSystemPrompt(run.instructions, skills, tools)
      : buildSystemPrompt(run.instructions, skills);
  } catch (e) {
    // Every way of not getting the pinned context is the same fact for a client: the run
    // could not be assembled from what was pinned. The distinguishing detail is logged.
    const code: RunFailureCode = "SKILL_VERSION_UNAVAILABLE";
    deps.log("agent run context build failed", {
      runId: run.runId,
      code,
      detail: e instanceof ModelCallError ? e.detail : "pinned context source unavailable",
    });
    await record(deps, orgId, {
      runId: run.runId, seq: 2, kind: "context_built", startedAt: contextStartedAt,
      inputDigest: contextInput, outputDigest: null, failureCode: code,
    });
    await deps.runs.failRun(orgId, run.runId, code);
    return;
  }
  const systemDigest = sha256(system);
  await record(deps, orgId, {
    runId: run.runId, seq: 2, kind: "context_built", startedAt: contextStartedAt,
    inputDigest: contextInput, outputDigest: systemDigest, failureCode: null,
  });

  /*
   * #709 -- prior turns of this thread, trimmed to the token-budget policy above.
   *
   * Deliberately OUTSIDE the `context_built` try/catch and never fails the run: unlike the
   * pinned Skill content above (a fact the run's approved configuration depends on), thread
   * history is dynamic conversation context, an enhancement over the pre-#709 single-turn
   * behaviour, not a correctness requirement the acceptance snapshot pinned. A history-read
   * failure degrading to "answer without prior context" (i.e. exactly today's behaviour) is
   * a strictly safer failure mode than turning a working single-turn run into a failed one
   * because of it -- especially since #709 ships behind no flag and must not be able to
   * regress runs that never needed history in the first place.
   */
  let history: ReturnType<typeof trimHistoryToBudget> = [];
  try {
    const recent = await deps.runs.readThreadHistory(
      orgId, run.threadId, run.inputMessageId, HISTORY_MAX_MESSAGES,
    );
    history = trimHistoryToBudget(recent, HISTORY_MAX_CHARS);
  } catch (e) {
    deps.log("agent run thread history read failed, continuing without it", {
      runId: run.runId,
      detail: e instanceof Error ? e.message : "unexpected thread history read failure",
    });
  }

  /* ── step: model_called -- exactly one FINAL answer, whatever it took to reach it ── */
  const modelStartedAt = deps.clock.now();
  let text: string;
  // #725: advanced by `executeToolLoop` as it records `tool_call` steps, so it holds the
  // correct next `seq` for the terminal `model_called` step on BOTH the success path and
  // the catch below -- see that function's own doc comment on `seqCursor`.
  const seqCursor = { value: 3 };
  try {
    if (tools.length > 0) {
      // #725: the tool-calling loop. Never streamed (see `ModelCallPort.completeStream`'s
      // own doc comment for why) and never mixed with the branch below for the same run.
      const loopResult = await executeToolLoop(deps, orgId, run, {
        system, history, skills: toolSkills, tools, seqCursor,
      });
      text = loopResult.text;
    } else {
      // #654 阶段2a: when the configured port supports streaming, use it and persist each
      // fragment as it arrives -- purely observational (see `AppendedRunDelta`'s own doc):
      // the run's success/failure is still decided by the SAME accumulated-text checks
      // below, exactly as the non-streaming path decides it. A port without `completeStream`
      // falls back to the one-shot `complete()`, unchanged from before this delta.
      let deltaSeq = 0;
      const completion = deps.model.completeStream
        ? await deps.model.completeStream(
          {
            modelProvider: run.modelProvider, modelId: run.modelId, system, user: run.inputText,
            history,
          },
          async (delta) => {
            if (delta === "") return; // Nothing to persist; not every provider fragment carries text.
            const seq = deltaSeq;
            deltaSeq += 1;
            await deps.runs.appendModelDelta(orgId, { runId: run.runId, seq, text: delta });
          },
        )
        : await deps.model.complete({
          modelProvider: run.modelProvider,
          modelId: run.modelId,
          system,
          user: run.inputText,
          history,
        });
      if (completion.text.trim() === "") {
        throw new ModelCallError("MODEL_CALL_FAILED", "provider returned empty content");
      }
      text = completion.text;
    }
  } catch (e) {
    const code: RunFailureCode = e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED";
    // The provider's own words live here and stop here. `detail` never reaches a response;
    // the run's terminal `error` is the enumerated code above.
    deps.log("agent run model call failed", {
      runId: run.runId,
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      code,
      detail: e instanceof ModelCallError ? e.detail : "unexpected model call failure",
    });
    await record(deps, orgId, {
      runId: run.runId, seq: seqCursor.value, kind: "model_called", startedAt: modelStartedAt,
      inputDigest: systemDigest, outputDigest: null, failureCode: code,
    });
    await deps.runs.failRun(orgId, run.runId, code);
    return;
  }
  await record(deps, orgId, {
    runId: run.runId, seq: seqCursor.value, kind: "model_called", startedAt: modelStartedAt,
    inputDigest: systemDigest, outputDigest: sha256(text), failureCode: null,
  });

  /* ── hand off to #413 ── */
  // `writeback_pending`, not `succeeded`. §6: the run may only become succeeded after the
  // Chat writeback transaction commits, and that transaction is not in this slice.
  await deps.runs.storeOutputAwaitingWriteback(
    orgId, run.runId, { text, finalStepSeq: seqCursor.value },
  );
}

/**
 * Claim and execute one bounded batch of this tenant's queued runs.
 *
 * Returns how many runs were executed (successfully or not) -- the caller uses it only for
 * observability. Nothing here throws for a run-level failure; a batch is not abandoned
 * because one run's provider was down.
 */
export async function executeQueuedRuns(
  deps: ExecuteAgentRunDeps,
  input: { readonly orgId: OrgId; readonly limit?: number },
): Promise<number> {
  const claimed = await deps.runs.claimQueued(input.orgId, Math.min(20, input.limit ?? 10));
  for (const outcome of claimed) {
    if (outcome.kind === "unresolvable") {
      // The claim already moved it out of `queued`, so it cannot be left as-is.
      deps.log("agent run snapshot no longer resolvable", {
        runId: outcome.runId, code: "AGENT_VERSION_UNAVAILABLE",
      });
      await deps.runs.failRun(input.orgId, outcome.runId, "AGENT_VERSION_UNAVAILABLE");
      continue;
    }
    try {
      await executeClaimed(deps, input.orgId, outcome.run);
    } catch (e) {
      // A defect in this file, not a provider failure. Still recorded, still terminal:
      // leaving the run stuck in `running` forever is the one outcome nobody can act on.
      deps.log("agent run executor defect", {
        runId: outcome.run.runId,
        detail: e instanceof Error ? e.name : "unknown",
      });
      await deps.runs.failRun(input.orgId, outcome.run.runId, "MODEL_CALL_FAILED");
    }
  }
  return claimed.length;
}
