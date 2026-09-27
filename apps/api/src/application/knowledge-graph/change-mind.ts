/**
 * Issue #4361（phase-18 S4）——「我改主意了，改成 Y」：在这一轮开始时，确定地走一遍 R8（#4290）的改口取代。
 *
 * R8 本来接在抽取后面：模型把这句话抽成一条「决定」，`detectSupersedes` 再判它是不是在改掉本人的旧决定。于是
 * 用户明明白白说了改口，改不改却取决于抽取模型有没有把这句话读成一条带改口信号的决定（「我改主意了，改成…」常被
 * 抽成不带「改成」的新说法，R8 就认不出来）。这里不再等模型：
 *
 *   1. 范围闸门（`kg_memory_manage_ok`）：只在请求者本人的个人线程、他本人说的这条消息上做——项目会话 / 别人的
 *      记忆一概不碰（人类决定 #4361「只作用于本人个人空间」）；
 *   2. 先用 R8 的 `planSupersedes` 对本人长期记忆里的活决定**预判**（规则、白名单只在 decision-supersede.ts 一处）：
 *      一对都没有（没说中哪条 / 并列补充 / 收回 / 反对 / 问句 …）⇒ **什么都不写**，这一轮照常回答；
 *   3. 有 ⇒ 把这句改口当作这条消息的抽取结果交执行器（与抽取同一个幂等键：消息 id + `KG_EXTRACTION_PIPELINE_VERSION`，
 *      之后抽取任务再来处理这条消息会被判成重复，不会多出第二条），再原样跑 R8 的 `detectSupersedes`（数据库里的候选与复核
 *      逐字不变：高把握 explicit / 对齐的 same_kind ⇒ 自动取代 + 回答下「已用〈新〉取代〈旧〉 · 撤销」；frame_only ⇒
 *      「用〈新〉取代〈旧〉？」卡，两条都照常生效直到人选），最后把这条新决定记进本人长期记忆（#4283 同一个
 *      `kg_auto_copy_decision`，仍是「AI 记下的」、可撤销；同一句已有 ⇒ 合并）。
 *
 * 为什么这不是「没有人点就写」：R8 的人类决定（2026-09-26）本来就是「明确改口 + 高把握 ⇒ 自动、可撤销」，这里只是
 * 不让它取决于抽取模型；低把握永远是卡。Agent 工具这条路（wx_remember 一族）仍然只开卡。
 * 失败只记日志、这一轮照常回答（与召回同一条降级纪律）。
 */
import type { OrgId } from "../../domain/org-id";
import { planSupersedes, type LiveDecision } from "../../domain/knowledge-graph/decision-supersede";
import { buildExtractionBatch, normalizeName } from "../../domain/knowledge-graph/extraction";
import { dedupAgainstPersonal } from "../../domain/knowledge-graph/promotion";
import { applyOntologyBatch } from "./apply-ontology-batch";
import { detectSupersedes } from "./detect-conflicts";
import type { RecallClaim } from "../../domain/knowledge-graph/recall";
import {
  KgAutoCopyRejected, type KgAutoCopyPort, type KgConflictPort, type MemoryCardPort, type OntologyStorePort,
} from "./ports";

/** 「改主意」这条路要的端口：执行器、R8 的取代、#4283 的自动记入（都是抽取任务已经在用的那几个）。 */
export interface ChangeMindPorts {
  readonly store: OntologyStorePort;
  readonly conflicts: KgConflictPort;
  readonly autoCopy: KgAutoCopyPort;
  readonly newId: (prefix: "obj" | "clm" | "edg" | "act") => string;
}

/** 预判用的占位 id（不会落表）。 */
const PENDING = "__change_of_mind__";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * 返回给模型的一句说明（放在上下文里）；什么都没做 ⇒ null。
 * `statement` 是 memory-intent.ts 从这条消息里取出的那句改口（原话的一段）。
 */
export async function changeOfMindFor(
  cards: MemoryCardPort,
  ports: ChangeMindPorts,
  input: {
    readonly orgId: OrgId; readonly userId: string; readonly threadId: string;
    readonly messageId: string; readonly text: string; readonly statement: string;
  },
  /** 调用方（recall-knowledge.ts memoryCardFor）按这一轮的发起人与会话读好的召回候选。 */
  candidates: () => Promise<readonly RecallClaim[]>,
): Promise<string | null> {
  const turn = { threadId: input.threadId, messageId: input.messageId, requesterUserId: input.userId };
  if (!(await cards.personalTurn(input.orgId, turn))) return null;

  // 本人长期记忆里还活着的决定（L1；本人别的个人线程里的会话结论不在 R8 的候选里，同 kg_supersede_candidates）
  const claims = await candidates();
  const live: LiveDecision[] = claims
    .filter((c) => c.scope === "personal" && c.originThreadId === undefined && c.kind === "decision")
    .map((c) => ({ id: c.id, kind: "decision", statement: c.statement, authorId: input.userId, scope: "personal" }));
  if (live.length === 0) return null;
  const plan = planSupersedes([{ id: PENDING, kind: "decision", statement: input.statement, authorId: input.userId }], live);
  const pair = plan.supersedes[0] ?? plan.prompts[0];
  if (pair === undefined) return null;
  const older = live.find((o) => o.id === pair.olderClaimId)!;
  const auto = plan.supersedes.length > 0;

  const batch = buildExtractionBatch({
    threadId: input.threadId, messageId: input.messageId, messageBody: input.text, known: [], newId: ports.newId,
    result: { entities: [], claims: [{ statement: input.statement, kind: "decision", confidence: 1, about: [], decidedBy: null, quote: input.statement }] },
  });
  if (batch === null) return null;
  const applied = await applyOntologyBatch(ports.store, input.orgId, null, batch);
  if (applied.outcome === "rejected") return null;
  const job = { orgId: input.orgId, threadId: input.threadId, messageId: input.messageId };
  const opened = await detectSupersedes({ conflicts: ports.conflicts, newId: ports.newId }, job);
  await copyNewDecision(ports, job, input.statement);

  const newer = oneLine(input.statement);
  const old = oneLine(older.statement);
  if (opened === 0) {
    // 数据库复核没开出任何东西（这条消息刚被抽取任务处理过、同一条新决定已经取代 / 问过）：不猜发生了什么。
    return `【记忆卡片】用户在改口：「${newer}」。如果回答下方出现了取代提示或卡片，照它说；不要自己说已经改好了。`;
  }
  return auto
    ? `【记忆卡片】用户改口了：系统已用「${newer}」取代了长期记忆里的「${old}」，回答下方有一行说明和「撤销」。之后按新的说法回答，不要再按旧的说。`
    : `【记忆卡片】用户可能在改口：回答下方有一张卡问要不要用「${newer}」取代「${old}」。用户选之前两条都还在，不要说已经改好了，可以提醒用户点卡片。`;
}

/** 这条消息刚写下的新决定记进本人长期记忆（#4283 同一条路；同一句已有 ⇒ 合并）。被数据库拒绝只跳过。 */
async function copyNewDecision(
  ports: ChangeMindPorts,
  job: { readonly orgId: OrgId; readonly threadId: string; readonly messageId: string },
  statement: string,
): Promise<void> {
  const c = await ports.autoCopy.candidates(job.orgId, job.threadId, job.messageId);
  if (c.author === null) return;
  const key = normalizeName(statement);
  for (const claim of c.fresh.filter((f) => normalizeName(f.statement) === key)) {
    const verdict = dedupAgainstPersonal(claim.statement, c.personal);
    try {
      await ports.autoCopy.copy(job.orgId, {
        actionId: ports.newId("act"), threadId: job.threadId, messageId: job.messageId, claimId: claim.id,
        mode: verdict.kind === "duplicate" ? "merge" : "new", ...(verdict.kind === "duplicate" ? { targetClaimId: verdict.existingId } : {}),
      });
    } catch (e) {
      if (!(e instanceof KgAutoCopyRejected)) throw e;
    }
  }
}
