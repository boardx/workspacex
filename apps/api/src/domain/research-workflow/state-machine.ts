/**
 * 研判工作流状态机 —— 活动图那三道人工硬门的**执行者**。
 *
 * ## 为什么这是一个纯函数文件
 *
 * 门必须是**服务端校验**，不能是提示词里的请求。而"校验"要可信，它自己就得可测——
 * 所以这里不碰数据库、不碰时钟、不碰随机数：输入一个会话快照 + 一个动作，输出允许或
 * 拒绝。测试因此可以穷举每一个 (阶段 × 动作) 组合，而不是挑几个顺手的路径试试。
 *
 * 这一点是被上一轮的教训逼出来的：`wx_canvas_update` 那次，我验证的是"它在工具表里"
 * （一个静态痕迹），而不是"它在真实调用路径上能不能过"。纯函数状态机让"能不能过"
 * 变成一句断言，而不是一次乐观的阅读。
 *
 * ## 这里判什么、不判什么
 *
 * **判**：阶段合法性、门的前置条件、材料三态是否已逐条判完、重采次数上限。
 * **不判**：谁有权限点这道门（那是 application 层读线程可见性的事）、
 * 时间与 id 从哪来（由调用方注入）。领域层只回答「这个推进在业务上成不成立」。
 */
import { researchWorkflow as C } from "@repo/contracts";

export type PhaseName = C.ResearchPhaseName;
export type GateName = C.ResearchGateName;
export type RefusalName = C.ResearchRefusalName;

/** 状态机看得见的会话快照。刻意只取判断需要的字段，不是整行。 */
export interface SessionSnapshot {
  readonly phase: PhaseName;
  readonly materials: readonly { readonly verdict: C.MaterialVerdictName; readonly attempts: number }[];
  readonly lineage: {
    readonly materialBatchId: string | null;
    readonly fieldSchemeVersion: number;
    readonly logicVersion: number;
    readonly publishedGraphVersion: number;
  };
}

export type Decision =
  | { readonly ok: true; readonly nextPhase: PhaseName }
  | { readonly ok: false; readonly refusal: RefusalName };

const deny = (refusal: RefusalName): Decision => ({ ok: false, refusal });
const allow = (nextPhase: PhaseName): Decision => ({ ok: true, nextPhase });

/**
 * 每道门：从哪个阶段过、过完到哪个阶段。
 *
 * 这张表就是「门」的定义本身。一道门若不在这里，它就不存在——不会有第二处地方
 * 偷偷允许某个阶段跳过去，因为 {@link decideGate} 只读这张表。
 */
const GATE_TRANSITIONS: Readonly<Record<GateName, { readonly from: PhaseName; readonly to: PhaseName }>> = {
  materials: { from: "materials_review", to: "materials_approved" },
  fields: { from: "fields_pending", to: "logic_pending" },
  logic: { from: "logic_pending", to: "generating" },
  reasoning: { from: "graph_review", to: "graph_published" },
  plan: { from: "plan_review", to: "graph_published" },
};

/**
 * Agent 侧可以自己推进的阶段转移（不经过人）。
 *
 * ⚠ 注意这张表里**没有任何一条**通向 `materials_approved` / `graph_published`——
 * 那两个阶段只能由 {@link decideGate} 到达。这是整个设计的要害：
 * Agent 无论怎么推进，都到不了"已通过"和"已发布"，除非有人真的点了门。
 *
 * 需求文档那句「不得自动进入下一步，也不得自动发布图谱新版本」，
 * 在系统里为真，靠的就是这张表的**缺项**。
 */
const AGENT_TRANSITIONS: Readonly<Record<PhaseName, readonly PhaseName[]>> = {
  empty: ["collecting"],
  collecting: ["materials_review"],
  // 门①被打回：行研人员标了缺失/错误 → 仅对标注项重新采集
  materials_review: ["collecting"],
  materials_approved: ["fields_pending"],
  fields_pending: [],
  logic_pending: [],
  generating: ["graph_review"],
  // 门②审不过可以回到采集补材料；也可以就地出新草稿（自环）
  graph_review: ["collecting", "graph_review"],
  graph_published: ["awaiting_verification"],
  awaiting_verification: ["backfilling"],
  backfilling: ["plan_review"],
  // 门③不采纳 → 回去重新分析
  plan_review: ["backfilling"],
};

/** 材料是否已逐条判完——门①的实质判据。 */
function allMaterialsResolved(s: SessionSnapshot): boolean {
  return s.materials.length > 0 && s.materials.every((m) => m.verdict === "accepted");
}

/**
 * 能不能过这道门。
 *
 * 门①额外要求材料**逐条**判定为 accepted：否则"通过"这个事实没有内容——
 * 一批还有 pending 的材料被宣布合格，等于门没审。
 */
export function decideGate(session: SessionSnapshot, gate: GateName): Decision {
  const t = GATE_TRANSITIONS[gate];
  if (session.phase !== t.from) return deny("PHASE_MISMATCH");

  if (gate === "materials") {
    if (session.materials.length === 0) return deny("NO_MATERIALS");
    if (!allMaterialsResolved(session)) return deny("MATERIALS_UNRESOLVED");
  }

  // 门②/门③ 审的是结论，而结论必须挂在一批过了门①的材料上。
  // 没有 materialBatchId 就意味着没人审过材料——此时发布图谱正是文档禁止的那件事。
  if ((gate === "reasoning" || gate === "plan") && session.lineage.materialBatchId === null) {
    return deny("GATE_NOT_PASSED");
  }

  return allow(t.to);
}

/**
 * Agent 侧推进。
 *
 * 任何不在 {@link AGENT_TRANSITIONS} 里的转移一律拒绝，包括"看起来合理"的那些——
 * 比如 generating → graph_published（直接发布）。合理与否不由调用方主张，由这张表决定。
 */
export function decideAdvance(session: SessionSnapshot, to: PhaseName): Decision {
  const allowed = AGENT_TRANSITIONS[session.phase];
  if (!allowed.includes(to)) {
    // 目标是两个"人工才能到达"的阶段之一 ⇒ 这是一次跳门尝试，理由要说准。
    if (to === "materials_approved" || to === "graph_published") return deny("GATE_NOT_PASSED");
    return deny("PHASE_MISMATCH");
  }
  if (to === "materials_review" && session.materials.length === 0) return deny("NO_MATERIALS");
  return allow(to);
}

/**
 * 能不能对这条材料再采一次。活动图：两次失败即停。
 * 上限值来自契约常量，不在这里重写一个数字。
 */
export function decideRecollect(attempts: number): Decision {
  if (attempts >= C.MAX_COLLECTION_ATTEMPTS) return deny("ATTEMPTS_EXHAUSTED");
  return allow("collecting");
}

/**
 * 过门后血缘怎么变。**只在这里算**——否则"版本号什么时候加一"会散落在多个用例里，
 * 正是 AGENTS.md 点名的那种漂移形状。
 */
export function lineageAfterGate(
  lineage: SessionSnapshot["lineage"],
  gate: GateName,
  newBatchId: string,
): SessionSnapshot["lineage"] {
  switch (gate) {
    // 门①通过 ⇒ 这批材料被钉住，成为后续一切结论的血缘起点
    case "materials":
      return { ...lineage, materialBatchId: newBatchId };
    case "fields":
      return { ...lineage, fieldSchemeVersion: lineage.fieldSchemeVersion + 1 };
    case "logic":
      return { ...lineage, logicVersion: lineage.logicVersion + 1 };
    // 门②/门③ 通过 ⇒ 发布一个新图谱版本（门③是"采纳调整方案"，同样产生新版本）
    case "reasoning":
    case "plan":
      return { ...lineage, publishedGraphVersion: lineage.publishedGraphVersion + 1 };
  }
}

/** 当前阶段正在等哪道门；不等人时为 null。界面的「现在轮到谁」直接读它。 */
export function pendingGate(phase: PhaseName): GateName | null {
  const entry = Object.entries(GATE_TRANSITIONS).find(([, t]) => t.from === phase);
  return entry ? (entry[0] as GateName) : null;
}
