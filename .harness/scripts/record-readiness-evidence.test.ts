/**
 * #3008 的**行为**反证：把 issue 正文里那份零收集日志逐字喂给记录器，它必须非零退出、
 * 且不留下任何 manifest。拆掉 `record-readiness-evidence.ts` 里的执行条数判据，
 * 第一条测试就会变红（它会重新产出一份 `exit_code: 0` 的通过 manifest）。
 *
 * 不断源码字符串——跑真的脚本，断真的退出码与真的产物，对齐本仓其余门控
 * 「每道门都实测过拆掉它会红」的做法。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = ".harness/scripts/record-readiness-evidence.ts";
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

/** issue #3008 正文里逐字那份日志 */
const ZERO_COLLECTION_LOG = "RUN  v2.1.9\n\n Test Files  no tests\n      Tests  no tests\n   Duration  164ms\n";

let dir: string | null = null;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

interface Run {
  status: number;
  output: string;
  manifestPath: string;
}

function record(log: string): Run {
  dir = mkdtempSync(join(tmpdir(), "readiness-evidence-"));
  const logPath = join(dir, "zero-collection.log");
  const manifestPath = join(dir, "zero-collection-manifest.json");
  writeFileSync(logPath, log);
  const args = [
    "exec", "tsx", SCRIPT,
    "--phase", "01", "--kind", "runtime", "--commit", HEAD,
    "--command", "pnpm --filter api exec vitest run tests/kernel tests/mcp tests/skill",
    "--log", logPath, "--output", manifestPath,
  ];
  try {
    const output = execFileSync("pnpm", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, output, manifestPath };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
      manifestPath,
    };
  }
}

describe("record-readiness-evidence：零收集不得产出通过 manifest", () => {
  it("`Tests  no tests` 的日志让记录器非零退出且不写 manifest", () => {
    const run = record(ZERO_COLLECTION_LOG);

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("zero executed tests");
    expect(existsSync(run.manifestPath)).toBe(false);
  });

  it("认不出执行条数的日志同样非零退出——不记 0 放行", () => {
    const run = record("build succeeded\nall good\n");

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("executed count is unreadable");
    expect(existsSync(run.manifestPath)).toBe(false);
  });

  it("真跑过用例的日志照常产出 manifest，并把执行条数记进去", () => {
    const run = record(" Test Files  3 passed (3)\n      Tests  10 passed | 2 skipped (12)\n");

    expect(run.status).toBe(0);
    expect(JSON.parse(readFileSync(run.manifestPath, "utf8"))).toMatchObject({
      schema_version: 1,
      phase: "01",
      kind: "runtime",
      exit_code: 0,
      executed: 10,
      commit: HEAD,
    });
  });
});
