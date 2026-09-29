/**
 * Phase 20 CT02 —— 内容线 Workflow 代码定义与注册校验（契约束 work-content I-C1 / I-C4 / I-C5；
 * ADR-118 #9：Workflow 版本固定其 Skill 的 semanticVersion，与 Agent 挂载无关）。
 *
 * 纯函数、无 IO。skillPins 由阶段表的 Skill 引用派生（阶段表是唯一声明处，不另写一份组合表）；
 * 注册校验给每个 Workflow 独立判定可用性——一个失败不影响其它（I-C4）。
 */
import type { CapabilityCategory } from "@repo/contracts/workflow-runtime";
import type { WorkContentLine, WorkflowCatalogItem, WorkflowSkillPin } from "@repo/contracts/work-content";
import type { WorkSkillChannel, WorkSkillGateStatus } from "@repo/contracts/work-skill-meta";
import type { z } from "zod";

type Pin = z.infer<typeof WorkflowSkillPin>;
type CatalogItem = z.infer<typeof WorkflowCatalogItem>;

export interface WorkContentStage {
  readonly stageId: string;
  readonly title: string;
  /** 本阶段调用的 Skill stableId（§5 阶段表「Skill IDs」列）；平台阶段为空。 */
  readonly skills: readonly string[];
}

export interface WorkContentGate {
  readonly gateId: string;
  readonly stageId: string;
  readonly requiresDualSign: boolean;
}

export interface WorkContentWorkflowDefinition {
  readonly id: string; // W\d{3}
  readonly key: string;
  readonly version: number;
  readonly title: string;
  readonly line: z.infer<typeof WorkContentLine>;
  /** 本版本固定的 Skill semanticVersion（ADR-118 #9）；键 = Skill stableId。 */
  readonly skillVersions: Readonly<Record<string, string>>;
  readonly stages: readonly WorkContentStage[];
  readonly gates: readonly WorkContentGate[];
  readonly effects: readonly z.infer<typeof CapabilityCategory>[];
}

export function graphRefOf(def: WorkContentWorkflowDefinition): string {
  return `${def.key}:${def.version}`;
}

/** skillPins = 阶段表出现的 Skill ID（去重、按首次出现顺序）× 固定版本；缺版本即定义错误。 */
export function skillPinsOf(def: WorkContentWorkflowDefinition): Pin[] {
  const seen = new Set<string>();
  const pins: Pin[] = [];
  for (const stage of def.stages) {
    for (const skillId of stage.skills) {
      if (seen.has(skillId)) continue;
      seen.add(skillId);
      const semanticVersion = def.skillVersions[skillId];
      if (!semanticVersion) throw new Error(`${def.id}: skill ${skillId} has no pinned semanticVersion`);
      pins.push({ skillId, semanticVersion });
    }
  }
  for (const skillId of Object.keys(def.skillVersions)) {
    if (!seen.has(skillId)) throw new Error(`${def.id}: pinned skill ${skillId} is not used by any stage`);
  }
  return pins;
}

/** 目录中某个 Skill 版本的状态（入目录 + 门状态）。 */
export interface PinnedSkillCatalogState {
  readonly channel: WorkSkillChannel;
  readonly gates: readonly z.infer<typeof WorkSkillGateStatus>[];
}

export type SkillPinLookup = (skillId: string, semanticVersion: string) => PinnedSkillCatalogState | null;

/** 注册所需的最低门：G0–G2 全部 passed（05 号 E2「门状态低于 G2 → 注册失败」）。 */
export const REQUIRED_PIN_GATES = ["G0", "G1", "G2"] as const;

export function isPinResolved(state: PinnedSkillCatalogState | null): boolean {
  if (!state || state.channel === "deprecated") return false;
  return REQUIRED_PIN_GATES.every((g) => state.gates.some((s) => s.gate === g && s.state === "passed"));
}

/** UC-WC-I3：逐个 Workflow 注册校验 → 目录条目（available ⇔ unresolvedPins = ∅）。 */
export function resolveWorkflowCatalog(
  defs: readonly WorkContentWorkflowDefinition[],
  lookup: SkillPinLookup,
): CatalogItem[] {
  return defs.map((def) => {
    const skillPins = skillPinsOf(def);
    const unresolvedPins = skillPins.filter((p) => !isPinResolved(lookup(p.skillId, p.semanticVersion)));
    const available = unresolvedPins.length === 0;
    return {
      workflowId: def.id,
      key: def.key,
      version: def.version,
      title: def.title,
      line: def.line,
      skillPins,
      stages: def.stages.map((s) => ({ stageId: s.stageId, title: s.title })),
      gates: def.gates.map((g) => ({ ...g })),
      effects: [...def.effects],
      availability: available ? "available" : "unavailable",
      unavailableReason: available ? null : "workflow_skill_pin_unresolved",
      unresolvedPins,
    };
  });
}
