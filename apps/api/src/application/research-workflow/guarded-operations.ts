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
import { advancePhase, passGate, ResearchGateRefusedError, type Opener, type PassGateDeps } from "./pass-gate";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { decideFill } from "../../domain/research-workflow/verification";
import type { ResearchPredictionRow, ResearchSessionRow } from "./ports";

export interface ResearchOpsDeps extends PassGateDeps, ResolveVisibilityDeps {}

export interface ResearchActor {
  readonly userId: string;
  readonly orgId: OrgId;
  /** team3 用个人线程 ⇒ 恒为 null；留成参数是因为将来项目线程也要能走这条流程。 */
  readonly projectId: string | null;
  readonly threadId: string;
}

/**
 * 可见性前置，**并交出一把解锁租户内容的钥匙**。
 *
 * 仓储只交出 `Guarded<T>`（`lint-permission-paths` 要求的），payload 够不着。
 * 想读到它，唯一的路径是本函数返回的 `open`——而它只在判定为 allow 时才存在。
 * 于是"忘了判可见性"从一次疏漏变成一个**编译错误**：没有 open 就没有数据。
 *
 * 看不见 = 404 语义（`ThreadNotVisibleError`），与「线程不存在」同一出口，
 * 不泄露存在性（I-3）。
 */
async function openVisible(deps: ResearchOpsDeps, actor: ResearchActor): Promise<Opener> {
  const outcome = await resolveVisibility(deps, {
    userId: actor.userId,
    orgId: actor.orgId,
    projectId: actor.projectId,
    threadId: actor.threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  const decision = outcome.base;
  return <T>(g: Guarded<T>): T => {
    const r = discloseDecided(g, decision);
    // 判定说 allow 却披露失败，只可能是这两者不指同一个对象——那是编程错误，
    // 不是权限拒绝，不能降级成 404 悄悄咽掉。
    if (!isDisclosed(r)) throw new ThreadNotVisibleError();
    return r.payload;
  };
}

export async function readSession(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
): Promise<ResearchSessionRow> {
  const open = await openVisible(deps, actor);
  return open(await deps.research.ensureSession(actor.orgId, actor.threadId));
}

export async function addMaterials(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
  items: readonly { source: string; label: string }[],
): Promise<ResearchSessionRow> {
  const open = await openVisible(deps, actor);
  return open(await deps.research.addMaterials(actor.orgId, actor.threadId, items as never));
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
  const open = await openVisible(deps, actor);
  const afterVerdict = open(await deps.research.setMaterialVerdict(
    actor.orgId, actor.threadId, materialId, verdict, note,
  ));
  if (verdict !== "missing" && verdict !== "wrong") return afterVerdict;
  return open(await deps.research.bumpMaterialAttempts(actor.orgId, actor.threadId, materialId));
}

export async function passGateGuarded(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
  gate: C.ResearchGateName,
): Promise<ResearchSessionRow> {
  const open = await openVisible(deps, actor);
  return passGate(deps, open, actor.orgId, actor.threadId, gate);
}

export async function advancePhaseGuarded(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
  to: C.ResearchPhaseName,
): Promise<ResearchSessionRow> {
  const open = await openVisible(deps, actor);
  return advancePhase(deps, open, actor.orgId, actor.threadId, to);
}

/** 审计读回——界面上「这条线程发生过哪些推进与拒绝」那一栏。 */
export async function readAudit(deps: ResearchOpsDeps, actor: ResearchActor, limit = 50) {
  const open = await openVisible(deps, actor);
  return open(await deps.research.listAudit(actor.orgId, actor.threadId, limit));
}

/* ── 第三步：预测与回填 ─────────────────────────────────────────── */

export async function listPredictions(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
): Promise<readonly ResearchPredictionRow[]> {
  const open = await openVisible(deps, actor);
  return open(await deps.research.listPredictions(actor.orgId, actor.threadId));
}

/**
 * 登记预测。**挂在当前已发布版本上**——预测是"第 N 版图谱当时是怎么说的"，
 * 不挂版本号就答不出三个月后那个问题。
 *
 * 还没发布过任何版本时拒绝：那意味着这些"预测"没有对应的结论，无从验证。
 */
export async function addPredictions(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
  statements: readonly string[],
): Promise<readonly ResearchPredictionRow[]> {
  const open = await openVisible(deps, actor);
  const session = open(await deps.research.ensureSession(actor.orgId, actor.threadId));
  const version = session.lineage.publishedGraphVersion;
  if (version === 0) throw new ResearchGateRefusedError("NO_PREDICTIONS", session.phase);
  return open(await deps.research.addPredictions(actor.orgId, actor.threadId, version, statements));
}

/**
 * 回填一条预测。
 *
 * 「未兑现必须给根因」这条规则在 `domain/verification.ts`，这里只负责执行它并留痕——
 * 与门的处理同一形状：**被拒也写审计**，因为"有人试图不写根因就把复盘结掉"
 * 本身就是一条值得留下的记录。
 */
export async function fillPrediction(
  deps: ResearchOpsDeps,
  actor: ResearchActor,
  predictionId: string,
  actual: string,
  verdict: C.PredictionVerdictName,
  rootCause: C.RootCauseName | null,
): Promise<readonly ResearchPredictionRow[]> {
  const open = await openVisible(deps, actor);
  const session = open(await deps.research.ensureSession(actor.orgId, actor.threadId));
  const decision = decideFill(verdict, rootCause);

  await deps.research.appendAudit({
    orgId: actor.orgId,
    threadId: actor.threadId,
    actorKind: "human",
    action: `fill:${predictionId}`,
    fromPhase: session.phase,
    outcome: decision.ok ? "allowed" : "refused",
    refusal: decision.ok ? null : decision.refusal,
  });
  if (!decision.ok) throw new ResearchGateRefusedError(decision.refusal, session.phase);

  return open(await deps.research.fillPrediction(
    actor.orgId, actor.threadId, predictionId, actual, verdict, rootCause,
  ));
}
