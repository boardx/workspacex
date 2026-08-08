// review-decision-doctor.ts — H3A-036（PROP-HARNESS-AGENT-001 Epic E3）的
// 仓库侧入口。
//
// pnpm harness review-decision doctor
//
// 判定逻辑在 lib/review-decision-model.ts（纯函数，喂 fixture 单测）。这里
// 只做 IO：扫 `.harness/reviews/*.yaml`（本 PR 建立的存放约定，见该目录的
// README.md），挑出 template_id === "TPL-RVW-001" 的实例 →
// 交给 validateReviewDecision → 打印结果、按 FAIL 决定退出码。同
// task-assignment-doctor.ts/workflow-event-doctor.ts 的分层方式：本文件只管
// "从哪读、输出成什么退出码"，不含判定逻辑本身。
//
// Review Decision 是跟 Task Assignment/Workflow Event 不同的实例集合，所以
// 是独立的 doctor 命令、独立的存放目录，不塞进另外两个——同
// task-assignment-doctor.ts 与 workflow-event-doctor.ts 两个独立命令的先例。
//
// 今天预期扫到 0 份实例——Epic E3 才刚起步，这是仓库的真实状态，不是 bug（同
// task-assignment-doctor.ts/workflow-event-doctor.ts 落地时 0 个真实实例的
// 先例）。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";
import { validateReviewDecision, looksLikeReviewDecision, type ReviewDecision } from "./lib/review-decision-model";
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
  } else {
    const byDecision = instances.reduce<Record<string, number>>((acc, r) => {
      acc[r.decision] = (acc[r.decision] ?? 0) + 1;
      return acc;
    }, {});
    log.ok(`[review-decision doctor] .harness/reviews/：${instances.length} 份实例，全部通过 H3A-036 schema 校验（${JSON.stringify(byDecision)}）`);
  }

  log.info("");
  log.info("以下部分本命令如实标注为「本条目范围外」，不是遗漏：");
  log.info("   · exact_sha 是否等于受审对象当前真实 SHA（revision 是否 stale）——运行态语义，本命令只检查非空字符串存在");
  log.info("   · evidence_refs 指向的路径是否真实可读——运行态语义，本命令只检查非空字符串数组存在");
  log.info("   · reviewer lease 是否有效——需要查询 lease 系统当前状态，本命令不读 lease");
  log.info("   · task_id 指向的 Task Assignment（.harness/tasks/）是否真实存在——跨表 gate，尚未落地");
  log.info("   · findings 数组内部结构——Proposal 未定义其形状，本命令只检查字段本身是数组");
  log.info("   · reviewer===producer 由本命令在字段级直接判 FAIL；registry.yaml 层面的身份分离一致性检查是 H3A-027 role-authorization doctor 的事，两者互补不重复");

  process.exitCode = 0;
}
