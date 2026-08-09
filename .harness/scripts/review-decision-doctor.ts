// review-decision-doctor.ts — H3A-036/037（PROP-HARNESS-AGENT-001 Epic E3）
// 的仓库侧入口。
//
// pnpm harness review-decision doctor
//
// 判定逻辑分两层，都是纯函数，喂 fixture 单测：
//   - H3A-036 lib/review-decision-model.ts —— 单表 schema 完整性。
//   - H3A-037 lib/review-decision-stale-gate.ts —— head/artifact 改变后旧
//     decision 是否 stale（本 PR 新增，见该文件头部注释）。
// 这里只做 IO：扫 `.harness/reviews/*.yaml`（H3A-036 建立的存放约定，见该
// 目录的 README.md），挑出 template_id === "TPL-RVW-001" 的实例 →
// 交给 validateReviewDecision → 通过 schema 的实例再交给 H3A-037 的 stale
// 判定 → 打印结果、按 FAIL 决定退出码。同 task-assignment-doctor.ts 与
// workflow-event-doctor.ts 两个独立命令的先例（H3A-037 不新开子命令，并入
// 既有 `review-decision doctor`，同 H3A-034 并入 `workflow-event doctor`
// 而不是另开 `workflow-event-stale doctor` 的先例）。
//
// Review Decision 是跟 Task Assignment/Workflow Event 不同的实例集合，所以
// 是独立的 doctor 命令、独立的存放目录，不塞进另外两个——同
// task-assignment-doctor.ts 与 workflow-event-doctor.ts 两个独立命令的先例。
//
// 今天预期扫到 0 份实例——Epic E3 才刚起步，这是仓库的真实状态，不是 bug（同
// task-assignment-doctor.ts/workflow-event-doctor.ts 落地时 0 个真实实例的
// 先例）。0 份实例时 H3A-037 的判定天然是空输入，如实标注"今天没有输入数据
// 可判定"，不编造违规场景硬凑。
//
// ⚠ H3A-037 最大的设计缺口——`resolveHeadShaForTaskId` 恒定返回 `null`：
//   本仓库今天没有 task_id → 真实分支/PR head 的机械映射机制（Proposal
//   §10.5 的 TPL-RVW-001 示例、`task-assignment-model.ts` 的 TPL-TSK-001
//   schema 都没有定义这层）。详细说明见 lib/review-decision-stale-gate.ts
//   文件头注释。`git cat-file -e` / `git merge-base --is-ancestor` 这两条
//   真实 git IO 本身已经可用（`resolveGitFactsGivenHead`），只是今天永远
//   拿不到 `resolvedHeadSha` 去驱动它们——如实标注，不是本条目遗漏实现。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";
import { validateReviewDecision, looksLikeReviewDecision, type ReviewDecision } from "./lib/review-decision-model";
import {
  checkReviewDecisionStale,
  type ReviewDecisionHeadFact,
} from "./lib/review-decision-stale-gate";
import type { Finding } from "./lib/role-authorization";
import { sh } from "./lib/sh";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

const REVIEWS_DIR = join(REPO_ROOT, ".harness", "reviews");

function scanReviewDecisions(): { instances: ReviewDecision[]; failures: { sourceFile: string; message: string }[] } {
  const instances: ReviewDecision[] = [];
  const failures: { sourceFile: string; message: string }[] = [];
  if (!existsSync(REVIEWS_DIR)) return { instances, failures };

  const files = readdirSync(REVIEWS_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  for (const file of files) {
    const filePath = join(REVIEWS_DIR, file);
    const relPath = relative(REPO_ROOT, filePath);
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(filePath, "utf8"));
    } catch (e) {
      failures.push({ sourceFile: relPath, message: `YAML 解析失败：${(e as Error).message}` });
      continue;
    }
    if (!looksLikeReviewDecision(parsed)) continue; // 不声明 TPL-RVW-001，不关我们的事

    const result = validateReviewDecision(parsed, relPath);
    if (result.ok && result.value) {
      instances.push(result.value);
    } else {
      failures.push({ sourceFile: relPath, message: result.issues.map((i) => `${i.path}: ${i.message}`).join("；") });
    }
  }

  return { instances, failures };
}

/**
 * H3A-037 IO 层，第①步——task_id → 真实分支/PR head 的映射。
 *
 * ⚠ 设计缺口，恒定返回 `null`：本仓库今天没有这层机械映射机制（Proposal
 * 与 task-assignment-model.ts 都未定义，见文件头部与
 * lib/review-decision-stale-gate.ts 的详细说明）。导出这个函数（而不是直接
 * inline 成 `null`）是为了让"这里本该有一次真实解析"这件事在代码里可见、
 * 未来补上映射机制时只需要改这一个函数体，调用方与纯函数判定逻辑都不需要
 * 跟着改。
 */
export function resolveHeadShaForTaskId(_taskId: string): string | null {
  return null;
}

/**
 * H3A-037 IO 层，第②步——真实 git IO：给定一个已经解析出来的 `headSha`，
 * 查 `exact_sha` 是否还在历史里、是否是 `headSha` 的祖先。这两条 git 命令
 * 本身已经可用（`review-decision-doctor.test.ts` 用临时 git 仓库对它做了
 * 真实反证），只是今天 `resolveHeadShaForTaskId` 恒定给不出 `headSha`
 * 去驱动它——见文件头部"设计缺口"说明。
 */
export function resolveGitFactsGivenHead(
  exactSha: string,
  headSha: string,
  repoRoot: string,
): { exactShaExists: boolean; exactShaIsAncestorOfHead: boolean | null } {
  const existsResult = sh(`git cat-file -e ${JSON.stringify(exactSha)}`, repoRoot);
  const exactShaExists = existsResult.code === 0;
  if (!exactShaExists) return { exactShaExists: false, exactShaIsAncestorOfHead: null };

  const ancestorResult = sh(
    `git merge-base --is-ancestor ${JSON.stringify(exactSha)} ${JSON.stringify(headSha)}`,
    repoRoot,
  );
  return { exactShaExists: true, exactShaIsAncestorOfHead: ancestorResult.code === 0 };
}

function collectHeadFacts(instances: readonly ReviewDecision[]): ReviewDecisionHeadFact[] {
  return instances.map((rd) => {
    const resolvedHeadSha = resolveHeadShaForTaskId(rd.task_id);
    if (resolvedHeadSha === null) {
      return { reviewDecision: rd, resolvedHeadSha: null, exactShaExists: false, exactShaIsAncestorOfHead: null };
    }
    const gitFacts = resolveGitFactsGivenHead(rd.exact_sha, resolvedHeadSha, REPO_ROOT);
    return { reviewDecision: rd, resolvedHeadSha, ...gitFacts };
  });
}

function printFindings(label: string, findings: readonly Finding[]): void {
  if (findings.length === 0) {
    log.ok(`[review-decision doctor] ${label}：干净`);
    return;
  }
  const fails = findings.filter((f) => f.severity === "FAIL");
  const warns = findings.filter((f) => f.severity === "WARN");
  if (fails.length > 0) {
    log.err(`[review-decision doctor] ${label}：${fails.length} 条 FAIL`);
    for (const f of fails) log.err(`   [${f.code}] ${f.sourceFile}: ${f.message}`);
  }
  if (warns.length > 0) {
    log.warn(`[review-decision doctor] ${label}：${warns.length} 条 WARN（不阻断）`);
    for (const f of warns) log.warn(`   [${f.code}] ${f.sourceFile}: ${f.message}`);
  }
}

export function reviewDecisionDoctor(_args: Args): void {
  const { instances, failures } = scanReviewDecisions();

  if (failures.length > 0) {
    log.err(`[review-decision doctor] ${failures.length} 份 Review Decision 实例 schema 校验失败：`);
    for (const f of failures) log.err(`   ✗ H3A036-SCHEMA-INVALID (${f.sourceFile}): ${f.message}`);
    process.exitCode = 1;
    return;
  }

  if (instances.length === 0) {
    log.ok(`[review-decision doctor] .harness/reviews/：0 份实例——Epic E3 尚未产生真实 Review Decision，是今天的已知状态，不是回归`);
    log.ok(`[review-decision doctor] H3A-037 stale gate：今天没有输入数据可判定（0 份实例），如实跳过，不是回归`);
  } else {
    const byDecision = instances.reduce<Record<string, number>>((acc, r) => {
      acc[r.decision] = (acc[r.decision] ?? 0) + 1;
      return acc;
    }, {});
    log.ok(`[review-decision doctor] .harness/reviews/：${instances.length} 份实例，全部通过 H3A-036 schema 校验（${JSON.stringify(byDecision)}）`);

    const headFacts = collectHeadFacts(instances);
    const staleFindings = checkReviewDecisionStale(headFacts);
    printFindings("H3A-037 stale gate（head/artifact 改变后旧 decision 失效）", staleFindings);

    if (staleFindings.some((f) => f.severity === "FAIL")) {
      log.info("");
      log.info(`[review-decision doctor] H3A-037 gate 未通过——见上方 FAIL 明细`);
      process.exitCode = 1;
      return;
    }
  }

  log.info("");
  log.info("以下部分本命令如实标注为「本条目范围外」，不是遗漏：");
  log.info("   · task_id → 真实分支/PR head 的机械映射机制——本仓库今天不存在，H3A-037 设计缺口，见 resolveHeadShaForTaskId 与 lib/review-decision-stale-gate.ts 头部说明");
  log.info("   · evidence_refs 指向的路径是否真实可读——运行态语义，本命令只检查非空字符串数组存在");
  log.info("   · reviewer lease 是否有效——需要查询 lease 系统当前状态，本命令不读 lease");
  log.info("   · task_id 指向的 Task Assignment（.harness/tasks/）是否真实存在——跨表 gate，尚未落地");
  log.info("   · findings 数组内部结构——Proposal 未定义其形状，本命令只检查字段本身是数组");
  log.info("   · reviewer===producer 由本命令在字段级直接判 FAIL；registry.yaml 层面的身份分离一致性检查是 H3A-027 role-authorization doctor 的事，两者互补不重复");

  process.exitCode = 0;
}
