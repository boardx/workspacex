/**
 * `PlanRunCreator` implementation for F975 UC-7 `confirmPlan`.
 *
 * Wraps the SAME "accept a human message, kick the executor" pipeline
 * `runAguiBridgeTurn` (`application/agent-run/agui-bridge.ts:350-355`) and the REST
 * `chat.controller.ts` message route both already use -- `acceptHumanMessage`'s own doc
 * calls it "人类消息进入 chat 的唯一入口", so this is the same door, not a second one.
 * `confirmPlan` does not know agent resolution, Skill pinning, or idempotency; this class
 * is where those existing rules get reused.
 *
 * ⚠ issue #2250 —— **`kick` alone is not enough.** `executor.kick()` claims and executes
 * the queued run (a real model call really happens), but nothing was ever watching that
 * run's steps for a `write_todos` success to feed back into `chat_plan_ledgers`. That
 * feedback loop exists in exactly ONE place today: `copilotkit-agui.controller.ts`'s
 * `onStep` callback, wired only into the live AG-UI SSE bridge (`runAguiBridgeTurn`/
 * `resumeAguiBridgeTurn`) -- a turn started here, through the plain queued/`tick` pathway,
 * had no equivalent. The account-visible symptom: `confirm` flips the ledger `phase` to
 * `"executing"` (this class's own effect, via `confirmPlan`'s digest write), a real run
 * really executes server-side (invisible to a browser network monitor -- it is a
 * server-to-server call to deep-agent-service, never a request the client makes), but every
 * plan step's `status` stays `"pending"` forever because nobody ever re-ingests the model's
 * `write_todos` output.
 *
 * The fix below is a scoped, bounded background watcher (`watchPlanProgress`) that mirrors
 * `agui-bridge.ts`'s `pollAguiRunToOutcome`'s `onStep` handling -- same poll budget
 * (`poll-budget.ts`), same `parseWriteTodosSnapshot` → `ingestEnginePlanSnapshot` hookup
 * `copilotkit-agui.controller.ts` already uses -- but scoped to plan-control's own
 * infrastructure, not a change to the shared execution core (`execute-run.ts`) or the AG-UI
 * bridge (`agui-bridge.ts`)/(`copilotkit-agui.controller.ts`), which stay byte-for-byte
 * unchanged. It runs AFTER this method already returned its `runId` (fire-and-forget, not
 * awaited) -- `confirmPlan`'s HTTP response must stay fast (existing, tested behaviour: 201
 * before the run finishes), only the FEEDBACK LOOP was missing, not the response shape.
 * A watcher failure (claim error, transient DB error, poll budget exhausted) is logged and
 * swallowed, never thrown into the caller -- the run itself keeps executing and writes back
 * to chat regardless of whether this incidental plan-ledger sync succeeds.
 */
import { randomUUID } from "node:crypto";
import { acceptHumanMessage } from "../../application/chat/message-roundtrip";
import type {
  ChatMessageCommandRepository, EnabledSkillVersionReader, PublishedAgentReader, ThreadMountedSkillReader,
} from "../../application/chat/message-command-ports";
import type { ChatRepository } from "../../application/chat/ports";
import type { DecisionIdFactory, IdentityRepository } from "../../application/identity/ports";
import type { OrgId } from "../../domain/org-id";
import { readAgentRun, AgentRunNotVisibleError } from "../../application/agent-run/read-run";
import { DEFAULT_RUN_POLL_INTERVAL_MS, DEFAULT_RUN_MAX_POLLS } from "../../application/agent-run/poll-budget";
import type { AgentRunExecutorPort, AgentRunStore } from "../../application/agent-run/ports";
import type { LoggerPort } from "../../application/ports/logger.port";
import { parseWriteTodosSnapshot } from "@repo/contracts/agui-state-events";
import { ingestEnginePlanSnapshot } from "../../application/plan-control/ingest-engine-plan-snapshot";
import type {
  PlanRunCreator, PlanRunCreatorInput, PlanRunCreatorOutput,
} from "../../application/plan-control/plan-run-creator-port";
import type { PlanLedgerRepository, PlanRunStatusReader } from "../../application/plan-control/ports";
// 2026-08-27：`acceptHumanMessage` 的自动命名叠加模型摘要，见 `generate-thread-title.ts`
// 头注。这条通路也过 `acceptHumanMessage`，缺这三个字段编译期就会红。计划确认消息是
// 固定合成文案，不是真实用户输入——但 `autoTitleFromFirstMessage` 只在这是线程**首条**
// 消息时才会真正调用模型（`WHERE title=$默认名`），而 `createConfirmedRun` 的前置条件
// 是"线程上已有过一次真实 run"，也就必然已有过一条真实的首条消息，这里的模型调用
// 实践中恒是 no-op（`autoTitleThreadIfDefault` 命中 0 行）。
import type { GenerateThreadTitleDeps } from "../../application/chat/generate-thread-title";

export interface AcceptMessagePlanRunCreatorDeps extends GenerateThreadTitleDeps {
  readonly repo: IdentityRepository;
  readonly ids: DecisionIdFactory;
  readonly chat: ChatRepository;
  readonly commands: ChatMessageCommandRepository;
  readonly publishedAgents: PublishedAgentReader;
  readonly threadMounts: ThreadMountedSkillReader;
  /** #2514：`acceptHumanMessage` 的必填依赖，同 `threadMounts`。 */
  readonly enabledSkills: EnabledSkillVersionReader;
  readonly executor: AgentRunExecutorPort;
  /** `PgPlanLedgerRepository` implements both -- one instance behind two tokens
   * (`kernel.module.ts`'s own comment on `PLAN_RUN_STATUS_READER`'s provider), so widening
   * this field's type costs no new DI wiring. */
  readonly runs: PlanLedgerRepository & PlanRunStatusReader;
  /** issue #2250 -- needed to poll the confirmed run's own steps back for `write_todos`. */
  readonly agentRunStore: AgentRunStore;
  readonly logger: LoggerPort;
}

/**
 * ⚠ **The confirmation text is a fixed, synthetic system-authored message**, not something
 * a real user typed. `confirmPlan`'s `in` shape (`usecases.md` UC-7) has no free-text field
 * — the whole point of the confirm gate is "the PLAN is what was reviewed", not a fresh
 * prompt.
 *
 * ⚠ **Known gap, stated plainly**: each call mints a fresh `clientMessageId`
 * (`acceptHumanMessage`'s own idempotency key), so two `confirmPlan` calls -- including a
 * genuine client retry of the exact same `basedOnRevision` (confirming does not itself
 * mint a new ledger revision, so `PLAN_REVISION_CHANGED` does not catch a resend) -- create
 * TWO separate runs rather than deduplicating. Fixing that needs a stable idempotency key
 * derived from `(threadId, basedOnRevision)`, left as a follow-up rather than claimed.
 */
export const PLAN_CONFIRMATION_MESSAGE_TEXT = "（用户已确认当前计划，请按计划执行。）";

export class AcceptMessagePlanRunCreator implements PlanRunCreator {
  constructor(private readonly deps: AcceptMessagePlanRunCreatorDeps) {}

  async createConfirmedRun(input: PlanRunCreatorInput): Promise<PlanRunCreatorOutput> {
    const latestRun = await this.deps.runs.getLatestRun(input.orgId, input.threadId);
    if (latestRun === null) {
      // No prior run on this thread means no agent ever produced a plan here -- confirming
      // a plan on a thread nothing has ever run on is not a state UC-7's precondition
      // ("gate.required===true") can reach (the gate requires todoCount>=2, which requires
      // a write_todos call, which requires a run). Surfacing this as a plain error rather
      // than guessing a default agent keeps the failure honest instead of silently
      // routing to whichever agent happens to be the org's default.
      throw new Error("PLAN_DELIVERY_FAILED: no prior agent run on this thread to continue");
    }

    const clientMessageId = randomUUID();
    const accepted = await acceptHumanMessage(this.deps, {
      userId: input.actorId, orgId: input.orgId, threadId: input.threadId,
      clientMessageId, text: input.messageText ?? PLAN_CONFIRMATION_MESSAGE_TEXT, agentId: latestRun.agentId,
      onAccepted: () => this.deps.executor.kick(input.orgId),
    });
    // issue #2250 -- fire-and-forget: the confirm/resume/retry HTTP response must stay fast
    // (existing, tested behaviour), only the plan-ledger feedback loop was missing. Errors
    // are logged inside `watchPlanProgress` itself and never rejected out of this promise.
    void this.watchPlanProgress({
      orgId: input.orgId, actorId: input.actorId, threadId: input.threadId, runId: accepted.agentRunId,
    });
    return { runId: accepted.agentRunId };
  }

  /**
   * issue #2250 -- mirrors `agui-bridge.ts`'s `pollAguiRunToOutcome`'s `onStep` handling
   * (same poll budget, same `parseWriteTodosSnapshot` → `ingestEnginePlanSnapshot` hookup
   * `copilotkit-agui.controller.ts` already uses for the live AG-UI track), scoped to the
   * plan-control-triggered continuation run this class itself just created. Bounded by the
   * SAME `DEFAULT_RUN_MAX_POLLS`/`DEFAULT_RUN_POLL_INTERVAL_MS` budget as every other
   * run-polling consumer in this codebase (see that file's header for the current total and
   * why it moves) -- not a second, independently-tuned timeout.
   */
  private async watchPlanProgress(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly threadId: string; readonly runId: string;
  }): Promise<void> {
    const deps = { repo: this.deps.repo, ids: this.deps.ids, chat: this.deps.chat, runs: this.deps.agentRunStore };
    let reportedStepCount = 0;
    try {
      for (let attempt = 0; attempt < DEFAULT_RUN_MAX_POLLS; attempt += 1) {
        const projection = await readAgentRun(deps, {
          userId: input.actorId, orgId: input.orgId, runId: input.runId,
        });
        for (const step of projection.steps.slice(reportedStepCount)) {
          if (step.kind === "tool_call" && step.status === "succeeded"
            && step.toolName === "write_todos" && step.toolArgsSummary !== null) {
            const snapshot = parseWriteTodosSnapshot(step.toolArgsSummary);
            if (snapshot !== null) {
              try {
                await ingestEnginePlanSnapshot(this.deps.runs, {
                  orgId: input.orgId, threadId: input.threadId, todos: snapshot.todos,
                });
              } catch (e) {
                this.deps.logger.error("plan-control: ingestEnginePlanSnapshot failed (confirmed-run watcher)", {
                  traceId: randomUUID(), threadId: input.threadId, runId: input.runId,
                  err: e instanceof Error ? e.message : "unexpected write failure",
                });
              }
            }
          }
        }
        reportedStepCount = projection.steps.length;
        if (projection.status === "succeeded" || projection.status === "failed"
          || projection.status === "awaiting_tool_permission") return;
        await new Promise((resolve) => setTimeout(resolve, DEFAULT_RUN_POLL_INTERVAL_MS));
      }
      // Poll budget exhausted -- the run itself keeps executing server-side (nothing here
      // cancels it, same discipline as `agui-bridge.ts`'s own timeout outcome); only this
      // incidental plan-ledger sync gives up. Logged, not thrown.
      this.deps.logger.error("plan-control: confirmed-run watcher exhausted its poll budget", {
        traceId: randomUUID(), threadId: input.threadId, runId: input.runId,
        err: "poll_budget_exhausted",
      });
    } catch (e) {
      if (e instanceof AgentRunNotVisibleError) return;
      this.deps.logger.error("plan-control: confirmed-run watcher failed", {
        traceId: randomUUID(), threadId: input.threadId, runId: input.runId,
        err: e instanceof Error ? e.message : "unexpected watcher failure",
      });
    }
  }
}
