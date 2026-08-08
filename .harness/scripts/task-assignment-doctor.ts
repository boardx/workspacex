// task-assignment-doctor.ts — H3A-030（PROP-HARNESS-AGENT-001 Epic E3）的仓库侧入口。
//
// pnpm harness task-assignment doctor
//
// 判定逻辑在 lib/task-assignment-model.ts（纯函数，喂 fixture 单测）。这里只做 IO：
// 扫 `.harness/tasks/*.yaml`（本 PR 建立的存放约定，见该目录的 README.md），
// 挑出 template_id === "TPL-TSK-001" 的实例 → 交给 validateTaskAssignment →
// 打印结果、按 FAIL 决定退出码。同 domains-doctor.ts 的分层方式：本文件只管
// "从哪读、输出成什么退出码"，不含判定逻辑本身。
//
// 今天预期扫到 0 份实例——Epic E3 在本 PR 之前完全未开工，这是仓库的真实状态，
// 不是 bug（同 domains-doctor.ts 落地时 0 个 Domain Skill 实例的先例）。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";
import { validateTaskAssignment, looksLikeTaskAssignment, type TaskAssignment } from "./lib/task-assignment-model";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

const TASKS_DIR = join(REPO_ROOT, ".harness", "tasks");

function scanTaskAssignments(): { instances: TaskAssignment[]; failures: { sourceFile: string; message: string }[] } {
  const instances: TaskAssignment[] = [];
  const failures: { sourceFile: string; message: string }[] = [];
  if (!existsSync(TASKS_DIR)) return { instances, failures };

  const files = readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  for (const file of files) {
    const filePath = join(TASKS_DIR, file);
    const relPath = relative(REPO_ROOT, filePath);
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(filePath, "utf8"));
    } catch (e) {
      failures.push({ sourceFile: relPath, message: `YAML 解析失败：${(e as Error).message}` });
      continue;
    }
    if (!looksLikeTaskAssignment(parsed)) continue; // 不声明 TPL-TSK-001，不关我们的事

    const result = validateTaskAssignment(parsed, relPath);
    if (result.ok && result.value) {
      instances.push(result.value);
    } else {
      failures.push({ sourceFile: relPath, message: result.issues.map((i) => `${i.path}: ${i.message}`).join("；") });
    }
  }

  return { instances, failures };
}

export function taskAssignmentDoctor(_args: Args): void {
  const { instances, failures } = scanTaskAssignments();

  if (failures.length > 0) {
    log.err(`[task-assignment doctor] ${failures.length} 份 Task Assignment 实例 schema 校验失败：`);
    for (const f of failures) log.err(`   ✗ H3A030-SCHEMA-INVALID (${f.sourceFile}): ${f.message}`);
    process.exitCode = 1;
    return;
  }

  if (instances.length === 0) {
    log.ok(`[task-assignment doctor] .harness/tasks/：0 份实例——Epic E3 尚未产生真实 Task Assignment，是今天的已知状态，不是回归`);
  } else {
    log.ok(`[task-assignment doctor] .harness/tasks/：${instances.length} 份实例，全部通过 H3A-030 schema 校验`);
  }

  log.info("");
  log.info("以下部分本命令如实标注为「本条目范围外」，不是遗漏：");
  log.info("   · scope 是否越权、assignee_role 是否真实存在、dependencies 是否成环——H3A-031/032 的跨表 gate，尚未落地");
  log.info("   · authority_snapshot_hash 是否等于当前 Authorization Model 的真实哈希——运行态语义，本命令只检查非空字符串存在");

  process.exitCode = 0;
}
