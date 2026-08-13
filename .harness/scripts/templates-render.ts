// templates-render.ts —— HMV2-017：`pnpm harness templates render [--dry-run]`。
//
// E2 五件套的组装时刻：扫描实例 → renderChecked（013）→ 占位符门（014）→
// 盖元数据头（015）→ 落盘 `.harness/generated/`（016 的 drift gate 在下游
// 复检已入库产物）。判定逻辑全在 lib/（render-pipeline.ts 等纯函数），本文件
// 只做 IO 与退出码，同 templates-doctor.ts 的分层方式。
//
// 目前唯一注册的 renderer 是收编的 H3A-035（TPL-EVT-001 短文本，见
// workflow-event-renderer-adapter.ts）。新增模板的 renderer 在这里注册——
// 注册表按 template_id 路由，templates doctor 未来的"renderer 存在"检查
// （§12 #7）读的就是这张表。
//
// 失败语义（P7）：实例解析失败 / 管道任一段 issues / 写盘失败 → 非零退出；
// 0 份实例时如实说"0 份"，不渲染成"全部成功"。revision 取当前 HEAD 的
// exact SHA——render 产物声明的是"渲染时数据所处的修订"。
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";
import { validateWorkflowEvent } from "./lib/workflow-event-model";
import type { WorkflowEvent } from "./lib/workflow-event-model";
import { makeWorkflowEventRenderer, toInstanceMetadata } from "./lib/workflow-event-renderer-adapter";
import { RendererRegistry } from "./lib/renderer-model";
import { runRenderPipelineBatch } from "./lib/render-pipeline";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

const EVENTS_DIR = join(REPO_ROOT, ".harness", "events");

function loadWorkflowEvents(): { events: WorkflowEvent[]; failures: string[] } {
  const events: WorkflowEvent[] = [];
  const failures: string[] = [];
  if (!existsSync(EVENTS_DIR)) return { events, failures };
  for (const name of readdirSync(EVENTS_DIR).filter((n) => n.endsWith(".yaml") || n.endsWith(".yml")).sort()) {
    const rel = `.harness/events/${name}`;
    try {
      const parsed: unknown = parse(readFileSync(join(EVENTS_DIR, name), "utf8"));
      const result = validateWorkflowEvent(parsed, rel);
      if (result.ok) events.push(result.value!);
      else failures.push(`${rel}: ${result.issues.map((i) => i.message).join("；")}`);
    } catch (e) {
      failures.push(`${rel}: 解析失败 ${(e as Error).message}`);
    }
  }
  return { events, failures };
}

export function templatesRender(args: Args): void {
  const dryRun = !!args.flags["dry-run"];
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();

  const { events, failures } = loadWorkflowEvents();
  let failed = failures.length > 0;
  for (const f of failures) log.err(`[templates render] 实例不可用：${f}`);

  // 注册表在这里组装（显式实例，不是模块级单例——见 renderer-model.ts 注释）。
  const registry = new RendererRegistry();
  registry.register(makeWorkflowEventRenderer(events));

  const jobs = events.map((event) => ({
    renderer: registry.forTemplate(event.template_id)[0]!,
    instance: toInstanceMetadata(event),
  }));

  if (jobs.length === 0) {
    log.info(`[templates render] 0 份可渲染实例（.harness/events/ 下没有合法的 TPL-EVT-001 实例）——如实报告，不算成功也不算失败`);
  }

  const { outputs } = runRenderPipelineBatch(jobs, { repoRoot: REPO_ROOT, revision });

  let written = 0;
  for (const [instanceId, output] of outputs) {
    if (output.issues.length > 0) {
      failed = true;
      log.err(`[templates render] ${instanceId} 产出作废（${output.issues.length} 条问题）：`);
      for (const i of output.issues) log.err(`   [${i.stage}] ${i.path}: ${i.message}`);
      continue;
    }
    for (const f of output.files) {
      if (dryRun) {
        log.info(`[templates render] dry-run 将写：${f.path}（来源 ${instanceId} @ ${revision.slice(0, 7)}）`);
      } else {
        const abs = join(REPO_ROOT, f.path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, f.finalContent, "utf8");
        written++;
        log.ok(`[templates render] 已写：${f.path}`);
      }
    }
  }

  if (!dryRun && written > 0) {
    log.info(`[templates render] 共写 ${written} 份生成物——记得 git add 入库，drift gate（templates doctor）只对入库产物生效`);
  }
  process.exitCode = failed ? 1 : 0;
}
