/**
 * issue #4283（人类决定，2026-09-26）—— 本人说出的「决定」自动记进**说话人自己的**个人空间，可撤销。
 *
 * 接在抽取（F06）同一个任务里、判矛盾（F16）之后：已经被标成冲突的新条不复制（数据库也拒），
 * 任务重试时再跑一遍无害（已经复制过的不再是候选；数据库对同一条也原样返回）。
 *
 * 分工：
 *   - 数据库（迁移 20260926131000）决定**写进谁的空间**：只看证据消息的作者，结论的全部支持证据必须都是
 *     这个人本人在本会话里说的话——别人的话不会进你的空间，你的话也不会进别人的；
 *   - 这里决定**哪些算决定**：`decisionLike()`（唯一的词表，宁可漏不可误），非决定类照旧要手动晋升；
 *   - 去重复用 F11 的 `dedupAgainstPersonal`：同一句话（归一后相同）⇒ 合并进已有那条，不复制第二份；
 *     只是「相近」的 ⇒ 另记一条（没有人可以问「合并还是并存」，合并会丢掉新说法；副本仍可一键撤销）。
 *
 * 副本在个人空间里仍是「AI 记下的」（proposed），不冒充「你确认过的」。
 */
import type { OrgId } from "../../domain/org-id";
import { decisionLike } from "../../domain/knowledge-graph/decision-claim";
import { dedupAgainstPersonal } from "../../domain/knowledge-graph/promotion";
import type { LoggerPort } from "../ports/logger.port";
import { KgAutoCopyRejected, KgHumanActionError, type KgAutoCopyPort } from "./ports";
import { visibleThread, type KnowledgeReadDeps } from "./read-thread-knowledge";

export interface AutoCopyDeps {
  readonly autoCopy: KgAutoCopyPort;
  readonly logger: LoggerPort;
  readonly newId: (prefix: "act") => string;
}

/** 返回这条消息记进作者个人空间的决定条数（新建 + 合并）。 */
export async function copyAuthorDecisions(
  deps: AutoCopyDeps,
  job: { readonly orgId: OrgId; readonly threadId: string; readonly messageId: string },
): Promise<number> {
  const c = await deps.autoCopy.candidates(job.orgId, job.threadId, job.messageId);
  if (c.author === null) return 0;
  const personal = [...c.personal];
  let copied = 0;
  for (const claim of c.fresh) {
    if (!decisionLike(claim.statement)) continue;
    // 每条都拿更新过的个人空间判：同一条消息里说了两遍同一个决定，也只落一份。
    const verdict = dedupAgainstPersonal(claim.statement, personal);
    const merge = verdict.kind === "duplicate";
    try {
      const personalId = await deps.autoCopy.copy(job.orgId, {
        actionId: deps.newId("act"), threadId: job.threadId, messageId: job.messageId, claimId: claim.id,
        mode: merge ? "merge" : "new", ...(verdict.kind === "duplicate" ? { targetClaimId: verdict.existingId } : {}),
      });
      if (!merge) personal.push({ id: personalId, statement: claim.statement });
      copied += 1;
    } catch (e) {
      if (!(e instanceof KgAutoCopyRejected)) throw e;
      // 数据库复核不过（并发里被撤销 / 标冲突、原话刚被删……）：这一条跳过，留痕可查，其余照常。
      deps.logger.info("kg decision auto-copy rejected", {
        traceId: "kg-extraction", orgId: job.orgId, messageId: job.messageId, claimId: claim.id, code: e.code,
      });
    }
  }
  return copied;
}

/**
 * 反馈条上的「撤销」（人的动作，I-15）：撤掉本人个人空间里由这条会话结论自动记下的那一份。
 * 先过会话可见性（与读这条消息的反馈同一个判定），再由数据库只在**调用者本人**的空间里找。
 */
export async function undoAutoPersonalCopy(
  deps: KnowledgeReadDeps & { readonly autoCopy: KgAutoCopyPort; readonly newId: (prefix: "act") => string },
  input: {
    readonly userId: string;
    readonly orgId: OrgId;
    /** 接口层只有人类会话能到这里（恒为 human）；其余入口一律 agent。 */
    readonly actorKind: "human" | "agent";
    readonly threadId: string;
    readonly claimId: string;
  },
): Promise<{ readonly personalClaimId: string; readonly outcome: "revoked" | "detached" }> {
  if (input.actorKind !== "human") throw new KgHumanActionError("KG_ACTOR_NOT_HUMAN");
  await visibleThread(deps, input, input.threadId);
  return deps.autoCopy.undo(input.orgId, input.userId, {
    actionId: deps.newId("act"), threadId: input.threadId, claimId: input.claimId,
  });
}
