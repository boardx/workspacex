import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * lint-ci-python-runtime.test.ts —— 凡是会跑 `apps/api` **默认** vitest 套件的
 * workflow job，必须在同一个 job 里装好 `apps/deep-agent-service` 的 Python 运行时。
 *
 * 背景（2026-09-08，#2972）：`e2e-full` 车道里 memory / scheduler / SQL 三个 standard
 * 能力共 5 条用例失败（run 34135593071），失败原因是**逐字相同的一行**：
 *
 *     Error: spawn …/apps/deep-agent-service/.venv/bin/python ENOENT
 *
 * 这 4 个测试文件（standard-memory-real-db / standard-scheduler-service /
 * standard-sql-database / standard-sql-source-real-db）在 `apps/api` 的默认
 * `vitest.config.ts` 里，都要 spawn Python 侧 runner / pytest 做跨语言取证。
 * 而 `e2e-full` 从建立起就没有任何 Python 安装步骤——`verify:full` → `verify:base:raw`
 * → `turbo run test` 把 @repo/api 的整套跑起来，跑到这 4 个文件时 `.venv` 根本不存在。
 *
 * ⚠ 它藏了很久的原因：`backend-gates.yml` 的 `gates-test` 跑的是**同一份**
 *   `vitest.config.ts`，而它有 `setup-uv` + `uv sync`，所以这 4 个文件在那条车道上一直是绿的。
 *   "测试本身没问题" 与 "这条车道跑得起来" 是两件事，静态地看代码永远看不出差别——
 *   差别只存在于 **job 的前置步骤**里。这正是本仓 AGENTS.md 那条：
 *   没有脚本的规范条目视为未落地。
 *
 * 本测试是纯静态断言（读 workflow 源文本，不跑 workflow 本身）：
 *   ① 找出所有会跑 api 默认套件的 job（`verify:full` / `verify:base` / `verify:release`；
 *      未带 `--config` 的 `--filter api exec vitest run`；未排除 @repo/api 的
 *      `turbo run test`）；
 *   ② 断言这些 job 里存在一个在 `apps/deep-agent-service` 下 `uv sync` 的步骤。
 *
 * 边界（说清楚它管不到什么，免得被当成比实际更强的保证）：它只查"这一步在不在"，
 * 不查这一步的 `if:` 条件是否与"api 真会在本 job 跑"的条件等价。`verify-affected`
 * 的那一步就是带条件的（只在 fork PR 上装，因为同仓 PR 上 @repo/api 被
 * `--filter='!@repo/api'` 排除掉了）。
 */
const ROOT = join(import.meta.dirname, "..", "..");
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");

const PYTHON_SERVICE_DIR = "apps/deep-agent-service";

type Step = { run?: unknown; "working-directory"?: unknown; uses?: unknown };
type Job = { steps?: unknown };

/** 一行 shell 是否会把 @repo/api 的**默认** vitest 套件跑起来。 */
function runsApiDefaultSuite(line: string): boolean {
  // `verify:fullstack-smoke` 以 `verify:full` 开头但只跑 playwright，不能误命中 ——
  // 所以这里要求脚本名后面跟的是非 `:`/非 `-`/非字母数字的边界。
  if (/\bverify:(full|base|release)(?![\w:-])/.test(line)) return true;
  // 带 `--config` 的是另有配置的专用车道（native-document、real-model 各条），
  // 它们各自的 job 自己负责前置条件，不在本门的范围内。
  if (/--filter\s+@?(repo\/)?api\b.*\bvitest run\b/.test(line) && !line.includes("--config")) return true;
  if (/\bturbo run [^|&;]*\btest\b/.test(line) && !/!@repo\/api/.test(line)) return true;
  return false;
}

function installsPythonRuntime(step: Step): boolean {
  const run = typeof step.run === "string" ? step.run : "";
  if (!/\buv sync\b/.test(run)) return false;
  const wd = typeof step["working-directory"] === "string" ? step["working-directory"] : "";
  return wd.includes(PYTHON_SERVICE_DIR) || run.includes(PYTHON_SERVICE_DIR);
}

const workflowFiles = readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .sort();

/** [workflow 文件名, job 名, 触发命中的那一行] */
const offenders: Array<[string, string, string]> = [];
/** 命中检测的 job 总数——用来防"检测器本身失灵变成空跑". */
const covered: Array<[string, string]> = [];

for (const file of workflowFiles) {
  const doc = parse(readFileSync(join(WORKFLOWS_DIR, file), "utf8")) as { jobs?: Record<string, Job> };
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    const steps = Array.isArray(job?.steps) ? (job.steps as Step[]) : [];
    const trigger = steps
      .flatMap((s) => (typeof s.run === "string" ? s.run.split("\n") : []))
      .map((l) => l.trim())
      // YAML 里的注释已被解析掉，但 shell 脚本块内部的 `#` 注释还在，要排掉。
      .filter((l) => l.length > 0 && !l.startsWith("#"))
      .find(runsApiDefaultSuite);
    if (!trigger) continue;
    covered.push([file, jobName]);
    if (!steps.some(installsPythonRuntime)) offenders.push([file, jobName, trigger]);
  }
}

describe("跑 apps/api 默认套件的 CI job 必须自带 Python 运行时（#2972）", () => {
  it("检测器确实命中了 job —— 一条都没命中说明门空转了", () => {
    // 反空转：`e2e-full`（verify:full）、`verify-affected`（turbo run test --affected）、
    // `gates-test`（--filter api exec vitest run）三条是已知必须被命中的。
    const names = covered.map(([, job]) => job);
    expect(names).toContain("full-regression-core");
    expect(names).toContain("verify-affected");
    expect(names).toContain("gates-test");
  });

  it("命中的每个 job 都在 apps/deep-agent-service 下 uv sync", () => {
    expect(
      offenders.map(([file, job, line]) => `${file} / job ${job}：跑了「${line}」但没装 Python 运行时`),
    ).toEqual([]);
  });
});
