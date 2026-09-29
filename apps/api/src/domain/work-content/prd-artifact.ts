/**
 * W029 PRD 工件装配（CT06；05-content-lines.md R3 步骤 6；契约 `work-content.PrdArtifact`）。
 *
 * 输入是各阶段 Skill 的结构化产出（S064 问题框定 / S068 优先级 / S067 PRD 草稿与修订 / S162 指标），
 * 输出经契约 schema 校验的 `PrdArtifact`：问题节逐字取自 S064（带证据引用，没有证据即拒绝装配，
 * 不编造结论），需求优先级取自 S068，指标取自 S162。`digest` = 规范化 JSON 的 sha256。
 *
 * 纯函数、无 IO。
 */
import { createHash } from "node:crypto";
import { PrdArtifact } from "@repo/contracts/work-content";
import { z } from "zod";

export type PrdArtifactT = z.infer<typeof PrdArtifact>;

export interface PrdStageOutputs {
  /** S064：问题框定。 */
  frame: { problemStatement: string; evidenceRefs: string[]; confidence: "low" | "medium" | "high" };
  /** S068：需求（解法）优先级，按 id 对齐 S067 需求。 */
  priorities: { id: string; priority: string }[];
  /** S067：最终（revise 后）PRD 正文。 */
  prd: { title: string; requirements: { id: string; text: string }[] };
  /** S162：指标定义。 */
  metrics: { name: string; definition: string }[];
}

export class PrdAssemblyError extends Error {
  constructor(readonly field: string) {
    super(`prd assembly failed: ${field}`);
    this.name = "PrdAssemblyError";
  }
}

export function assemblePrdArtifact(outputs: PrdStageOutputs): PrdArtifactT {
  if (outputs.frame.evidenceRefs.length === 0) throw new PrdAssemblyError("problem.evidenceRefs");
  const priorityOf = new Map(outputs.priorities.map((p) => [p.id, p.priority]));
  const requirements = outputs.prd.requirements.map((r) => {
    const priority = priorityOf.get(r.id);
    if (!priority) throw new PrdAssemblyError(`requirements.${r.id}.priority`);
    return { id: r.id, text: r.text, priority };
  });
  const body = {
    kind: "prd" as const,
    title: outputs.prd.title,
    problem: {
      claimId: "problem",
      text: outputs.frame.problemStatement,
      evidenceRefs: [...outputs.frame.evidenceRefs],
      confidence: outputs.frame.confidence,
    },
    requirements,
    metrics: outputs.metrics.map((m) => ({ name: m.name, definition: m.definition })),
  };
  const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const parsed = PrdArtifact.safeParse({ ...body, digest });
  if (!parsed.success) throw new PrdAssemblyError(parsed.error.issues[0]?.path.join(".") || "prd");
  return parsed.data;
}

/** 各 Skill 阶段产出（stage content 的 `output` 字段）的最小形状；不符即装配失败，不猜。 */
const FrameOut = z.object({ problemStatement: z.string().min(1), evidenceRefs: z.array(z.string().min(1)), confidence: z.enum(["low", "medium", "high"]) });
const PriorityOut = z.object({ ranking: z.array(z.object({ id: z.string().min(1), priority: z.string().min(1) })) });
const PrdOut = z.object({ title: z.string().min(1), requirements: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })) });
const KpiOut = z.object({ kpis: z.array(z.object({ name: z.string().min(1), definition: z.string().min(1) })) });

function pick<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new PrdAssemblyError(field);
  return r.data;
}

/**
 * W029 阶段产出 → 装配输入：问题 = frame(S064)，优先级 = prioritize(S068)，正文 = revise(S067)
 * （revise 缺席时退回 draft，§5 阶段 12「diff 越界 → revised(=草稿版)」），指标 = kpi(S162)。
 */
export function prdStageOutputsFrom(skillOutputs: Readonly<Record<string, unknown>>): PrdStageOutputs {
  const frame = pick(FrameOut, skillOutputs.frame, "frame");
  const priorities = pick(PriorityOut, skillOutputs.prioritize, "prioritize").ranking;
  const prd = pick(PrdOut, skillOutputs.revise ?? skillOutputs.draft, "revise");
  const metrics = pick(KpiOut, skillOutputs.kpi, "kpi").kpis;
  return { frame, priorities, prd, metrics };
}
