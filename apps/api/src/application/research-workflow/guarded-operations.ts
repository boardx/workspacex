/**
 * 研判工作流的**对外入口**：先判可见性，再判状态机。
 *
 * ## 为什么要有这一层，而不是让控制器直接调 `passGate`
 *
 * `passGate` 回答的是「这个推进在业务上成不成立」，它**不知道调用者是谁**——
 * 领域与用例层刻意不碰身份。但一个能过门的人必须首先是**看得见这条线程的人**，
 * 否则「人工确认」这件事就可以由任何一个知道 threadId 的人完成，门形同虚设。
 *
 * 把这两步拼起来的地方只能有一个。若让每个控制器自己先 `resolveVisibility` 再
 * `passGate`，那么"有没有判可见性"就变成每个路由各自的良心问题——本仓的
 * `resolve-visibility.ts` 头注已经把这条教训写死了：**每一个读端口的前置，没有例外**。
 *
 * 写端口同理，而且更严重：读漏了是泄露，写漏了是越权修改流程状态。
 */
import type { researchWorkflow as C } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import {
  resolveVisibility,
  type ResolveVisibilityDeps,
} from "../chat/resolve-visibility";
import { ThreadNotVisibleError } from "../chat/get-thread";
import { advancePhase, passGate, type PassGateDeps } from "./pass-gate";
import type { ResearchSessionRow } from "./ports";

export interface ResearchOpsDeps extends PassGateDeps, ResolveVisibilityDeps {}

export interface ResearchActor {
  readonly userId: string;
  readonly orgId: OrgId;
  /** team3 用个人线程 ⇒ 恒为 null；留成参数是因为将来项目线程也要能走这条流程。 */
  readonly projectId: string | null;
  readonly threadId: string;
}

/**
 * 可见性前置。看不见 = 404 语义（`ThreadNotVisibleError`），
 * 与「线程不存在」同一出口——不泄露存在性（I-3）。
 */
async function assertVisible(deps: ResearchOpsDeps, actor: ResearchActor): Promise<void> {
  const outcome = await resolveVisibility(deps, {
    userId: actor.userId,
    orgId: actor.orgId,
    projectId: actor.projectId,
    threadId: actor.threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();
}

export async function readSession(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
): Promise<ResearchSessionRow> {
  await assertVisible(deps, actor);
  return deps.research.ensureSession(actor.orgId, actor.threadId);
}

export async function addMaterials(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
  items: readonly { source: string; label: string }[],
): Promise<ResearchSessionRow> {
  await assertVisible(deps, actor);
  return deps.research.addMaterials(actor.orgId, actor.threadId, items as never);
}

/**
 * 逐条判定一条材料。
 *
 * 判为 `missing`/`wrong` 时**顺带把重采计数加一**：活动图里"标注缺失/错误"与
 * "重新采集"是同一个动作的两面——标注完就是要求再采一次。分成两次调用的话，
 * 前端漏调第二次就会得到一个"被打回但次数没长"的状态，两次失败即停的上限永远到不了。
 */
export async function reviewMaterial(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
  materialId: string,
  verdict: C.MaterialVerdictName,
  note: string | null,
): Promise<ResearchSessionRow> {
  await assertVisible(deps, actor);
  const afterVerdict = await deps.research.setMaterialVerdict(
    actor.orgId, actor.threadId, materialId, verdict, note,
  );
  if (verdict !== "missing" && verdict !== "wrong") return afterVerdict;
  return deps.research.bumpMaterialAttempts(actor.orgId, actor.threadId, materialId);
}

export async function passGateGuarded(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
  gate: C.ResearchGateName,
): Promise<ResearchSessionRow> {
  await assertVisible(deps, actor);
  return passGate(deps, actor.orgId, actor.threadId, gate);
}

export async function advancePhaseGuarded(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
  to: C.ResearchPhaseName,
): Promise<ResearchSessionRow> {
  await assertVisible(deps, actor);
  return advancePhase(deps, actor.orgId, actor.threadId, to);
}

/** 审计读回——界面上「这条线程发生过哪些推进与拒绝」那一栏。 */
export async function readAudit(deps: ResearchOpsDeps, actor: ResearchActor, limit = 50) {
  await assertVisible(deps, actor);
  return deps.research.listAudit(actor.orgId, actor.threadId, limit);
}
