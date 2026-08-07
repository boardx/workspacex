/**
 * graph-authority.ts —— H3A-009：已知投影路径不得被 Git 追踪。
 *
 * 完整合同见 docs/proposals/PROP-HARNESS-AGENT-001-h3a009-graph-authority-
 * contract.md——本文件只做合同里"机械检查"那一节描述的那一件事：已知的、
 * 明确标注"可重建投影"的路径，如果被 Git 追踪，说明有人在编辑投影本身
 * 而不是编辑权威源，投影会漂移成第二份事实。
 *
 * 纯函数：喂"路径 + 该路径下被 Git 追踪的文件列表"，判断是否违规。真正跑
 * `git ls-files` 的 IO 在 graph-authority-doctor.ts。
 */

export interface ProjectionPath {
  /** 传给 `git ls-files --` 的 pathspec，同 .gitignore 里对应那条规则的字面量。 */
  path: string;
  /** 这条路径投影的是哪类权威，人类可读。 */
  projects: string;
}

/**
 * H3A-009 合同表里"机械检查"一节列的四条——同一份清单，不是另一份。
 * 新增投影路径：先在合同文档里加一行，再在这里加一条，两处都要改，
 * 顺序哪个先无所谓，但不能只改一处（同 registry.yaml 那类"改动走 PR review
 * 但没有唯一来源"的教训，这里刻意让两处都是显式列表，靠 review 保持同步，
 * 不是自动生成——四条规模小，暂不需要为它单独造一个"从合同文档解析"的
 * 机制，那会是过度工程）。
 */
export const KNOWN_PROJECTION_PATHS: readonly ProjectionPath[] = [
  { path: ".harness/state/.cache/", projects: "Graph Kernel GraphSnapshot（Traceability Graph 投影）" },
  { path: ".harness/state/dep-graph.md", projects: "依赖图（从 feature_list.json 重生成）" },
  { path: "**/active-features.json", projects: "sprint 派生只读视图" },
  { path: ".harness/templates/instances/", projects: "TPL-EVD-001 证据实例（HMV2-066）" },
] as const;

export interface AuthorityFinding {
  code: "H3A009-PROJECTION-TRACKED";
  severity: "FAIL";
  path: string;
  message: string;
}

export interface ProjectionCheckInput {
  path: string;
  /** `git ls-files -- <path>` 的真实输出，按行拆好；空数组 = 干净。 */
  trackedFiles: readonly string[];
}

export function findTrackedProjections(
  results: readonly ProjectionCheckInput[],
): AuthorityFinding[] {
  const findings: AuthorityFinding[] = [];
  for (const r of results) {
    if (r.trackedFiles.length === 0) continue;
    findings.push({
      code: "H3A009-PROJECTION-TRACKED",
      severity: "FAIL",
      path: r.path,
      message:
        `"${r.path}" 是标注为「可重建投影」的路径，但 Git 追踪到 ${r.trackedFiles.length} 个文件：` +
        `${r.trackedFiles.join(", ")}——有人在提交投影本身而不是权威源，这会漂移成第二份事实`,
    });
  }
  return findings;
}
