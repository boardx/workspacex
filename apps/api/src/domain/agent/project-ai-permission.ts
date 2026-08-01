/**
 * F58 -- 项目级 AI 权限三开关：三粒度（组织/agent 级 → 项目级 → 画布/线程级）取交集，
 * 收紧优先，**下层不得放宽上层**（O-23，与 F56 `three-layer-permission.ts` 的
 * 「有效权限 = ①∩②∩③」是同一条纪律在不同维度上的复用）。
 *
 * `user_visible_behavior`: 「三粒度（组织/agent 级、项目级、画布/线程级）取交集收紧优先、
 * 下层不能放宽上层——agent 级允许插话但项目级关闭时仍不插话，画布级也无法再打开」。
 *
 * ⚠ **默认值不在本模块里**。三个开关（`facilitatorProposesConvergence` /
 * `liveTranscription` / `aiWritesOnCanvas`）各自的**默认值**是否为开是 F58 被裁决的另一半
 * （`@repo/contracts/thresholds` 的 `projectAiDefault*`，`known: false`）。本模块只管
 * **合成规则**（已裁，O-23）：给定三层各自「是否收紧」的事实，算出有效值与"是哪一层收紧的"。
 * 调用方在项目层未显式设置（`null`）时，若要判定"有效开/关"，必须先用
 * `requireValue` 拿到默认值再喂进来——本模块拒绝在这里悄悄把 `null` 当成 `true`。
 *
 * ## Why this mirrors three-layer-permission.ts's shape instead of a generic n-layer reducer
 *
 * A generic `layers: boolean[]` reducer would lose the ability to name WHICH grain tightened
 * the result -- exactly the same reasoning F56 gives for why `deniedBy` is a single named layer,
 * not a bitmask. Keeping the three grains as named fields (not an array) also matches how the
 * UI must render it: "agent 级允许插话但项目级关闭时仍不插话" is a claim about a SPECIFIC named
 * layer, not "layer[1]".
 */

/** 三个可收紧的粒度，从上到下：组织/agent 级 → 项目级 → 画布/线程级。 */
export type AiPermissionGrain = "org-agent" | "project" | "canvas-thread";

export interface AiPermissionGrainInput {
  /** 组织/agent 级是否允许（已在别处决定——F57 的 agent 载入/白名单等，本模块只读不复算）。 */
  readonly orgOrAgentAllows: boolean;
  /** 项目级显式设置。`null` = 本层未设置，跟随上层，**不是**"设置为关"。 */
  readonly projectSetting: boolean | null;
  /** 画布/线程级显式设置。`null` = 本层未设置，跟随上层。 */
  readonly canvasSetting: boolean | null;
}

export interface AiPermissionIntersectionResult {
  readonly effective: boolean;
  /** 有效值为 false 时，是从上到下**第一个**显式收紧（=false）的粒度；全允许时为 null。 */
  readonly tightenedBy: AiPermissionGrain | null;
  /** 三层各自的事实值，供界面解释"为什么" —— 一律呈现，即使被上层已经决定了整体结果。 */
  readonly grains: {
    readonly orgAgent: boolean;
    readonly project: boolean | null;
    readonly canvasThread: boolean | null;
  };
}

/**
 * 合成规则的唯一实现（O-23）。任一粒度收紧（=false）即整体收紧；
 * 未设置（`null`）视为"不收紧"（跟随上层），但**永远不能把上层已经收紧的结果放宽回 true**——
 * 三层按 org-agent → project → canvas-thread 的顺序短路求值，正是这个顺序保证了这一点：
 * 一旦上层已经是 false，后面粒度设成什么都不会被读到"放宽"的语义里。
 */
export function intersectAiPermissionGrains(
  input: AiPermissionGrainInput,
): AiPermissionIntersectionResult {
  const grains = {
    orgAgent: input.orgOrAgentAllows,
    project: input.projectSetting,
    canvasThread: input.canvasSetting,
  };

  if (!input.orgOrAgentAllows) {
    return { effective: false, tightenedBy: "org-agent", grains };
  }
  if (input.projectSetting === false) {
    return { effective: false, tightenedBy: "project", grains };
  }
  if (input.canvasSetting === false) {
    return { effective: false, tightenedBy: "canvas-thread", grains };
  }
  return { effective: true, tightenedBy: null, grains };
}

/** 项目设置里的三个开关键名 —— 与契约 `getProjectAiPermissions`/`setProjectAiPermissions` 的字段同名。 */
export type ProjectAiSwitchId =
  | "facilitatorProposesConvergence"
  | "liveTranscription"
  | "aiWritesOnCanvas";

export interface ProjectAiSwitchGrainInputs {
  readonly [key: string]: AiPermissionGrainInput;
}

/** 三个开关各自求交后的有效值 —— `getProjectAiPermissions.out.effective` 的领域侧来源。 */
export function intersectAllSwitches(
  inputs: Record<ProjectAiSwitchId, AiPermissionGrainInput>,
): Record<ProjectAiSwitchId, AiPermissionIntersectionResult> {
  const out = {} as Record<ProjectAiSwitchId, AiPermissionIntersectionResult>;
  for (const key of Object.keys(inputs) as ProjectAiSwitchId[]) {
    out[key] = intersectAiPermissionGrains(inputs[key]);
  }
  return out;
}

/** 一个开关依赖的能力清单 —— A5：关闭后这些能力须在编制里标「本场已关闭」，不静默不工作。 */
export interface SwitchDependency {
  readonly switchId: ProjectAiSwitchId;
  readonly capabilities: readonly string[];
}

/**
 * A5 的领域侧：给定变更前后的有效值，算出因本次变更而被关闭的能力清单
 * （`setProjectAiPermissions.out.disabledCapabilities`）。
 *
 * ⚠ 只报告 true→false 的跃迁 —— 本来就是关的（false→false）不算"因本次关闭"，
 * 否则每次 PATCH 都会把无关能力也标红。
 */
export function disabledCapabilitiesOnChange(
  before: Record<ProjectAiSwitchId, boolean>,
  after: Record<ProjectAiSwitchId, boolean>,
  deps: readonly SwitchDependency[],
): readonly string[] {
  const disabled: string[] = [];
  for (const dep of deps) {
    if (before[dep.switchId] === true && after[dep.switchId] === false) {
      disabled.push(...dep.capabilities);
    }
  }
  return disabled;
}
