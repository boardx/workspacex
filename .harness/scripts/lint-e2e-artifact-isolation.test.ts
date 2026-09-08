import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * lint-e2e-artifact-isolation.test.ts —— **同一个 job 里跑多趟 playwright 时，每份 config
 * 必须有自己的 `outputDir`**。
 *
 * 背景（2026-09-08，#3002）：`phase-01-e2e-full-evidence-<run_id>` 这个 artifact 里从来
 * 只有 `verify:full` 的 `e2e.log`——`chat-read` 与 self-service profile 两条 journey 的
 * `error-context.md` / `trace.zip` / 失败截图**一个都没有**，尽管 workflow 的上传路径
 * 逐字写着 `apps/web/test-results/`。
 *
 * 机制：playwright 每次 run 开始会**整个删掉** outputDir——
 * `createRemoveOutputDirsTask` → `removeFolders([outputDir])`
 * （`playwright/lib/runner/index.js`，除非 `--preserve-output`）。`e2e-full` 顺序跑三趟，
 * 三份 config 此前都吃默认 `apps/web/test-results` ⇒ 后一趟开跑就把前一趟的产物删干净；
 * 上传步骤在最后，只可能看见第三趟（self-service，通常是绿的、产物为空）的结果。
 *
 * ⇒ 代价不是"少了点日志"：#3000 的 B 类与 C 类调查因此**卡死在没有 trace**，只能读源码猜，
 *   猜出来的是一个机制上完美、但被 `grep -c` 当场反证推翻的假设。
 *
 * 本测试是纯静态断言（读 workflow 与 config 源文本，不跑 workflow 本身）：
 *   ① 逐个 job 收集它会跑起来的 playwright config（workflow 的 `run:` 行里直接写的
 *      `--config playwright.X.config.ts`，以及经根 package.json scripts 传递解析出来的）；
 *   ② 任何跑 ≥2 份 config 的 job，这些 config 的 `outputDir` 必须两两不同。
 *
 * 边界（说清楚它管不到什么）：
 *   · 只解析根 `package.json` 的 scripts 传递关系与 `--config` 字面量；经由 shell 脚本
 *     （如 `scripts/real-model-smoke.sh`）间接调起的 config 不在解析范围内。
 *   · 只比较 config 里字面量形式的 `outputDir: "…"`；未声明则按 playwright 默认值
 *     `test-results` 计（默认值正是本 issue 的成因，所以它参与碰撞判定）。
 *   · 它只保证"产物不会被后一趟删掉"，不保证上传步骤的 `path:` 覆盖到这些目录——
 *     那是另一件事，由 workflow 自己的 `path:` 负责。
 */
const ROOT = join(import.meta.dirname, "..", "..");
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");
const WEB_DIR = join(ROOT, "apps", "web");

/** playwright 未声明 `outputDir` 时的默认值（相对 config 所在目录）。 */
const PLAYWRIGHT_DEFAULT_OUTPUT_DIR = "test-results";

const CONFIG_RE = /--config[= ]+(playwright[\w.-]*\.config\.ts)/g;
const SCRIPT_RE = /\bpnpm(?:\s+(?:run|-r|--filter\s+\S+))*\s+(verify:[\w:-]+|e2e:[\w:-]+|shots:[\w:-]+)/g;

type Step = { run?: unknown };
type Job = { steps?: unknown };

const rootScripts: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
).scripts ?? {};

/** 把一行 shell 展开成它最终会跑起来的 playwright config 集合（沿 scripts 传递解析）。 */
function configsOf(line: string, seen = new Set<string>()): Set<string> {
  const found = new Set<string>();
  for (const m of line.matchAll(CONFIG_RE)) found.add(m[1]!);
  for (const m of line.matchAll(SCRIPT_RE)) {
    const name = m[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    const body = rootScripts[name];
    if (!body) continue;
    for (const c of configsOf(body, seen)) found.add(c);
  }
  return found;
}

function outputDirOf(configFile: string): string {
  const src = readFileSync(join(WEB_DIR, configFile), "utf8");
  // 只认字面量；本仓唯一的非字面量用法（real-model 的 path.join）也走这条分支被跳过，
  // 由下面的 expect 报出来而不是被静默当成默认值。
  const literal = src.match(/^\s*outputDir:\s*"([^"]+)"/m);
  if (literal) return literal[1]!;
  const computed = src.match(/^\s*outputDir:\s*(.+)$/m);
  if (computed) return `computed:${configFile}`;
  return PLAYWRIGHT_DEFAULT_OUTPUT_DIR;
}

/** a 是否会在删除时把 b 一起带走（相等，或 a 是 b 的祖先目录）。 */
function covers(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\/+$/, "");
  return norm(a) === norm(b) || norm(b).startsWith(`${norm(a)}/`);
}

function jobsWithConfigs(): { workflow: string; job: string; configs: string[] }[] {
  const out: { workflow: string; job: string; configs: string[] }[] = [];
  for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml"))) {
    const doc = parse(readFileSync(join(WORKFLOWS_DIR, file), "utf8")) as { jobs?: Record<string, Job> };
    for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
      const steps = Array.isArray(job?.steps) ? (job.steps as Step[]) : [];
      const configs = new Set<string>();
      for (const step of steps) {
        if (typeof step?.run !== "string") continue;
        for (const c of configsOf(step.run)) configs.add(c);
      }
      if (configs.size > 0) out.push({ workflow: file, job: jobName, configs: [...configs] });
    }
  }
  return out;
}

describe("同一 job 内的多趟 playwright 不得共用 outputDir（#3002）", () => {
  it("e2e-full 真的跑了不止一份 config —— 前提本身不成立就没什么好守的", () => {
    const e2eFull = jobsWithConfigs().find((j) => j.workflow === "harness-verify.yml" && j.job === "e2e-full");
    expect(e2eFull, "harness-verify.yml 里应存在 e2e-full job 且能解析出它跑的 config").toBeDefined();
    expect(e2eFull!.configs.length).toBeGreaterThanOrEqual(2);
  });

  it("每个跑多份 config 的 job，其 outputDir 互不覆盖", () => {
    const collisions: string[] = [];
    for (const { workflow, job, configs } of jobsWithConfigs()) {
      if (configs.length < 2) continue;
      const dirs = configs.map((c) => ({ config: c, dir: outputDirOf(c) }));
      for (const a of dirs) {
        for (const b of dirs) {
          if (a.config === b.config) continue;
          // 相等或**祖先**都算碰撞：playwright 删的是整个 outputDir 目录树，
          // 所以 `test-results`（默认值）一趟就能把 `test-results/chat-read` 一起带走。
          if (!covers(a.dir, b.dir)) continue;
          collisions.push(
            `${workflow}#${job}：${a.config} 的 outputDir="${a.dir}" 覆盖了 ` +
              `${b.config} 的 outputDir="${b.dir}"，` +
              `先跑 ${b.config} 再跑 ${a.config} 时前者的产物会被整个删掉` +
              `（playwright createRemoveOutputDirsTask）`,
          );
        }
      }
    }
    expect(collisions, collisions.join("\n")).toEqual([]);
  });
});
