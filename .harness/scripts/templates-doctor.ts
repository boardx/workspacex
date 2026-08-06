// templates-doctor.ts — HMV2-010/011/012 的仓库侧入口。
//
// pnpm harness templates doctor
//
// 判定逻辑全在 lib/template-doctor.ts（纯函数，喂 fixture 单测）。这里只做：
// 读注册表 → 扫仓库找实例 → 交给判定函数 → 按结果决定退出码，同 lint-rewrite-coverage.mjs
// 的分层方式。
import { REPO_ROOT } from "./lib/paths";
import { join } from "node:path";
import { readRegistryFile, scanForInstances } from "./lib/template-scan";
import { validateRegistry } from "./lib/template-model";
import { runTemplateDoctor } from "./lib/template-doctor";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

const REGISTRY_PATH = join(REPO_ROOT, ".harness", "templates", "registry.yaml");

export function templatesDoctor(_args: Args): void {
  const { parsed, error } = readRegistryFile(REGISTRY_PATH);
  const registryResult = error ? null : validateRegistry(parsed);
  const registryParseError =
    error ?? (registryResult && !registryResult.ok
      ? `registry.yaml 结构不合法：\n${registryResult.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`
      : null);

  const scan = scanForInstances(REPO_ROOT);

  const report = runTemplateDoctor({
    registry: registryResult?.value ?? null,
    registryParseError,
    instances: scan.instances,
    instanceValidationFailures: scan.validationFailures,
  });

  if (report.status === "UNKNOWN") {
    log.err(`[templates doctor] UNKNOWN —— 权威数据源不可读，拒绝下判断：`);
    for (const f of report.findings) log.err(`   ${f.code}: ${f.message}`);
    process.exitCode = 1;
    return;
  }

  log.info(`[templates doctor] 扫到 ${report.instancesChecked} 份实例文档`);
  if (report.status === "FAIL") {
    log.err(`[templates doctor] FAIL —— ${report.findings.length} 条问题：`);
    for (const f of report.findings) {
      const marker = f.severity === "FAIL" ? "✗" : "!";
      log.info(`   ${marker} ${f.code}${f.sourceFile ? ` (${f.sourceFile})` : ""}: ${f.message}`);
    }
  } else {
    log.ok(`[templates doctor] PASS`);
  }

  log.info(`\n以下 Proposal §12 检查项 E1 阶段尚未实现（如实列出，不是遗漏）：`);
  for (const item of report.notYetImplemented) log.info(`   · ${item}`);

  process.exitCode = report.status === "FAIL" ? 1 : 0;
}
