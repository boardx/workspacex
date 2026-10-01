/**
 * issue #4360（S5）——「关于我」画像层的三个动作。
 *
 *   - `setGoalLink` / `revisePersonalClaim`：人的动作（Agent 身份拒绝），只在调用者本人的个人空间里动；
 *     先过个人空间判定（同 getPersonalKnowledge：是本组织成员），再交数据库——数据库再按 app.current_user_id 限定一次。
 *   - `proposeGoalLinks`：抽取任务里、#4283 自动记入之后的一步（系统身份）。这条消息刚记进作者本人个人空间的决定 / 待办，
 *     如果作者本人有目标，就请模型提议「它为哪个目标服务」；**只有把握 ≥ `GOAL_LINK_MIN_CONFIDENCE` 才挂**，
 *     低把握 / 读不懂 / 提议了不存在的目标 ⇒ 不挂，留一条日志。数据库只挂从没挂过的（不覆盖人的选择）。
 *     这一步出任何错都不影响抽取本身（记日志、这条消息照常算写成）。
 */
import { GOAL_LINK_MIN_CONFIDENCE } from "../../domain/knowledge-graph/profile";
import type { OrgId } from "../../domain/org-id";
import type { LoggerPort } from "../ports/logger.port";
import { guard } from "../security/permission-filter";
import { KgHumanActionError } from "./ports";
import type { GoalLinkPort, GoalLinkProposerPort } from "./profile-ports";
import { decidePersonalSpace } from "./read-personal-knowledge";
import { KgReadError, type KnowledgeReadDeps } from "./read-thread-knowledge";

interface Viewer {
  readonly userId: string;
  readonly orgId: OrgId;
  /** 接口层只有人类会话能到这里（恒为 human）；其余入口一律 agent。 */
  readonly actorKind: "human" | "agent";
}

/**
 * 本人个人空间的组织层判定（是 / 仍是本组织成员）。ref 就是查看者自己的个人空间（`personal:<userId>`），
 * 所以这里真正判的只有组织层；不是成员 ⇒ `KG_NOT_VISIBLE`（HTTP 403，同 getPersonalKnowledge）。
 */
export async function requireOwnPersonalSpace(deps: KnowledgeReadDeps, viewer: { readonly userId: string; readonly orgId: OrgId }): Promise<void> {
  const d = await decidePersonalSpace(deps, viewer, guard({ kind: "project", id: `personal:${viewer.userId}` }, null));
  if (!d.allowed) throw new KgReadError("KG_NOT_VISIBLE");
}

export async function setGoalLink(
  deps: KnowledgeReadDeps & { readonly goalLinks: GoalLinkPort; readonly newId: (prefix: "act") => string },
  input: Viewer & { readonly claimId: string; readonly goalClaimId: string | null },
): Promise<{ readonly claimId: string; readonly goalClaimId: string | null }> {
  if (input.actorKind !== "human") throw new KgHumanActionError("KG_ACTOR_NOT_HUMAN");
  await requireOwnPersonalSpace(deps, input);
  const r = await deps.goalLinks.set(input.orgId, { kind: "human", userId: input.userId }, {
    actionId: deps.newId("act"), claimId: input.claimId, goalClaimId: input.goalClaimId,
  });
  return { claimId: r.claimId, goalClaimId: r.goalClaimId };
}

export async function revisePersonalClaim(
  deps: KnowledgeReadDeps & { readonly goalLinks: GoalLinkPort; readonly newId: (prefix: "act") => string },
  input: Viewer & { readonly claimId: string; readonly statement: string },
): Promise<{ readonly claimId: string }> {
  if (input.actorKind !== "human") throw new KgHumanActionError("KG_ACTOR_NOT_HUMAN");
  await requireOwnPersonalSpace(deps, input);
  const claimId = await deps.goalLinks.revise(input.orgId, input.userId, {
    actionId: deps.newId("act"), claimId: input.claimId, statement: input.statement.trim(),
  });
  return { claimId };
}

export interface GoalLinkDeps {
  readonly goalLinks: GoalLinkPort;
  readonly proposer: GoalLinkProposerPort;
  readonly logger: LoggerPort;
  readonly newId: (prefix: "act") => string;
}

/** 返回这条消息自动挂上的条数。 */
export async function proposeGoalLinks(
  deps: GoalLinkDeps,
  job: { readonly orgId: OrgId; readonly threadId: string; readonly messageId: string },
): Promise<number> {
  const c = await deps.goalLinks.candidates(job.orgId, job.threadId, job.messageId);
  if (c.author === null || c.items.length === 0 || c.goals.length === 0) return 0;
  const goals = c.goals.map((g, i) => ({ key: `g${i + 1}`, id: g.id, statement: g.statement }));
  let linked = 0;
  for (const item of c.items) {
    const p = await deps.proposer.propose({ item: { statement: item.statement, kind: item.kind }, goals: goals.map(({ key, statement }) => ({ key, statement })) });
    const goal = p === null || p.goalKey === null ? undefined : goals.find((g) => g.key === p.goalKey);
    if (p === null || goal === undefined || !(p.confidence >= GOAL_LINK_MIN_CONFIDENCE)) {
      deps.logger.info("kg goal link not applied", {
        traceId: "kg-extraction", orgId: job.orgId, messageId: job.messageId, claimId: item.id,
        reason: p === null ? "unparseable" : p.goalKey === null ? "no_goal" : goal === undefined ? "unknown_goal" : "low_confidence",
        confidence: p?.confidence ?? null,
      });
      continue;
    }
    try {
      const r = await deps.goalLinks.set(job.orgId, { kind: "system", threadId: job.threadId, messageId: job.messageId }, {
        actionId: deps.newId("act"), claimId: item.id, goalClaimId: goal.id, confidence: p.confidence,
      });
      if (r.outcome === "linked") linked += 1;
    } catch (e) {
      if (!(e instanceof KgHumanActionError)) throw e;
      // 数据库复核不过（并发里被撤销 / 目标被忘掉……）：这一条不挂，留痕可查。
      deps.logger.info("kg goal link rejected", { traceId: "kg-extraction", orgId: job.orgId, messageId: job.messageId, claimId: item.id, code: e.code });
    }
  }
  return linked;
}
