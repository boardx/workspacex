// agent-spec-shape.ts —— `.harness/agents/*.yaml` 的形状判定。
//
// 出身：这三样原本长在 lib/role-authorization.ts（H3A-020/028）里。H-01
// （issue #1567）删掉整套 H3A 治理机器时，可达性扫描发现 gen-subagents.ts
// 真的在 import 它们——**这是那次扫描唯一抓到的真实代码耦合**，其余外部引用
// 全是 ADR/proposal 文档提及。
//
// 它们与 H3A 无关：判的是"agent 规格文件的 kind 能不能派生出层级、
// specialist worker 的 spec 有没有写全"，数据平面是 6 个真实存在的角色文件，
// 不是 H3A 那些 0 实例的治理对象。所以搬家保留，而不是随 H3A 一起删。
//
// 唯一消费者：gen-subagents.ts（`pnpm harness gen-subagents`，CI 门控）。
export type Layer = "root_orchestrator" | "domain_orchestrator" | "specialist_worker";
export interface Finding {
  code: string;
  severity: "FAIL" | "WARN";
  sourceFile: string;
  message: string;
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
const MAX_REASONABLE_TOOL_COUNT = 8;

/**
 * H3A-020 完成契约原文指定的三个映射目标；键是 6 个真实角色文件里 `kind`
 * 字段的实际取值（`module-coordinator`/`architecture-coordinator` 都算
 * Domain Orchestrator——proposal §6.2 原文："Domain Orchestrator"是规范
 * 显示名，不新增语义重复的 kind；coord-architecture 在组织关系上视为
 * harness Domain 的 L2 Agent）。
 */
export const KIND_TO_LAYER: Readonly<Record<string, Layer>> = {
  coordinator: "root_orchestrator",
  "architecture-coordinator": "domain_orchestrator",
  "module-coordinator": "domain_orchestrator",
  worker: "specialist_worker",
  reviewer: "specialist_worker",
};

export interface RawAgentSpec {
  /** `.harness/agents/<file>.yaml` 相对路径（不含 roles/ 子目录、不含 registry.yaml）。 */
  sourceFile: string;
  name: unknown;
  role: unknown;
  tools: unknown;
}

export function checkSpecialistWorkerSpecs(specs: readonly RawAgentSpec[]): Finding[] {
  const findings: Finding[] = [];
  for (const spec of specs) {
    if (!isNonEmptyString(spec.role)) {
      findings.push({
        code: "H3A023-MISSING-ROLE-FIELD",
        severity: "FAIL",
        sourceFile: spec.sourceFile,
        message: "缺少非空 `role:` 字段（单一职责的任务类型标记）——Specialist Worker 必须声明自己是什么类型的原子任务",
      });
    }
    if (!Array.isArray(spec.tools) || spec.tools.length === 0) {
      findings.push({
        code: "H3A023-TOOLS-EMPTY",
        severity: "WARN",
        sourceFile: spec.sourceFile,
        message: "`tools:` 缺失或为空数组——无法核实该 Specialist Worker 的写入边界",
      });
    } else if (spec.tools.length > MAX_REASONABLE_TOOL_COUNT) {
      findings.push({
        code: "H3A023-TOOLS-TOO-MANY",
        severity: "WARN",
        sourceFile: spec.sourceFile,
        message:
          `声明了 ${spec.tools.length} 个 tools（> ${MAX_REASONABLE_TOOL_COUNT}）——` +
          `工具面越宽，"单一职责"的边界越模糊，建议复核是否该拆成多个 Specialist Worker`,
      });
    }
  }
  return findings;
}