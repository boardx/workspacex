// templates-doctor.ts — HMV2-010/011/012 + HMV2-016（drift gate）的仓库侧入口。
//
// pnpm harness templates doctor
//
// 判定逻辑全在 lib/template-doctor.ts 与 lib/generated-drift-gate.ts（纯函数，
// 喂 fixture 单测）。这里只做：读注册表 → 扫仓库找实例/生成物 → 交给判定函数
// → 按结果决定退出码，同 lint-rewrite-coverage.mjs 的分层方式。
import { REPO_ROOT } from "./lib/paths";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readRegistryFile, scanForInstances } from "./lib/template-scan";
import { validateRegistry } from "./lib/template-model";
import { runTemplateDoctor } from "./lib/template-doctor";
import { findGeneratedDrift, type ScannedFile } from "./lib/generated-drift-gate";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

/**
 * HMV2-016：收集 drift gate 的扫描对象——git 跟踪的 .md/.yaml/.yml（生成物
 * 必须入库才对别人存在，所以 git ls-files 即全集；未跟踪文件不进权威视图）。
 * git 本身失败时抛错（由调用方转成 UNKNOWN 而不是"0 份生成物"——P7）。
 */
function collectDriftScanFiles(): ScannedFile[] {
  // -z：NUL 分隔原始路径。不用默认换行模式——它会把非 ASCII 路径转成 C 风格
  // 引号转义（"phases/...\346\212\212..."），readFileSync 直接 ENOENT（实测踩到）。
  const out = execFileSync("git", ["ls-files", "-z", "--", "*.md", "*.yaml", "*.yml"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out
    .split("\0")
    .filter((p) => p.length > 0)
    .map((path) => ({ path, content: readFileSync(join(REPO_ROOT, path), "utf8") }));
}

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

  // —— HMV2-016：generated drift gate（Proposal §12 第 9 条"generated 文件未手改"）——
  let driftFailed = false;
  try {
    const driftReport = findGeneratedDrift(collectDriftScanFiles());
    if (driftReport.findings.length > 0) {
      driftFailed = true;
      log.err(`[templates doctor] drift gate FAIL —— ${driftReport.findings.length} 条（带头文件 ${driftReport.stampedFilesChecked} 份）：`);
      for (const f of driftReport.findings) log.err(`   ✗ ${f.code} (${f.path}): ${f.message}`);
    } else {
      log.ok(`[templates doctor] drift gate PASS —— ${driftReport.stampedFilesChecked} 份带元数据头的生成物，无手改/无畸形头`);
    }
  } catch (e) {
    // P7：数据源不可用输出 UNKNOWN 并非零退出，不得渲染成"0 份生成物=通过"。
    driftFailed = true;
    log.err(`[templates doctor] drift gate UNKNOWN —— 扫描失败，拒绝下判断：${(e as Error).message}`);
  }

  log.info(`\n以下 Proposal §12 检查项尚未实现（如实列出，不是遗漏）：`);
  for (const item of report.notYetImplemented) log.info(`   · ${item}`);

  process.exitCode = report.status === "FAIL" || driftFailed ? 1 : 0;
}
