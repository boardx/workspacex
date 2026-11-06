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
 *      `turbo run test`；共享 affected runner 仅在可验证的 Web 独占分片时排除）；
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

type Step = { run?: unknown; "working-directory"?: unknown; uses?: unknown; env?: Record<string, unknown> };
type Job = { steps?: unknown; env?: Record<string, unknown>; strategy?: { matrix?: { shard?: unknown } } };

const AFFECTED_RUNNER = "node .github/scripts/run-affected-tests.mjs";

/** Only the runner's validated, exclusive web branch can omit API Python setup. */
function isWebOnlyShard(job: Job, step: Step): boolean {
  // Shell prefixes/mutations are not proven by an env declaration alone.
  if (typeof step.run !== "string" || step.run.trim() !== AFFECTED_RUNNER) return false;
  const shard = { ...job.env, ...step.env }.CI_AFFECTED_WEB_SHARD;
  if (typeof shard !== "string") return false;
  if (/^[1-4]\/4$/.test(shard)) return true;
  if (!/^\$\{\{\s*matrix\.shard\s*\}\}\/4$/.test(shard)) return false;
  const values = job.strategy?.matrix?.shard;
  return Array.isArray(values) && values.length === 4 &&
    values.every((value, index) => String(value) === String(index + 1));
}

/** 一行 shell 是否会把 @repo/api 的**默认** vitest 套件跑起来。 */
function runsApiDefaultSuite(line: string, webOnly = false): boolean {
  // `verify:fullstack-smoke` 以 `verify:full` 开头但只跑 playwright，不能误命中 ——
  // 所以这里要求脚本名后面跟的是非 `:`/非 `-`/非字母数字的边界。
  if (/\bverify:(full|base|ci-base|release)(?![\w:-])/.test(line)) return true;
  // The affected runner preserves API coverage on fork PRs; its plan tests prove the filter.
  if (/\bnode\s+\.github\/scripts\/run-affected-tests\.mjs\b/.test(line)) return !webOnly;
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

function apiDefaultTrigger(job: Job): string | undefined {
  const steps = Array.isArray(job.steps) ? job.steps as Step[] : [];
  for (const step of steps) {
    if (typeof step.run !== "string") continue;
    const trigger = step.run.split("\n").map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"))
      .find(line => runsApiDefaultSuite(line, isWebOnlyShard(job, step)));
    if (trigger) return trigger;
  }
  return undefined;
}

for (const file of workflowFiles) {
  const doc = parse(readFileSync(join(WORKFLOWS_DIR, file), "utf8")) as { jobs?: Record<string, Job> };
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    const steps = Array.isArray(job?.steps) ? (job.steps as Step[]) : [];
    const trigger = apiDefaultTrigger(job);
    if (!trigger) continue;
    covered.push([file, jobName]);
    if (!steps.some(installsPythonRuntime)) offenders.push([file, jobName, trigger]);
  }
}

describe("跑 apps/api 默认套件的 CI job 必须自带 Python 运行时（#2972）", () => {
  it("明确验证的 Web 分片不要求 API Python，fork 也不会改变分片的独占范围", () => {
    for (const fork of ["true", "false"]) {
      for (const shard of ["1/4", "2/4", "3/4", "4/4"]) {
        expect(apiDefaultTrigger({ steps: [{ run: AFFECTED_RUNNER, env: {
          CI_AFFECTED_WEB_SHARD: shard, IS_FORK_PR: fork,
        } }] })).toBeUndefined();
      }
    }
    expect(apiDefaultTrigger({
      strategy: { matrix: { shard: [1, 2, 3, 4] } },
      steps: [{ run: AFFECTED_RUNNER, env: { CI_AFFECTED_WEB_SHARD: "${{ matrix.shard }}/4" } }],
    })).toBeUndefined();
  });

  it("普通 affected runner（含 fork API 回退）仍要求 Python", () => {
    for (const fork of ["true", "false"]) {
      expect(apiDefaultTrigger({ steps: [{ run: AFFECTED_RUNNER, env: { IS_FORK_PR: fork } }] })).toBe(AFFECTED_RUNNER);
    }
  });

  it("未知、越界或未闭合的 matrix 分片配置不得豁免 Python 门", () => {
    for (const shard of ["", "0/4", "5/4", "1/3", "${{ inputs.shard }}", "${{ matrix.shard }}/4"]) {
      expect(apiDefaultTrigger({ steps: [{ run: AFFECTED_RUNNER, env: { CI_AFFECTED_WEB_SHARD: shard } }] })).toBe(AFFECTED_RUNNER);
    }
    expect(apiDefaultTrigger({ strategy: { matrix: { shard: [1, 2, 3, 5] } },
      steps: [{ run: AFFECTED_RUNNER, env: { CI_AFFECTED_WEB_SHARD: "${{ matrix.shard }}/4" } }],
    })).toBe(AFFECTED_RUNNER);
  });

  it("step env 覆盖 job env；shell 改写与同 job 的其他 API 命令仍被检测", () => {
    expect(apiDefaultTrigger({ env: { CI_AFFECTED_WEB_SHARD: "1/4" }, steps: [
      { run: AFFECTED_RUNNER, env: { CI_AFFECTED_WEB_SHARD: "" } },
    ] })).toBe(AFFECTED_RUNNER);
    expect(apiDefaultTrigger({ steps: [{ run: `unset CI_AFFECTED_WEB_SHARD\n${AFFECTED_RUNNER}`,
      env: { CI_AFFECTED_WEB_SHARD: "1/4" } }] })).toBe(AFFECTED_RUNNER);
    expect(apiDefaultTrigger({ env: { CI_AFFECTED_WEB_SHARD: "1/4" }, steps: [
      { run: AFFECTED_RUNNER }, { run: "pnpm turbo run test" },
    ] })).toBe("pnpm turbo run test");
  });

  it("检测器确实命中了 job —— 一条都没命中说明门空转了", () => {
    // 反空转：`e2e-full`（verify:full）、`verify-affected`（turbo run test --affected）、
    // `gates-test`（--filter api exec vitest run）三条是已知必须被命中的。
    const names = covered.map(([, job]) => job);
    expect(names).toContain("base-api-shards");
    expect(names).toContain("verify-affected");
    expect(names).toContain("gates-test");
  });

  it("命中的每个 job 都在 apps/deep-agent-service 下 uv sync", () => {
    expect(
      offenders.map(([file, job, line]) => `${file} / job ${job}：跑了「${line}」但没装 Python 运行时`),
    ).toEqual([]);
  });
});
