/**
 * Work 内容线的 Workflow 定义模块（Phase 20 CT08；契约束 `work-content` domain.md
 * 「WorkflowDefinition 模块」行、I-C1/I-C2/I-C4；ADR-118 第 2/9 条）。
 *
 * 每个 Workflow 一个代码模块，导出 `{workflowId, key, version, stages, gates, effects}`；
 * `skillPins` 不单独手写，而是**从阶段表派生**（阶段内的 Skill 引用即 pin），避免同一事实声明两处。
 * 组合表（哪个 Workflow 用哪些 Skill）的唯一事实源是 `WORKFLOW-SKILL-MATRIX.md`，由测试/lint 核对（V8）。
 *
 * 纯函数、无 IO：注册 = 形状校验 + 发布前置校验（复用 WF01 `validateDefinitionForPublish`）+ pin 解析，
 * 每个 Workflow 独立结算，一个失败只把它自己标为 `unavailable`（I-C4）。
 */
import type { z } from "zod";
import {
  WorkflowDefinitionVersionInput,
  type WorkflowStageDefinition,
} from "@repo/contracts/workflow-runtime";
import type { WorkflowCatalogItem, WorkContentLine } from "@repo/contracts/work-content";
import { validateDefinitionForPublish, type SkillRefResolver } from "../workflow/definition-version";

export type WorkflowCatalogItemView = z.infer<typeof WorkflowCatalogItem>;
type SkillPin = WorkflowCatalogItemView["skillPins"][number];

/** 阶段定义 = runtime 契约阶段 + 本线的编排细节（不进 runtime 元数据，由图工厂消费）。 */
export interface WorkContentStage extends WorkflowStageDefinition {
  /** 逐项扇出的并发上限（W011 enrich：逐公司并发 5）。 */
  fanOutConcurrency?: number;
  /** 同组阶段逻辑上并行（W018 gathering：S021 ∥ S009）；线性图中按声明顺序执行。 */
  parallelGroup?: string;
  /** 所在层（W012：活动层 / lane 层）。 */
  layer?: "campaign" | "lane";
}

export interface WorkContentGate {
  gateId: string;
  stageId: string;
  requiresDualSign: boolean;
  /** 批准时绑定的 digest / 决策字段（W013 G1：三联绑定）。 */
  binds?: readonly string[];
  /** 事件触发的实例是否允许越过该门：内容线恒为 false（I-C10）。 */
  autoApprove: false;
}

export interface WorkContentWorkflowModule {
  workflowId: string;
  key: string;
  version: number;
  title: string;
  line: z.infer<typeof WorkContentLine>;
  inputSchema: Record<string, unknown>;
  stages: readonly WorkContentStage[];
  gates: readonly WorkContentGate[];
  /** 本线额外的领域约束（例：W013 新商机字段白名单与延后提议字段）。 */
  constraints?: Readonly<Record<string, readonly string[]>>;
}

/** 由阶段表派生 skillPins（按首次出现顺序去重）。 */
export function skillPinsOf(module: Pick<WorkContentWorkflowModule, "stages">): SkillPin[] {
  const pins = new Map<string, SkillPin>();
  for (const stage of module.stages) {
    for (const ref of stage.skills) {
      const prior = pins.get(ref.stableId);
      if (prior && prior.semanticVersion !== ref.versionRange) {
        throw new Error(`${ref.stableId} pinned to two versions (${prior.semanticVersion} / ${ref.versionRange})`);
      }
      if (!prior) pins.set(ref.stableId, { skillId: ref.stableId, semanticVersion: ref.versionRange });
    }
  }
  return [...pins.values()];
}

/** 外部/写入能力分类（写入与对外发送阶段的能力并集）。 */
export function effectsOf(module: Pick<WorkContentWorkflowModule, "stages">): string[] {
  const out = new Set<string>();
  for (const s of module.stages) {
    if (s.sideEffect === "write" || s.sideEffect === "external_send") s.capabilityCategories.forEach((c) => out.add(c));
  }
  return [...out];
}

/** runtime Definition 元数据（graphRef = key:version；去掉本线的编排扩展字段）。 */
export function toDefinitionVersionInput(module: WorkContentWorkflowModule): WorkflowDefinitionVersionInput {
  return WorkflowDefinitionVersionInput.parse({
    key: module.key,
    version: module.version,
    graphRef: `${module.key}:${module.version}`,
    title: module.title,
    inputSchema: module.inputSchema,
    stages: module.stages.map((s) => ({
      stageId: s.stageId,
      title: s.title,
      skills: s.skills,
      capabilityCategories: s.capabilityCategories,
      sideEffect: s.sideEffect,
      humanGate: s.humanGate,
      maxAttempts: s.maxAttempts,
    })),
  });
}

/** 线性图的节点 id（= 阶段 id，按声明顺序）。 */
export function graphNodeIdsOf(module: WorkContentWorkflowModule): string[] {
  return module.stages.map((s) => s.stageId);
}

/**
 * UC-WC-I3 注册：逐个结算，失败隔离（I-C4）。`available ⇔ unresolvedPins = ∅`。
 * 形状非法（契约 parse 失败）或图不一致的模块同样只标自己 unavailable，并把全部 pin 列为未解析。
 */
export function registerWorkflowDefinitions(
  modules: readonly WorkContentWorkflowModule[],
  resolveSkill: SkillRefResolver,
): WorkflowCatalogItemView[] {
  return modules.map((module) => {
    const base = {
      workflowId: module.workflowId,
      key: module.key,
      version: module.version,
      title: module.title,
      line: module.line,
      stages: module.stages.map((s) => ({ stageId: s.stageId, title: s.title })),
      gates: module.gates.map((g) => ({ gateId: g.gateId, stageId: g.stageId, requiresDualSign: g.requiresDualSign })),
      effects: effectsOf(module),
    };
    let skillPins: SkillPin[] = [];
    try {
      skillPins = skillPinsOf(module);
      const input = toDefinitionVersionInput(module);
      const nodes = graphNodeIdsOf(module);
      const issues = validateDefinitionForPublish(input, { nodeIdsOf: (ref) => (ref === input.graphRef ? nodes : null) }, resolveSkill);
      const gateStagesOk = module.gates.every((g) => nodes.includes(g.stageId));
      const unresolved = new Map<string, SkillPin>();
      for (const issue of issues) {
        if (issue.kind === "skill_unresolved") unresolved.set(issue.stableId, { skillId: issue.stableId, semanticVersion: issue.versionRange });
      }
      const structural = issues.some((i) => i.kind !== "skill_unresolved") || !gateStagesOk;
      const unresolvedPins = structural ? skillPins : [...unresolved.values()];
      const available = unresolvedPins.length === 0 && !structural;
      return {
        ...base,
        skillPins,
        availability: available ? ("available" as const) : ("unavailable" as const),
        unavailableReason: available ? null : ("workflow_skill_pin_unresolved" as const),
        unresolvedPins,
      };
    } catch {
      return {
        ...base,
        skillPins,
        availability: "unavailable" as const,
        unavailableReason: "workflow_skill_pin_unresolved" as const,
        unresolvedPins: skillPins,
      };
    }
  });
}

/** 由目录中「已 PASS 且已入目录」的 Skill 版本构造精确版本解析器（pin 只认精确版本）。 */
export function exactVersionResolver(entries: readonly { stableId: string; semanticVersion: string }[]): SkillRefResolver {
  const known = new Set(entries.map((e) => `${e.stableId}@${e.semanticVersion}`));
  return (stableId, versionRange) => (known.has(`${stableId}@${versionRange}`) ? versionRange : null);
}
