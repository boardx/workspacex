/**
 * 研判工作流契约 —— Team3「前沿赛道技术路线研判」活动图的等价形式。
 *
 * ## 这个契约束存在的理由
 *
 * 需求文档 §4 的活动图下写着一句约束（原文）：
 *
 * > 三次人工确认是硬门：① 材料是否符合要求 ② 推理链是否成立 ③ 验证回填后的调整方案是否采纳。
 * > **任何一门不过，Agent 不得自动进入下一步，也不得自动发布图谱新版本。**
 *
 * 在本文件出现之前，这句话在系统里**是假的**：整条流程只存在于 Agent 的 instructions 里，
 * 而 instructions 是**请求**不是约束——模型可以不照做，且没有任何东西会发现它没照做。
 * 一个没人审过的材料批次可以直接变成一张已发布的图谱，不触发任何红灯。
 *
 * 状态与门在这里声明**一次**，领域状态机、仓储、控制器、前端阶段条全部从这里派生。
 * 这条纪律是被迫的：本项目已五次因「同一事实声明在两处」而漂移（见 AGENTS.md）。
 * 状态名若在前端再抄一份，两边迟早说不上话。
 */
import { z } from "zod";

/* ── 状态 ────────────────────────────────────────────────────────── */

/**
 * 研判会话的阶段。顺序即活动图从上到下的推进方向。
 *
 * ⚠ 值一旦落库就不可重命名（库里存的是这些字符串）。要改只能加新值 + 迁移。
 */
export const RESEARCH_PHASES = [
  "empty",                 // 空研究：还没有任何材料
  "collecting",            // 采集中：材料在进来（含"仅对标注项重新采集"的回合）
  "materials_review",      // 材料待审：Agent 已整理出可逐条判定的清单，等门①
  "materials_approved",    // 材料已通过：门①过了，这批材料成为后续结论的血缘
  "fields_pending",        // 字段待确认：Agent 提出节点字段与 BOM 口径
  "logic_pending",         // 逻辑待确认：行研人员逐项确认判断逻辑
  "generating",            // 生成中：Agent 在产出图谱与节点详情
  "graph_review",          // 图谱待审：草稿版本已出，等门②
  "graph_published",       // 图谱已发布：门②过了
  "awaiting_verification", // 等待验证：已登记 N 个月后的提醒
  "backfilling",           // 回填中：到期，正在比对预测与实际
  "plan_review",           // 方案待审：调整方案已出，等门③
] as const;
export const ResearchPhase = z.enum(RESEARCH_PHASES);
export type ResearchPhaseName = (typeof RESEARCH_PHASES)[number];

/* ── 门 ──────────────────────────────────────────────────────────── */

/**
 * 人工确认门。
 *
 * 需求文档点名的**硬门**是三道（materials / reasoning / plan）——它们把流程切成三步。
 * `fields` 与 `logic` 是活动图里同样存在的两次确认，但文档没有把它们列为硬门：
 * 它们约束的是"按哪版口径算"，而不是"能不能进入下一步"。
 * 这个区分写在 {@link HARD_GATES} 里，不靠读者自己记。
 */
export const RESEARCH_GATES = ["materials", "fields", "logic", "reasoning", "plan"] as const;
export const ResearchGate = z.enum(RESEARCH_GATES);
export type ResearchGateName = (typeof RESEARCH_GATES)[number];

/** 需求文档原文点名的三道硬门。 */
export const HARD_GATES = ["materials", "reasoning", "plan"] as const satisfies readonly ResearchGateName[];

/** 每道门的中文名——界面与拒绝理由都用它，不在别处再写一遍。 */
export const GATE_LABELS: Readonly<Record<ResearchGateName, string>> = {
  materials: "材料是否符合要求",
  fields: "节点字段与口径是否确认",
  logic: "判断逻辑是否确认",
  reasoning: "推理链是否成立",
  plan: "调整方案是否采纳",
};

/**
 * 每道门：从哪个阶段过、过完到哪个阶段。**门的定义本身**。
 *
 * 放在契约而不是后端领域层，是因为前端也必须知道"当前阶段在等哪道门"才能渲染
 * 阶段条。此前它在前端被抄了一份——两处声明同一事实，正是本项目已栽五次的形状。
 * 现在只有这一份：后端 `state-machine.ts` 与前端 `research-phase-bar.tsx` 都读它。
 *
 * ⚠ 一道门若不在这张表里，它就不存在——`decideGate` 只读这张表。
 */
export const GATE_TRANSITIONS: Readonly<
  Record<ResearchGateName, { readonly from: ResearchPhaseName; readonly to: ResearchPhaseName }>
> = {
  materials: { from: "materials_review", to: "materials_approved" },
  fields: { from: "fields_pending", to: "logic_pending" },
  logic: { from: "logic_pending", to: "generating" },
  reasoning: { from: "graph_review", to: "graph_published" },
  plan: { from: "plan_review", to: "graph_published" },
};

/** 当前阶段正在等哪道门；不等人时为 null。前后端都用它，不各判一次。 */
export function pendingGate(phase: ResearchPhaseName): ResearchGateName | null {
  const entry = (Object.entries(GATE_TRANSITIONS) as [ResearchGateName, { from: ResearchPhaseName }][])
    .find(([, t]) => t.from === phase);
  return entry ? entry[0] : null;
}

/** 每个阶段的中文名——阶段条直接渲染它。 */
export const PHASE_LABELS: Readonly<Record<ResearchPhaseName, string>> = {
  empty: "未开始",
  collecting: "采集中",
  materials_review: "材料待审",
  materials_approved: "材料已通过",
  fields_pending: "字段待确认",
  logic_pending: "逻辑待确认",
  generating: "生成中",
  graph_review: "图谱待审",
  graph_published: "图谱已发布",
  awaiting_verification: "等待验证",
  backfilling: "回填中",
  plan_review: "方案待审",
};

/* ── 材料 ────────────────────────────────────────────────────────── */

/**
 * 材料的三态。门①审的就是这个——**逐条**，不是整批一句"看着行"。
 * `missing`/`wrong` 是活动图里「标注缺失或错误点」的落点，它决定重新采集的范围。
 */
export const MATERIAL_VERDICTS = ["pending", "accepted", "missing", "wrong"] as const;
export const MaterialVerdict = z.enum(MATERIAL_VERDICTS);
export type MaterialVerdictName = (typeof MATERIAL_VERDICTS)[number];

/** 材料来源。`agent_search` 目前不会产生（Agent 不主动搜），保留是为了它出现时有地方放。 */
export const MATERIAL_SOURCES = ["paste", "upload", "url", "transcript", "agent_search"] as const;
export const MaterialSource = z.enum(MATERIAL_SOURCES);

/**
 * 同一条材料的重新采集上限。活动图：两次失败即停，不无限重试。
 * 数值只在这里声明——后端计数与前端提示读的是同一个常量。
 */
export const MAX_COLLECTION_ATTEMPTS = 2;

export const ResearchMaterial = z.object({
  id: z.string().uuid(),
  source: MaterialSource,
  /** 人看得懂的标题（文件名 / URL / 粘贴片段首行）。 */
  label: z.string().min(1).max(500),
  verdict: MaterialVerdict,
  /** 门①上行研人员写的意见；`missing`/`wrong` 时它就是重新采集的依据。 */
  note: z.string().max(2000).nullable(),
  attempts: z.number().int().min(0),
  createdAt: z.string().datetime(),
});

/* ── 会话 ────────────────────────────────────────────────────────── */

/**
 * 血缘：一个结论必须能回答「基于哪一批材料、哪版口径、哪版逻辑」。
 *
 * 这三项不是装饰。测试 C（三个月后复盘定位根因）的全部可行性都押在它们上面：
 * 没有它们，三个月后问「当时为什么这么判」只能靠人回忆。
 */
export const ResearchLineage = z.object({
  /** 门①通过的那一刻，这批材料的指纹。之后再加材料会开新批次。 */
  materialBatchId: z.string().uuid().nullable(),
  fieldSchemeVersion: z.number().int().min(0),
  logicVersion: z.number().int().min(0),
  publishedGraphVersion: z.number().int().min(0),
});

export const ResearchSession = z.object({
  threadId: z.string().uuid(),
  phase: ResearchPhase,
  lineage: ResearchLineage,
  materials: z.array(ResearchMaterial),
  /** 到期验证时间；`awaiting_verification` 阶段必有。 */
  verifyDueAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});

/* ── 第三步：验证回填 ──────────────────────────────────────────── */

/**
 * 一条预测的兑现判定。
 *
 * 三档而不是两档（对/错）：产业判断很少非黑即白，"方向对但时点晚了一年"
 * 既不是命中也不是落空。把它硬压成二值，复盘时就只剩下"我们大致还行"这种
 * 无法据以改进的结论。
 */
export const PREDICTION_VERDICTS = ["matched", "partial", "missed"] as const;
export const PredictionVerdict = z.enum(PREDICTION_VERDICTS);
export type PredictionVerdictName = (typeof PREDICTION_VERDICTS)[number];

export const PREDICTION_VERDICT_LABELS: Readonly<Record<PredictionVerdictName, string>> = {
  matched: "兑现",
  partial: "部分兑现",
  missed: "未兑现",
};

/**
 * 根因分类 —— 需求文档第三步的核心产出。
 *
 * **框架性**：判断逻辑本身错了（比如"国产化率高就等于供应安全"这条推理站不住）。
 * **执行性**：逻辑没问题，这一次没做到位（比如漏采了某个环节的材料）。
 *
 * 两者对应完全不同的调整动作：前者要改判断逻辑模板（logicVersion+1），
 * 后者只要改这次的流程执行。混成一句"没做好"就什么都改不了——
 * 这个区分是复盘能不能产生改进的分水岭。
 */
export const ROOT_CAUSES = ["framework", "execution"] as const;
export const RootCause = z.enum(ROOT_CAUSES);
export type RootCauseName = (typeof ROOT_CAUSES)[number];

export const ROOT_CAUSE_LABELS: Readonly<Record<RootCauseName, string>> = {
  framework: "框架性——判断逻辑本身要改",
  execution: "执行性——逻辑没问题，这次执行没到位",
};

export const ResearchPrediction = z.object({
  id: z.string().uuid(),
  graphVersion: z.number().int().min(1),
  statement: z.string().min(1).max(1000),
  actual: z.string().max(1000).nullable(),
  verdict: PredictionVerdict.nullable(),
  rootCause: RootCause.nullable(),
  createdAt: z.string().datetime(),
  filledAt: z.string().datetime().nullable(),
});

/**
 * 登记预测。**必须在发布时做**——事后凭记忆补写的"当初的预测"，是用已知结果
 * 反推出来的，那不是验证，是自我确认。
 */
export const addResearchPredictions = {
  in: z.object({
    threadId: z.string().uuid(),
    statements: z.array(z.string().min(1).max(1000)).min(1).max(20),
  }),
  out: z.array(ResearchPrediction),
};

/** 回填一条预测的实际结果。 */
export const fillResearchPrediction = {
  in: z.object({
    threadId: z.string().uuid(),
    predictionId: z.string().uuid(),
    actual: z.string().min(1).max(1000),
    verdict: PredictionVerdict,
    /** 未兑现/部分兑现时必须给根因；兑现时可空。由 `fill-prediction.ts` 校验。 */
    rootCause: RootCause.nullable(),
  }),
  out: z.array(ResearchPrediction),
};

/* ── 拒绝理由 ────────────────────────────────────────────────────── */

/**
 * 越权推进被拒时的原因码。
 *
 * 之所以要成为契约而不是随手 throw 一句中文：这些码要出现在审计行里，
 * 三个月后复盘要靠它们统计「Agent 试图跳门多少次」。一句自由文本统计不了。
 */
export const RESEARCH_REFUSALS = [
  "PHASE_MISMATCH",        // 当前阶段不允许这个动作
  "GATE_NOT_PASSED",       // 前置门没过
  "MATERIALS_UNRESOLVED",  // 还有材料是 pending / missing / wrong
  "ATTEMPTS_EXHAUSTED",    // 同一条材料重采已达上限
  "NO_MATERIALS",          // 一条材料都没有就要往下走
  "ROOT_CAUSE_REQUIRED",   // 未兑现/部分兑现却没给根因分类
  "NO_PREDICTIONS",        // 发布过图谱却一条预测都没登记
] as const;
export const ResearchRefusal = z.enum(RESEARCH_REFUSALS);
export type ResearchRefusalName = (typeof RESEARCH_REFUSALS)[number];

export const REFUSAL_LABELS: Readonly<Record<ResearchRefusalName, string>> = {
  PHASE_MISMATCH: "当前阶段不允许这个动作",
  GATE_NOT_PASSED: "前一道人工确认门还没通过",
  MATERIALS_UNRESOLVED: "还有材料没有逐条判定完",
  ATTEMPTS_EXHAUSTED: "这条材料的重新采集次数已用尽",
  NO_MATERIALS: "还没有任何材料",
  ROOT_CAUSE_REQUIRED: "没兑现的预测必须说清是框架性还是执行性问题",
  NO_PREDICTIONS: "这一版图谱还没有登记任何预测",
};

/* ── 端点 ────────────────────────────────────────────────────────── */

export const getResearchSession = {
  out: ResearchSession,
};

export const addResearchMaterials = {
  in: z.object({
    threadId: z.string().uuid(),
    materials: z.array(z.object({ source: MaterialSource, label: z.string().min(1).max(500) })).min(1).max(50),
  }),
  out: ResearchSession,
};

export const reviewResearchMaterial = {
  in: z.object({
    threadId: z.string().uuid(),
    materialId: z.string().uuid(),
    verdict: MaterialVerdict,
    note: z.string().max(2000).nullable(),
  }),
  out: ResearchSession,
};

/**
 * 过一道门。**这是本契约束唯一会改变阶段的写入口**——没有第二个"直接设置阶段"的端点，
 * 因为那等于把门做成装饰品。
 */
export const passResearchGate = {
  in: z.object({
    threadId: z.string().uuid(),
    gate: ResearchGate,
  }),
  out: ResearchSession,
};

/** 提交阶段推进（Agent 侧动作，如"材料整理完了请审"）。同样受状态机校验。 */
export const advanceResearchPhase = {
  in: z.object({
    threadId: z.string().uuid(),
    to: ResearchPhase,
  }),
  out: ResearchSession,
};
