// workflow-event-doctor.ts — H3A-033/034（PROP-HARNESS-AGENT-001 Epic E3）的仓库侧入口。
//
// pnpm harness workflow-event doctor
//
// 判定逻辑在 lib/workflow-event-model.ts（H3A-033，schema）与
// lib/workflow-event-append-only-gate.ts（H3A-034，重复 ID + append-only）—— 都是
// 纯函数，喂 fixture 单测。这里只做 IO：扫 `.harness/events/*.yaml`（本 PR 建立的
// 存放约定，见该目录的 README.md），挑出 template_id === "TPL-EVT-001" 的实例 →
// 交给 validateWorkflowEvent → 通过 schema 的实例再交给 H3A-034 的两条判定 →
// 打印结果、按 FAIL 决定退出码。同 task-assignment-doctor.ts 的分层方式：本文件
// 只管"从哪读、输出成什么退出码"，不含判定逻辑本身。
//
// H3A-034 的 append-only 判定需要真实 git IO（`git log --follow` 拿某个文件的
// 历史提交，逐对 `git diff --quiet` 判断是不是真实内容变更）——这部分子进程调用
// 只放在这里（doctor/IO 层），不进 lib/（同 role-authorization-doctor.ts 分层
// 先例：判定逻辑纯函数 + IO 在 doctor）。
//
// Workflow Event 是跟 Task Assignment 不同的实例集合（一个任务可以有多条
// Workflow Event，反过来不成立），所以是独立的 doctor 命令、独立的存放目录，
// 不塞进 task-assignment doctor——同 domains-doctor.ts 与
// role-authorization-doctor.ts 两个独立命令的先例。
//
// 今天预期扫到 0 份实例——Epic E3 才刚起步（H3A-030 是第一个落地的条目），
// 这是仓库的真实状态，不是 bug（同 task-assignment-doctor.ts 落地时 0 个真实
// 实例的先例）。0 份实例时 H3A-034 的两条检查天然是空输入（无重复可判、无历史
// 可查），如实标注"今天没有输入数据可判定"，不编造违规场景硬凑。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";
import { validateWorkflowEvent, looksLikeWorkflowEvent, type WorkflowEvent } from "./lib/workflow-event-model";
import {
  checkDuplicateInstanceIds,
  checkAppendOnly,
  type GitHistoryFact,
} from "./lib/workflow-event-append-only-gate";
import type { Finding } from "./lib/role-authorization";
import { sh } from "./lib/sh";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

const EVENTS_DIR = join(REPO_ROOT, ".harness", "events");

function scanWorkflowEvents(): { instances: WorkflowEvent[]; failures: { sourceFile: string; message: string }[] } {
  const instances: WorkflowEvent[] = [];
  const failures: { sourceFile: string; message: string }[] = [];
  if (!existsSync(EVENTS_DIR)) return { instances, failures };

  const files = readdirSync(EVENTS_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  for (const file of files) {
    const filePath = join(EVENTS_DIR, file);
    const relPath = relative(REPO_ROOT, filePath);
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(filePath, "utf8"));
    } catch (e) {
      failures.push({ sourceFile: relPath, message: `YAML 解析失败：${(e as Error).message}` });
      continue;
    }
    if (!looksLikeWorkflowEvent(parsed)) continue; // 不声明 TPL-EVT-001，不关我们的事

    const result = validateWorkflowEvent(parsed, relPath);
    if (result.ok && result.value) {
      instances.push(result.value);
    } else {
      failures.push({ sourceFile: relPath, message: result.issues.map((i) => `${i.path}: ${i.message}`).join("；") });
    }
  }

  return { instances, failures };
}

/**
 * 拿到某个已提交文件在 git 历史里"真实内容变更"的 commit 数（不含首次新增
 * 那一次）——H3A-034 append-only 判定要用的真实 git IO，见文件头部注释。
 *
 * 做法：
 *   1. `git log --follow --format=%H -- <file>` 拿全部 touch 过这个文件的
 *      commit（newest-first），反转成 oldest-first。
 *   2. 第一个 commit 是"首次新增"，不算变更。
 *   3. 相邻两个 commit 之间用 `git diff --quiet <a> <b> -- <file>` 判断内容
 *      是否真的变了（exit 0 = 没变，非 0 = 变了）——比逐个数 touch 次数更
 *      准确，因为同一次 rebase/merge 可能让文件在 log 里出现但内容其实
 *      没变。
 *   4. 如果这个文件不在 git 索引里（还没提交过，比如刚在本地新建），
 *      `git log` 返回空，视为 0 次变更——还没提交的文件谈不上"被覆写"。
 *
 * 已知简化：`git diff a b -- <file>` 用的是同一个相对路径，不跟随文件在
 * 历史中途改名的情况（--follow 能在 log 阶段跨改名找到 commit，但逐对
 * diff 阶段用固定路径查不到改名前的版本）。Workflow Event 文件按约定用
 * `instance_id` 命名、不改名，如实标注这是本条目已知的简化，不是本条目
 * 假装解决了改名场景。
 *
 * 导出：`workflow-event-doctor.test.ts` 用临时 git 仓库对这个函数做真实
 * git IO 的反证（不污染本仓库真实历史），所以接受 `repoRoot` 参数而不是
 * 写死 REPO_ROOT——调用方（`workflowEventDoctor`）传真实 REPO_ROOT。
 */
export function countContentChangeCommitsAfterFirst(relPath: string, repoRoot: string): number {
  const logResult = sh(`git log --follow --format=%H -- ${JSON.stringify(relPath)}`, repoRoot);
  const commitsNewestFirst = logResult.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const commits = [...commitsNewestFirst].reverse(); // oldest-first
  if (commits.length <= 1) return 0; // 0 或 1 次 touch：还没提交，或只有首次新增

  let count = 0;
  for (let i = 1; i < commits.length; i++) {
    const diffResult = sh(
      `git diff --quiet ${commits[i - 1]} ${commits[i]} -- ${JSON.stringify(relPath)}`,
      repoRoot,
    );
    if (diffResult.code !== 0) count++;
  }
  return count;
}

function collectGitHistoryFacts(instances: readonly WorkflowEvent[]): GitHistoryFact[] {
  return instances.map((inst) => ({
    relPath: inst.sourceFile,
    contentChangeCommitsAfterFirst: countContentChangeCommitsAfterFirst(inst.sourceFile, REPO_ROOT),
  }));
}

function printFindings(label: string, findings: readonly Finding[]): void {
  if (findings.length === 0) {
    log.ok(`[workflow-event doctor] ${label}：干净`);
    return;
  }
  const fails = findings.filter((f) => f.severity === "FAIL");
  const warns = findings.filter((f) => f.severity === "WARN");
  if (fails.length > 0) {
    log.err(`[workflow-event doctor] ${label}：${fails.length} 条 FAIL`);
    for (const f of fails) log.err(`   [${f.code}] ${f.sourceFile}: ${f.message}`);
  }
  if (warns.length > 0) {
    log.warn(`[workflow-event doctor] ${label}：${warns.length} 条 WARN（不阻断）`);
    for (const f of warns) log.warn(`   [${f.code}] ${f.sourceFile}: ${f.message}`);
  }
}

export function workflowEventDoctor(_args: Args): void {
  const { instances, failures } = scanWorkflowEvents();

  if (failures.length > 0) {
    log.err(`[workflow-event doctor] ${failures.length} 份 Workflow Event 实例 schema 校验失败：`);
    for (const f of failures) log.err(`   ✗ H3A033-SCHEMA-INVALID (${f.sourceFile}): ${f.message}`);
    process.exitCode = 1;
    return;
  }

  if (instances.length === 0) {
    log.ok(`[workflow-event doctor] .harness/events/：0 份实例——Epic E3 尚未产生真实 Workflow Event，是今天的已知状态，不是回归`);
    log.ok(`[workflow-event doctor] H3A-034 重复 ID / append-only：今天没有输入数据可判定（0 份实例），如实跳过，不是回归`);
  } else {
    const byKind = instances.reduce<Record<string, number>>((acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1;
      return acc;
    }, {});
    log.ok(`[workflow-event doctor] .harness/events/：${instances.length} 份实例，全部通过 H3A-033 schema 校验（${JSON.stringify(byKind)}）`);

    // H3A-034 判①：重复 instance_id——纯函数，不需要 git IO。
    const dupFindings = checkDuplicateInstanceIds(instances);
    printFindings("H3A-034 Event stable ID 重复检查", dupFindings);

    // H3A-034 判②：append-only——需要真实 git log/diff 子进程调用（IO 层，就在这里做）。
    const historyFacts = collectGitHistoryFacts(instances);
    const appendOnlyFindings = checkAppendOnly(historyFacts);
    printFindings("H3A-034 append-only（历史覆写）检查", appendOnlyFindings);

    const allH3A034Findings = [...dupFindings, ...appendOnlyFindings];
    if (allH3A034Findings.some((f) => f.severity === "FAIL")) {
      log.info("");
      log.info(`[workflow-event doctor] H3A-034 gate 未通过——见上方 FAIL 明细`);
      process.exitCode = 1;
      return;
    }
  }

  log.info("");
  log.info("以下部分本命令如实标注为「本条目范围外」，不是遗漏：");
  log.info("   · 12 行短文本 renderer——H3A-035，尚未落地");
  log.info("   · task_id 指向的 Task Assignment 是否真实存在——跨表 gate，尚未落地");

  process.exitCode = 0;
}
