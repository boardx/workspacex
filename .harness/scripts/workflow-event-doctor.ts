// workflow-event-doctor.ts — H3A-033（PROP-HARNESS-AGENT-001 Epic E3）的仓库侧入口。
//
// pnpm harness workflow-event doctor
//
// 判定逻辑在 lib/workflow-event-model.ts（纯函数，喂 fixture 单测）。这里只做 IO：
// 扫 `.harness/events/*.yaml`（本 PR 建立的存放约定，见该目录的 README.md），
// 挑出 template_id === "TPL-EVT-001" 的实例 → 交给 validateWorkflowEvent →
// 打印结果、按 FAIL 决定退出码。同 task-assignment-doctor.ts 的分层方式：本文件
// 只管"从哪读、输出成什么退出码"，不含判定逻辑本身。
//
// Workflow Event 是跟 Task Assignment 不同的实例集合（一个任务可以有多条
// Workflow Event，反过来不成立），所以是独立的 doctor 命令、独立的存放目录，
// 不塞进 task-assignment doctor——同 domains-doctor.ts 与
// role-authorization-doctor.ts 两个独立命令的先例。
//
// 今天预期扫到 0 份实例——Epic E3 才刚起步（H3A-030 是第一个落地的条目），
// 这是仓库的真实状态，不是 bug（同 task-assignment-doctor.ts 落地时 0 个真实
// 实例的先例）。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";
import { validateWorkflowEvent, looksLikeWorkflowEvent, type WorkflowEvent } from "./lib/workflow-event-model";
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
  } else {
    const byKind = instances.reduce<Record<string, number>>((acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1;
      return acc;
    }, {});
    log.ok(`[workflow-event doctor] .harness/events/：${instances.length} 份实例，全部通过 H3A-033 schema 校验（${JSON.stringify(byKind)}）`);
  }

  log.info("");
  log.info("以下部分本命令如实标注为「本条目范围外」，不是遗漏：");
  log.info("   · Event stable ID 重复、历史覆写——H3A-034，尚未落地");
  log.info("   · 12 行短文本 renderer——H3A-035，尚未落地");
  log.info("   · task_id 指向的 Task Assignment 是否真实存在——跨表 gate，尚未落地");

  process.exitCode = 0;
}
