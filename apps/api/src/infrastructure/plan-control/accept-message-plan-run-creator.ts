/**
 * `PlanRunCreator` implementation for F975 UC-7 `confirmPlan`.
 *
 * Wraps the SAME "accept a human message, kick the executor" pipeline
 * `runAguiBridgeTurn` (`application/agent-run/agui-bridge.ts:350-355`) and the REST
 * `chat.controller.ts` message route both already use -- `acceptHumanMessage`'s own doc
 * calls it "人类消息进入 chat 的唯一入口", so this is the same door, not a second one.
 * `confirmPlan` does not know agent resolution, Skill pinning, or idempotency; this class
 * is where those existing rules get reused.
 */
import { randomUUID } from "node:crypto";
import { acceptHumanMessage } from "../../application/chat/message-roundtrip";
import type {
  ChatMessageCommandRepository, PublishedAgentReader, ThreadMountedSkillReader,
} from "../../application/chat/message-command-ports";
import type { ChatRepository } from "../../application/chat/ports";
import type { DecisionIdFactory, IdentityRepository } from "../../application/identity/ports";
import type { AgentRunExecutorPort } from "../../application/agent-run/ports";
import type {
  PlanRunCreator, PlanRunCreatorInput, PlanRunCreatorOutput,
} from "../../application/plan-control/plan-run-creator-port";
import type { PlanRunStatusReader } from "../../application/plan-control/ports";
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
  readonly executor: AgentRunExecutorPort;
  readonly runs: PlanRunStatusReader;
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
    });
    this.deps.executor.kick(input.orgId);
    return { runId: accepted.agentRunId };
  }
}
